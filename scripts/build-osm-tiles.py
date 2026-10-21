#!/usr/bin/env python3
"""
Build MapNG's own OSM tiles: a PMTiles archive whose tiles hold exactly what
the live Overpass query returns ("out body geom" JSON), so the browser can
read OSM without Overpass (refs/output/osm-data-sources.md, option B).

    python3 scripts/build-osm-tiles.py <input.osm.pbf> <output.pmtiles> [--zoom 13]

What goes in: services/overpassQuery.js OSM_FILTER (read through node, so the
tiles and the live query can never disagree).

Each tile (z13 by default, ~4 km at mid latitudes) is gzipped
{"v": 2, "e": [...]}: Overpass's own elements in a compact form the browser
expands back to the identical JSON (services/osmTiles.js expandCompactTile):
  - node      ["n", id, lat, lon, tags]
  - way       ["w", id, tags, coords]
  - relation  ["r", id, tags, [["w", ref, role, coords] | ["n", ref, role, lat, lon], ...]]
where lat / lon are integers at OSM's 1e-7 precision and coords is a flat
[lat0, lon0, dlat1, dlon1, ...] delta list (about a third of the old size).
Which elements go in:
  - nodes, ways and small relations are stored WHOLE in every tile their
    bounding box touches (the browser de-duplicates by type + id), so roads
    keep their real ends and junctions;
  - area relations spanning more than MAX_SPAN tiles (national forests, big
    lakes) are assembled into polygons and cut exactly at tile edges; each
    piece is its own relation with a negative id (tag mapng:relation = the
    real id), built from closed synthetic member ways;
  - other large relations (river systems) keep only the member ways that
    touch each tile; the browser merges members of the same relation id.

Needs: pip install osmium pmtiles shapely
"""
import argparse
import gzip
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict

import osmium
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_SPAN = 3          # a relation wider/taller than this many tiles is split per tile
COORD_DIGITS = 7      # Overpass precision


def load_filter():
    out = subprocess.run(
        ["node", "-e", "import('./services/overpassQuery.js').then((m) => console.log(JSON.stringify(m.OSM_FILTER)))"],
        cwd=REPO, check=True, capture_output=True, text=True,
    )
    f = json.loads(out.stdout)
    return {
        "way_keys": set(f["wayKeys"]),
        "way_tags": {tuple(t) for t in f["wayTags"]},
        "relation_keys": set(f["relationKeys"]),
        "node_tags": {tuple(t) for t in f["nodeTags"]},
    }


def tile_xy(lat, lon, z):
    lat = max(-85.0511, min(85.0511, lat))
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(n - 1, max(0, x)), min(n - 1, max(0, y))


def tile_bounds(x, y, z):
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return south, west, north, east


def tile_range(coords, z):
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    x0, y0 = tile_xy(max(lats), min(lons), z)   # north-west
    x1, y1 = tile_xy(min(lats), max(lons), z)   # south-east
    return x0, y0, x1, y1


def e7(value):
    """Integer 1e-7 degrees; value / 1e7 in the browser is exactly round(value, 7)."""
    return int(round(round(value, COORD_DIGITS) * 10 ** COORD_DIGITS))


def geom_json(coords):
    flat = []
    plat = plon = 0
    for lat, lon in coords:
        ilat, ilon = e7(lat), e7(lon)
        flat += [ilat - plat, ilon - plon]
        plat, plon = ilat, ilon
    return flat


def dumps(el):
    return json.dumps(el, separators=(",", ":"), ensure_ascii=False)


class Tiles:
    def __init__(self, z):
        self.z = z
        self.buckets = defaultdict(list)    # (x, y) -> [json strings]

    def add_whole(self, element_json, coords):
        x0, y0, x1, y1 = tile_range(coords, self.z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                self.buckets[(x, y)].append(element_json)

    def add_to(self, xy, element_json):
        self.buckets[xy].append(element_json)


def tags_dict(tag_list):
    return {t.k: t.v for t in tag_list}


class RelationPass(osmium.SimpleHandler):
    def __init__(self, flt):
        super().__init__()
        self.flt = flt
        self.relations = []
        self.member_ways = set()
        self.member_nodes = set()

    def relation(self, r):
        tags = tags_dict(r.tags)
        if not any(k in tags for k in self.flt["relation_keys"]):
            return
        members = [(m.type, m.ref, m.role) for m in r.members]
        self.relations.append((r.id, tags, members))
        for t, ref, _ in members:
            if t == "w":
                self.member_ways.add(ref)
            elif t == "n":
                self.member_nodes.add(ref)


class WayNodePass(osmium.SimpleHandler):
    def __init__(self, flt, member_ways, member_nodes, tiles):
        super().__init__()
        self.flt = flt
        self.member_ways = member_ways
        self.member_nodes = member_nodes
        self.tiles = tiles
        self.way_geom = {}      # member way id -> [(lat, lon)]
        self.node_loc = {}      # member node id -> (lat, lon)
        self.counts = defaultdict(int)

    def node(self, n):
        if n.id in self.member_nodes and n.location.valid():
            self.node_loc[n.id] = (n.location.lat, n.location.lon)
        if not n.tags:
            return
        if not any((t.k, t.v) in self.flt["node_tags"] for t in n.tags):
            return
        if not n.location.valid():
            return
        lat, lon = n.location.lat, n.location.lon
        el = ["n", n.id, e7(lat), e7(lon), tags_dict(n.tags)]
        self.tiles.add_whole(dumps(el), [(lat, lon)])
        self.counts["node"] += 1

    def way(self, w):
        tags = tags_dict(w.tags)
        matches = any(k in tags for k in self.flt["way_keys"]) or any(
            (k, v) in self.flt["way_tags"] for k, v in tags.items())
        is_member = w.id in self.member_ways
        if not matches and not is_member:
            return
        coords = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if len(coords) < 2:
            return
        if is_member:
            self.way_geom[w.id] = coords
        if matches:
            el = ["w", w.id, tags, geom_json(coords)]
            self.tiles.add_whole(dumps(el), coords)
            self.counts["way"] += 1


def assemble_area(members, way_geom):
    """Shapely (multi)polygon of a multipolygon relation, or None."""
    outer, inner = [], []
    for t, ref, role in members:
        if t != "w" or ref not in way_geom:
            continue
        line = LineString([(lon, lat) for lat, lon in way_geom[ref]])
        (inner if role == "inner" else outer).append(line)
    if not outer:
        return None
    outer_polys = list(polygonize(linemerge(outer)))
    if not outer_polys:
        return None
    area = unary_union(outer_polys)
    if inner:
        inner_polys = list(polygonize(linemerge(inner)))
        if inner_polys:
            area = area.difference(unary_union(inner_polys))
    if not area.is_valid:
        area = area.buffer(0)
    return None if area.is_empty else area


def ring_coords(ring):
    return [(lat, lon) for lon, lat in ring.coords]


def emit_relations(relations, way_geom, node_loc, tiles):
    next_synthetic = [-1]

    def synthetic_id():
        i = next_synthetic[0]
        next_synthetic[0] -= 1
        return i

    counts = defaultdict(int)
    for rid, tags, members in relations:
        member_json = []
        all_coords = []
        for t, ref, role in members:
            if t == "w" and ref in way_geom:
                coords = way_geom[ref]
                member_json.append((["w", ref, role, geom_json(coords)], coords))
                all_coords.extend(coords)
            elif t == "n" and ref in node_loc:
                lat, lon = node_loc[ref]
                member_json.append((["n", ref, role, e7(lat), e7(lon)], [(lat, lon)]))
                all_coords.append((lat, lon))
        if not all_coords:
            continue
        x0, y0, x1, y1 = tile_range(all_coords, tiles.z)
        small = (x1 - x0) < MAX_SPAN and (y1 - y0) < MAX_SPAN

        if small:
            el = ["r", rid, tags, [m for m, _ in member_json]]
            tiles.add_whole(dumps(el), all_coords)
            counts["relation_whole"] += 1
            continue

        is_area = tags.get("type") in ("multipolygon", "boundary")
        area = assemble_area(members, way_geom) if is_area else None
        if area is not None:
            # Cut at tile edges; every piece is a standalone multipolygon relation.
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    s, w, n, e = tile_bounds(x, y, tiles.z)
                    piece = area.intersection(box(w, s, e, n))
                    if piece.is_empty:
                        continue
                    polys = [piece] if isinstance(piece, Polygon) else [g for g in getattr(piece, "geoms", []) if isinstance(g, Polygon)]
                    for poly in polys:
                        if poly.is_empty:
                            continue
                        piece_members = [["w", synthetic_id(), "outer", geom_json(ring_coords(poly.exterior))]]
                        for hole in poly.interiors:
                            piece_members.append(["w", synthetic_id(), "inner", geom_json(ring_coords(hole))])
                        el = ["r", synthetic_id(), {**tags, "mapng:relation": str(rid)}, piece_members]
                        tiles.add_to((x, y), dumps(el))
                        counts["relation_area_piece"] += 1
            counts["relation_area_split"] += 1
            continue

        # Large non-area relation: per tile, only the members that touch it.
        per_tile = defaultdict(list)
        for m, coords in member_json:
            mx0, my0, mx1, my1 = tile_range(coords, tiles.z)
            for x in range(mx0, mx1 + 1):
                for y in range(my0, my1 + 1):
                    per_tile[(x, y)].append(m)
        for xy, ms in per_tile.items():
            el = ["r", rid, tags, ms]
            tiles.add_to(xy, dumps(el))
        counts["relation_members_split"] += 1
    return counts


def write_pmtiles(tiles, out_path, source_name):
    z = tiles.z
    entries = sorted(((zxy_to_tileid(z, x, y), xy) for xy in tiles.buckets for x, y in [xy]))
    all_lat, all_lon = [], []
    total = 0
    with open(out_path, "wb") as f:
        writer = Writer(f)
        for tileid, (x, y) in entries:
            body = '{"v":2,"e":[' + ",".join(tiles.buckets[(x, y)]) + "]}"
            data = gzip.compress(body.encode("utf-8"), compresslevel=9)
            writer.write_tile(tileid, data)
            total += len(data)
            s, w, n, e = tile_bounds(x, y, z)
            all_lat += [s, n]
            all_lon += [w, e]
        header = {
            "tile_type": TileType.UNKNOWN,
            "tile_compression": Compression.GZIP,
            "min_zoom": z,
            "max_zoom": z,
            "min_lon_e7": int(min(all_lon) * 1e7),
            "min_lat_e7": int(min(all_lat) * 1e7),
            "max_lon_e7": int(max(all_lon) * 1e7),
            "max_lat_e7": int(max(all_lat) * 1e7),
            "center_zoom": z,
            "center_lon_e7": int((min(all_lon) + max(all_lon)) / 2 * 1e7),
            "center_lat_e7": int((min(all_lat) + max(all_lat)) / 2 * 1e7),
        }
        metadata = {
            "name": "mapng-osm",
            "format": "overpass-json-compact-v2",
            "source": source_name,
            "zoom": z,
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "attribution": "© OpenStreetMap contributors (ODbL)",
        }
        writer.finalize(header, metadata)
    return len(entries), total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--zoom", type=int, default=13)
    args = ap.parse_args()

    t0 = time.time()
    flt = load_filter()
    rel = RelationPass(flt)
    rel.apply_file(args.input)
    print(f"relations: {len(rel.relations)} matching, {len(rel.member_ways)} member ways "
          f"({time.time() - t0:.0f}s)", file=sys.stderr)

    tiles = Tiles(args.zoom)
    wn = WayNodePass(flt, rel.member_ways, rel.member_nodes, tiles)
    wn.apply_file(args.input, locations=True, idx="flex_mem")
    print(f"nodes: {wn.counts['node']}, ways: {wn.counts['way']} ({time.time() - t0:.0f}s)", file=sys.stderr)

    rc = emit_relations(rel.relations, wn.way_geom, wn.node_loc, tiles)
    print(f"relations: {dict(rc)} ({time.time() - t0:.0f}s)", file=sys.stderr)

    n, size = write_pmtiles(tiles, args.output, os.path.basename(args.input))
    print(f"wrote {args.output}: {n} tiles, {size / 1e6:.1f} MB ({time.time() - t0:.0f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
