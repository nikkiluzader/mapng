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
import re
import subprocess
import sys
import time
from collections import defaultdict

import osmium
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, MultiLineString, Polygon, box
from shapely.prepared import prep
from shapely.ops import linemerge, polygonize, unary_union
from shapely import make_valid
from shapely.errors import GEOSException

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_SPAN = 3          # a relation wider/taller than this many tiles is split per tile
MANY_TILES = 64       # a feature whose box covers more tiles goes only where its shape is
COORD_DIGITS = 7      # Overpass precision


# Tags that say nothing about the map: an object carrying only these is left
# out of a --all build (they come back as tags of the objects that keep them).
META_KEYS = {"created_by", "source", "note", "fixme", "FIXME", "comment", "attribution"}


def meaningful(tags):
    return any(k not in META_KEYS and not k.startswith("source:") for k in tags)


def load_filter(everything=False):
    out = subprocess.run(
        ["node", "-e", "import('./services/overpassQuery.js').then((m) => console.log(JSON.stringify(m.OSM_FILTER)))"],
        cwd=REPO, check=True, capture_output=True, text=True,
    )
    f = json.loads(out.stdout)
    return {
        "all": everything,
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


def tile_frac(lat, lon, z):
    lat = max(-85.0511, min(85.0511, lat))
    n = 1 << z
    return (lon + 180.0) / 360.0 * n, (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n


def line_tiles(coords, z):
    """The tiles a line really passes through (each segment walked across
    the tile grid), not its bounding box: one long border way's box covers
    tens of thousands of tiles it never enters."""
    n = 1 << z
    out = set()
    prev = None
    for lat, lon in coords:
        fx, fy = tile_frac(lat, lon, z)
        fx, fy = min(n - 1e-9, max(0.0, fx)), min(n - 1e-9, max(0.0, fy))
        out.add((int(fx), int(fy)))
        if prev is not None:
            px, py = prev
            dx, dy = fx - px, fy - py
            # (a segment over half the world wide crosses the antimeridian:
            # only its ends count)
            if abs(dx) <= n / 2 and (int(px) != int(fx) or int(py) != int(fy)):
                ts = [0.0, 1.0]
                if dx:
                    ts += [(gx - px) / dx for gx in range(int(min(px, fx)) + 1, int(max(px, fx)) + 1)]
                if dy:
                    ts += [(gy - py) / dy for gy in range(int(min(py, fy)) + 1, int(max(py, fy)) + 1)]
                ts.sort()
                for t0, t1 in zip(ts, ts[1:]):
                    tm = (t0 + t1) / 2
                    out.add((int(px + dx * tm), int(py + dy * tm)))
        prev = (fx, fy)
    return out


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
    """Tile buckets; with a block (bz, bx, by) only the tiles inside that
    lower-zoom tile are kept (planet builds: every tile comes from exactly one
    block, so blocks join without de-duplication).

    A feature can reach into a neighbouring block that has none of its
    points (a big lake or forest over a block with no point of its outline):
    that block's extract never sees it. With --blocks (every leaf block of
    the planet), the feature's "owner" (the first block holding any of its
    points, in key order) also writes it into the tiles of blocks that have
    none of its points and that its shape really touches, as a side file
    the merge step folds in (scripts/planet/planet.py)."""
    def __init__(self, z, block=None, leaves=None):
        self.z = z
        self.buckets = defaultdict(list)    # (x, y) -> [json strings]
        self.side = defaultdict(list)       # tiles of other blocks (owner's extras)
        self.block = block
        self.leaves = leaves or set()
        self.leaf_zooms = sorted({int(k.split("-")[0]) for k in self.leaves})
        if block:
            bz, bx, by = block
            k = z - bz
            self.bx0, self.by0 = bx << k, by << k
            self.bx1, self.by1 = ((bx + 1) << k) - 1, ((by + 1) << k) - 1
            self.own = f"{bz}-{bx}-{by}"

    def clamp(self, x0, y0, x1, y1):
        """The tile range limited to the block (empty when outside it)."""
        if not self.block:
            return x0, y0, x1, y1
        return max(x0, self.bx0), max(y0, self.by0), min(x1, self.bx1), min(y1, self.by1)

    def inside(self, xy):
        return not self.block or (self.bx0 <= xy[0] <= self.bx1 and self.by0 <= xy[1] <= self.by1)

    def reaches_out(self, x0, y0, x1, y1):
        return bool(self.block and self.leaves) and (x0 < self.bx0 or y0 < self.by0 or x1 > self.bx1 or y1 > self.by1)

    def block_of_tile(self, x, y):
        for bz in self.leaf_zooms:
            k = self.z - bz
            key = f"{bz}-{x >> k}-{y >> k}"
            if key in self.leaves:
                return key
        return None

    def blocks_of(self, coords):
        return {b for b in (self.block_of_tile(*tile_xy(lat, lon, self.z)) for lat, lon in coords) if b}

    def owner(self, coords):
        """(this block owns the feature, blocks holding any of its points)"""
        held = self.blocks_of(coords)
        return (min(held) if held else self.own) == self.own, held

    def outer_tiles(self, x0, y0, x1, y1, held, shape):
        """Tiles of the range in blocks holding none of the feature's points
        that the shape really touches (not just its bounding box: an
        undersea cable's box covers 170 thousand ocean tiles)."""
        prepared = prep(shape) if shape is not None else None
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                if self.inside((x, y)):
                    continue
                b = self.block_of_tile(x, y)
                if b is None or b in held:
                    continue
                if prepared is not None:
                    s, w, n, e = tile_bounds(x, y, self.z)
                    if not prepared.intersects(box(w, s, e, n)):
                        continue
                yield x, y

    def add_whole(self, element_json, coords, shape=None, tags=None):
        x0, y0, x1, y1 = tile_range(coords, self.z)
        cx0, cy0, cx1, cy1 = self.clamp(x0, y0, x1, y1)
        # A feature over many tiles goes only into the tiles its shape really
        # touches (as Overpass answers a bbox): its bounding box alone put
        # one ring-shaped undersea cable into 150 thousand ocean tiles.
        test = None
        if (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MANY_TILES:
            sh = shape if shape is not None else shape_of(coords, tags)
            test = prep(sh) if sh is not None else None
        for x in range(cx0, cx1 + 1):
            for y in range(cy0, cy1 + 1):
                if test is not None:
                    s, w, n, e = tile_bounds(x, y, self.z)
                    if not test.intersects(box(w, s, e, n)):
                        continue
                self.buckets[(x, y)].append(element_json)
        if self.reaches_out(x0, y0, x1, y1):
            mine, held = self.owner(coords)
            if mine:
                for xy in self.outer_tiles(x0, y0, x1, y1, held, shape if shape is not None else shape_of(coords, tags)):
                    self.side[xy].append(element_json)

    def add_to(self, xy, element_json):
        if self.inside(xy):
            self.buckets[xy].append(element_json)
        elif self.block:
            self.side[xy].append(element_json)

    def write_side(self, path):
        with open(path, "w", encoding="utf-8") as f:
            for (x, y) in sorted(self.side):
                for el in self.side[(x, y)]:
                    f.write(f"{x} {y}\t{el}\n")


LINEAR_KEYS = ("highway", "barrier", "railway", "power", "communication")
LINEAR_VALUES = {
    "man_made": {"submarine_cable", "pipeline", "embankment", "cutline", "breakwater", "groyne", "pier"},
    "natural": {"coastline", "cliff", "ridge", "arete", "tree_row", "earth_bank"},
    "waterway": {"river", "stream", "canal", "drain", "ditch", "brook"},
}


def is_linear(tags):
    """Closed ways that are still lines (a ring cable, a roundabout, a fence
    round a field), not areas; area=yes always means an area."""
    if not tags or tags.get("area") == "yes":
        return False
    if any(k in tags for k in LINEAR_KEYS):
        return True
    return any(tags.get(k) in vals for k, vals in LINEAR_VALUES.items())


def shape_of(coords, tags=None):
    """A way's shape for the tile test: a polygon when closed and not a
    linear feature (is_linear), else a line."""
    pts = [(lon, lat) for lat, lon in coords]
    try:
        if len(pts) >= 4 and pts[0] == pts[-1] and not is_linear(tags):
            poly = Polygon(pts)
            return poly if poly.is_valid else make_valid(poly)
        return LineString(pts) if len(pts) >= 2 else None
    except (GEOSException, ValueError):
        return None


def tags_dict(tag_list):
    return {t.k: t.v for t in tag_list}


# ── OPL input (--opl) ──────────────────────────────────────────────────────
# pyosmium's own reader corrupted the process's memory part way through the
# Florida extract (segfaults, "unknown opcode", sets yielding non-pairs) on
# Python 3.12 and 3.13 alike. Big extracts are therefore prepared by the
# osmium command-line tool and read here as plain text, in pure Python:
#
#   osmium tags-filter in.osm.pbf <OSM_FILTER as osmium expressions> -o f.osm.pbf
#   osmium add-locations-to-ways f.osm.pbf -o f-loc.osm.pbf
#   osmium cat f-loc.osm.pbf -f "opl,add_metadata=false,locations_on_ways=true" -o f.opl
#
# The objects below carry just what the handlers read, under pyosmium's names.

_OPL_ESC = re.compile(r"%([0-9a-fA-F]+)%")


def _unopl(s):
    return _OPL_ESC.sub(lambda m: chr(int(m.group(1), 16)), s) if "%" in s else s


class _Tag:
    __slots__ = ("k", "v")

    def __init__(self, k, v):
        self.k, self.v = k, v


class _Tags(dict):
    """A dict (get / in / truthiness) that iterates like pyosmium's TagList."""

    def __iter__(self):
        return (_Tag(k, v) for k, v in self.items())


class _Location:
    __slots__ = ("lat", "lon")

    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon

    def valid(self):
        return self.lat is not None


class _NodeRef:
    __slots__ = ("ref", "location")

    def __init__(self, ref, location):
        self.ref, self.location = ref, location


class _Member:
    __slots__ = ("type", "ref", "role")

    def __init__(self, type_, ref, role):
        self.type, self.ref, self.role = type_, ref, role


class _Obj:
    __slots__ = ("id", "tags", "location", "nodes", "members")


def _opl_tags(field):
    tags = _Tags()
    if len(field) > 1:
        for kv in field[1:].split(","):
            k, _, v = kv.partition("=")
            tags[_unopl(k)] = _unopl(v)
    return tags


def _opl_xy(field_x, field_y):
    try:
        return _Location(float(field_y), float(field_x))
    except ValueError:
        return _Location(None, None)


def apply_opl(path, handler, kinds="nwr"):
    """Feed an OPL file's objects to a handler's node / way / relation methods."""
    with open(path, encoding="utf-8") as f:
        for line in f:
            kind = line[0]
            if kind not in kinds:
                continue
            fields = line.rstrip("\n").split(" ")
            o = _Obj()
            o.id = int(fields[0][1:])
            o.tags = _Tags()
            x = y = ""
            for field in fields[1:]:
                c = field[:1]
                if c == "T":
                    o.tags = _opl_tags(field)
                elif c == "x":
                    x = field[1:]
                elif c == "y":
                    y = field[1:]
                elif c == "N":
                    refs = []
                    for item in field[1:].split(",") if len(field) > 1 else []:
                        ref, _, rest = item[1:].partition("x")
                        lon, _, lat = rest.partition("y")
                        refs.append(_NodeRef(int(ref), _opl_xy(lon, lat)))
                    o.nodes = refs
                elif c == "M":
                    members = []
                    for item in field[1:].split(",") if len(field) > 1 else []:
                        ref, _, role = item[1:].partition("@")
                        members.append(_Member(item[0], int(ref), _unopl(role)))
                    o.members = members
            if kind == "n":
                o.location = _opl_xy(x, y)
                handler.node(o)
            elif kind == "w":
                handler.way(o)
            else:
                handler.relation(o)


class RelationPass(osmium.SimpleHandler):
    def __init__(self, flt):
        super().__init__()
        self.flt = flt
        self.relations = []
        self.member_ways = set()
        self.member_nodes = set()

    def relation(self, r):
        tags = tags_dict(r.tags)
        keep = meaningful(tags) if self.flt.get("all") else any(k in tags for k in self.flt["relation_keys"])
        if not keep:
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
        # Look the filter's keys up rather than iterating every tag of every
        # node: pyosmium's tag iterator crashed (segfault / SystemError) part
        # way through the Florida extract, and this is faster anyway.
        if self.flt.get("all"):
            if not meaningful(tags_dict(n.tags)):
                return
        elif not any(n.tags.get(k) == v for k, v in self.flt["node_tags"]):
            return
        if not n.location.valid():
            return
        lat, lon = n.location.lat, n.location.lon
        el = ["n", n.id, e7(lat), e7(lon), tags_dict(n.tags)]
        self.tiles.add_whole(dumps(el), [(lat, lon)])
        self.counts["node"] += 1

    def way(self, w):
        tags = tags_dict(w.tags)
        if self.flt.get("all"):
            matches = meaningful(tags)
        else:
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
            self.tiles.add_whole(dumps(el), coords, tags=tags)
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
    # (broken OSM shapes are common across a planet: self-touching rings,
    # crossing members. Each ring is made valid first; if GEOS still can't
    # combine them, a zero buffer repairs most; failing that the area is
    # skipped rather than stopping the whole build)
    try:
        outer_polys = [valid(p) for p in polygonize(linemerge(outer))]
        if not outer_polys:
            return None
        area = safe_union(outer_polys)
        if inner:
            inner_polys = [valid(p) for p in polygonize(linemerge(inner))]
            if inner_polys:
                area = valid(area).difference(safe_union(inner_polys))
        if not area.is_valid:
            area = area.buffer(0)
    except GEOSException as err:
        print(f"skipped a broken area relation: {err}", file=sys.stderr)
        return None
    return None if area.is_empty else area


def valid(geom):
    return geom if geom.is_valid else make_valid(geom)


def safe_union(polys):
    try:
        return unary_union(polys)
    except GEOSException:
        return unary_union([p.buffer(0) for p in polys])


def member_lines(member_json):
    lines = [[(lon, lat) for lat, lon in coords] for m, coords in member_json if m[0] == "w" and len(coords) >= 2]
    return MultiLineString(lines) if lines else None


def ring_coords(ring):
    return [(lat, lon) for lon, lat in ring.coords]


def emit_relations(relations, way_geom, node_loc, tiles, id_offset=0, area_keys=None):
    # area_keys (--all builds): only big areas carrying one of these keys are
    # cut into per-tile pieces (land cover the app draws: forests, lakes,
    # parks). Every other big relation (countries, states, time zones, postal
    # areas, islands) keeps just the member ways touching each tile, as an
    # Overpass bbox query answers: cut up, a country would put a piece with all
    # its tags into every one of its millions of tiles.
    # (negative ids for cut pieces; planet blocks each get their own range, so
    # pieces from neighbouring blocks never share an id in the browser's merge)
    next_synthetic = [-1 - id_offset]

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

        is_area = tags.get("type") in ("multipolygon", "boundary")

        if small:
            el = ["r", rid, tags, [m for m, _ in member_json]]
            shape = None
            if tiles.reaches_out(x0, y0, x1, y1):
                shape = (assemble_area(members, way_geom) if is_area else None) or member_lines(member_json)
            tiles.add_whole(dumps(el), all_coords, shape)
            counts["relation_whole"] += 1
            continue

        if is_area and area_keys is not None and not any(k in tags for k in area_keys):
            is_area = False
        area = assemble_area(members, way_geom) if is_area else None
        if area is not None:
            # Cut at tile edges; every piece is a standalone multipolygon relation.
            # (planet blocks: only the area's owner block cuts it, for every
            # tile it covers, the other blocks' tiles through the side file;
            # the other blocks skip it, so no tile gets two sets of pieces)
            if tiles.reaches_out(x0, y0, x1, y1):
                mine, _held = tiles.owner(all_coords)
                if not mine:
                    continue
                cx0, cy0, cx1, cy1 = x0, y0, x1, y1
            else:
                cx0, cy0, cx1, cy1 = tiles.clamp(x0, y0, x1, y1)
            for x in range(cx0, cx1 + 1):
                for y in range(cy0, cy1 + 1):
                    s, w, n, e = tile_bounds(x, y, tiles.z)
                    try:
                        piece = area.intersection(box(w, s, e, n))
                    except GEOSException:
                        piece = area.buffer(0).intersection(box(w, s, e, n))
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
        # (the owner also adds the members that cross blocks holding none of
        # the relation's points)
        mine, held = tiles.owner(all_coords) if tiles.reaches_out(x0, y0, x1, y1) else (False, set())
        for m, coords in member_json:
            for xy in line_tiles(coords, tiles.z):
                if tiles.inside(xy):
                    per_tile[xy].append(m)
                elif mine and m[0] == "w":
                    b = tiles.block_of_tile(*xy)
                    if b is not None and b not in held:
                        per_tile[xy].append(m)
        if os.environ.get("OSMTILES_DEBUG") and len(per_tile) > 2000:
            print(f"DEBUG big member-split relation {rid}: {len(per_tile)} tiles, {len(member_json)} members, "
                  f"{len(dumps(tags))} tag bytes, type={tags.get('type')} {tags.get('boundary') or tags.get('route') or ''} {tags.get('name', '')[:40]}",
                  file=sys.stderr, flush=True)
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
    ap.add_argument("--opl", action="store_true",
                    help="the input is OPL text with locations on its ways (see apply_opl)")
    ap.add_argument("--index", default="flex_mem",
                    help="osmium node location index, or none for a file with locations on its ways\n                    (osmium add-locations-to-ways; how big extracts are built: pyosmium's\n                    own reader corrupted memory part way through Florida)")
    ap.add_argument("--blocks", default=None,
                    help="JSON list of every leaf block key (z-x-y) of the planet: features reaching into\n                    blocks that hold none of their points are written there too, as <output>.side")
    ap.add_argument("--block", default=None,
                    help="z/x/y: keep only the tiles inside this lower-zoom tile (planet blocks)")
    ap.add_argument("--all", action="store_true",
                    help="every object with a meaningful tag, not just OSM_FILTER (the app filters on reading)")
    args = ap.parse_args()
    block = tuple(int(v) for v in args.block.split("/")) if args.block else None
    # a block's own range of negative ids for cut pieces (its PMTiles tile id x 1e8)
    id_offset = zxy_to_tileid(*block) * 100_000_000 if block else 0

    t0 = time.time()
    flt = load_filter(args.all)
    rel = RelationPass(flt)
    if args.opl:
        apply_opl(args.input, rel, kinds="r")
    else:
        rel.apply_file(args.input)
    print(f"relations: {len(rel.relations)} matching, {len(rel.member_ways)} member ways "
          f"({time.time() - t0:.0f}s)", file=sys.stderr)

    leaves = set(json.load(open(args.blocks))) if args.blocks else None
    tiles = Tiles(args.zoom, block, leaves)
    wn = WayNodePass(flt, rel.member_ways, rel.member_nodes, tiles)
    if args.opl:
        apply_opl(args.input, wn, kinds="nw")
    elif args.index == "none":
        # node locations embedded in the ways (osmium add-locations-to-ways)
        wn.apply_file(args.input, locations=False)
    else:
        wn.apply_file(args.input, locations=True, idx=args.index)
    print(f"nodes: {wn.counts['node']}, ways: {wn.counts['way']} ({time.time() - t0:.0f}s)", file=sys.stderr)

    rc = emit_relations(rel.relations, wn.way_geom, wn.node_loc, tiles, id_offset,
                        area_keys=flt["relation_keys"] if args.all else None)
    print(f"relations: {dict(rc)} ({time.time() - t0:.0f}s)", file=sys.stderr)

    if block and leaves:
        tiles.write_side(args.output + ".side")
        print(f"side: {sum(len(v) for v in tiles.side.values())} elements for {len(tiles.side)} tiles of other blocks", file=sys.stderr)
    if not tiles.buckets:
        # (a block with nothing of ours in it, e.g. open ocean: no archive)
        print(f"no tiles: {args.output} not written ({time.time() - t0:.0f}s)", file=sys.stderr)
        return
    n, size = write_pmtiles(tiles, args.output, os.path.basename(args.input))
    print(f"wrote {args.output}: {n} tiles, {size / 1e6:.1f} MB ({time.time() - t0:.0f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
