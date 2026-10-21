#!/usr/bin/env python3
"""
Publish an OSM tile archive (scripts/build-osm-tiles.py) to the R2 bucket and
list it in osm/manifest.json, which the app reads to pick an archive for an
area (services/osmTiles.js resolveOsmTileArchiveUrl).

    python3 scripts/publish-osm-tiles.py <archive.pmtiles> --region arizona --poly arizona.poly

- Uploads to osm/<region>-<YYYY-MM-DD>.pmtiles (archives are immutable; a
  rebuild gets a new name) unless an object of the same size is already there.
- The manifest entry carries the region's real coverage outline (Geofabrik
  .poly, outer ring, simplified) as well as its bounding box: an extract's
  bbox also covers neighbouring areas the archive has no data for.
- Replaces the manifest entry with the same region; other regions are kept.

Uses scripts/r2.sh (credentials in ~/.config/mapng/r2.env).
"""
import argparse
import json
import os
import subprocess
import sys

from pmtiles.reader import MmapSource, Reader
from shapely.geometry import Polygon

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R2 = [os.path.join(REPO, "scripts/r2.sh")]
MANIFEST_KEY = "osm/manifest.json"
SIMPLIFY_DEG = 0.002        # ~200 m: the outline only decides archive vs Overpass


def r2(*args, input_bytes=None, check=True):
    return subprocess.run(R2 + list(args), input=input_bytes, capture_output=True, check=check)


def read_poly(path):
    """Outer rings of a Geofabrik .poly file as shapely Polygons ('!'-prefixed sections are holes)."""
    rings, current, hole = [], None, False
    with open(path) as f:
        lines = [l.strip() for l in f if l.strip()]
    for line in lines[1:]:
        if line == "END":
            if current is not None:
                if not hole and len(current) >= 3:
                    rings.append(Polygon(current))
                current = None
            continue
        if current is None:
            hole = line.startswith("!")
            current = []
            continue
        lon, lat = map(float, line.split()[:2])
        current.append((lon, lat))
    return rings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--region", required=True)
    ap.add_argument("--poly", required=True, help="Geofabrik .poly outline of the extract")
    args = ap.parse_args()

    with open(args.archive, "rb") as f:
        reader = Reader(MmapSource(f))
        meta = reader.metadata()
    built_at = meta.get("built_at", "")
    key = f"osm/{args.region}-{built_at[:10]}.pmtiles"

    size = os.path.getsize(args.archive)
    listing = r2("lsjson", f"r2:mapng-osm/{key}", check=False)
    existing = json.loads(listing.stdout or "[]") if listing.returncode == 0 else []
    if existing and existing[0].get("Size") != size:
        # A second build the same day: never overwrite a published name (the
        # Worker edge-caches its byte ranges as immutable), add the time.
        key = f"osm/{args.region}-{built_at[:10]}-{built_at[11:16].replace(':', '')}.pmtiles"
        listing = r2("lsjson", f"r2:mapng-osm/{key}", check=False)
        existing = json.loads(listing.stdout or "[]") if listing.returncode == 0 else []
    if existing and existing[0].get("Size") == size:
        print(f"{key} already uploaded ({size} bytes)", file=sys.stderr)
    else:
        print(f"uploading {key} ({size / 1e6:.0f} MB)...", file=sys.stderr)
        r2("copyto", args.archive, f"r2:mapng-osm/{key}", "--s3-chunk-size", "64M", "--s3-upload-concurrency", "8")

    polys = [p.simplify(SIMPLIFY_DEG, preserve_topology=True) for p in read_poly(args.poly)]
    coverage = [[[round(x, 5), round(y, 5)] for x, y in p.exterior.coords] for p in polys]
    minx = min(p.bounds[0] for p in polys)
    miny = min(p.bounds[1] for p in polys)
    maxx = max(p.bounds[2] for p in polys)
    maxy = max(p.bounds[3] for p in polys)

    current = r2("cat", f"r2:mapng-osm/{MANIFEST_KEY}", check=False)
    manifest = json.loads(current.stdout) if current.returncode == 0 and current.stdout.strip() else {"archives": []}
    manifest["archives"] = [a for a in manifest.get("archives", []) if a.get("region") != args.region]
    manifest["archives"].append({
        "region": args.region,
        "key": key,
        "bounds": [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)],
        "coverage": coverage,
        "built_at": built_at,
        "source": meta.get("source", ""),
        "zoom": meta.get("zoom"),
    })
    body = json.dumps(manifest, separators=(",", ":")).encode()
    r2("rcat", f"r2:mapng-osm/{MANIFEST_KEY}", input_bytes=body)
    print(f"manifest: {len(manifest['archives'])} archive(s); {args.region} -> {key} "
          f"({sum(len(c) for c in coverage)} outline points)", file=sys.stderr)


if __name__ == "__main__":
    main()
