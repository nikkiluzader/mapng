#!/usr/bin/env python3
"""
MapNG's OSM tiles for the whole planet, built in blocks on one PC.

    planet.py filter  <planet.osm.pbf> <workdir>     prefilter to what MapNG reads
    planet.py split   <workdir>                       cut into blocks that fit in memory
    planet.py build   <workdir> [--jobs N]            build every block twice, keep identical ones
    planet.py merge   <workdir> [--group-zoom 3]      join blocks into a few archives to publish
    planet.py status  <workdir>

Why blocks: scripts/build-osm-tiles.py holds a whole input in RAM, and the
PC (47 GB, 32 threads, occasional random crashes in long runs) can't build a
planet at once. The planet is cut into lower-zoom tiles ("blocks", aligned to
the z13 tile grid), each extracted with osmium's "smart" strategy (complete
ways and multipolygons), and built with --block z/x/y so it keeps only the
tiles inside it. Every tile therefore comes from exactly one block, and the
blocks join without any de-duplication. Cut pieces of big areas get ids from
a range reserved per block (build-osm-tiles.py --block).

Blocks start at zoom 3 and are split into their four children until the
filtered extract is under --max-mb (memory: the builder needs roughly
8-10x the filtered pbf). Each block is built twice and kept only if both
archives are identical tile by tile (a silent corrupt tile happened once on
this machine); a mismatch is rebuilt, then reported.

State lives in <workdir>/state.json, so every step can be stopped and resumed.
Needs the conda env "osmtiles" (python 3.12, osmium-tool, pyosmium,
pmtiles, shapely).
"""
import argparse
import gzip
import heapq
import json
import math
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILDER = os.path.join(REPO, "scripts", "build-osm-tiles.py")
PY = sys.executable
OSMIUM = shutil.which("osmium") or os.path.join(os.path.dirname(PY), "osmium")
TILE_ZOOM = 13
START_ZOOM = 3


# The WSL disk is a file on C: (only 240 GB free when this was written), so
# the real limit is C:'s free space, not what df / says. Every step stops
# before C: drops under MIN_FREE_GB, and inputs are deleted as soon as the
# next stage has them.
MIN_FREE_GB = float(os.environ.get("PLANET_MIN_FREE_GB", 25))
WINDOWS_DRIVE = os.environ.get("PLANET_WINDOWS_DRIVE", "/mnt/c")


WSL_VHDX = os.environ.get("PLANET_WSL_VHDX", "")


def wsl_vhdx():
    """WSL's virtual disk file on the Windows drive (it grows, never shrinks)."""
    if WSL_VHDX:
        return WSL_VHDX
    import glob
    found = glob.glob(os.path.join(WINDOWS_DRIVE, "Users", "*", "AppData", "Local", "wsl", "*", "ext4.vhdx"))
    return max(found, key=os.path.getsize) if found else ""


def free_gb():
    """Space a step can really use: C:'s free space plus the space already
    inside WSL's disk file that WSL has freed (deleted files' room is reused
    without the file growing, though C: never gets it back by itself)."""
    root = shutil.disk_usage("/")
    if not os.path.exists(WINDOWS_DRIVE):
        return root.free / 2**30
    c_free = shutil.disk_usage(WINDOWS_DRIVE).free
    vhdx = wsl_vhdx()
    reusable = max(0, os.path.getsize(vhdx) - root.used) if vhdx else 0
    return min(root.free, c_free + reusable) / 2**30


def drop_cache(*paths):
    """Ask Linux to drop its file cache for these files. Windows counts WSL's
    file cache as used memory (vmmemWSL grew to 43 GB of a 64 GB PC from
    the planet download alone), and the cache of a file a step is done with
    is never needed again."""
    for p in paths:
        try:
            fd = os.open(p, os.O_RDONLY)
            try:
                os.fsync(fd)
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            finally:
                os.close(fd)
        except OSError:
            pass


def start_cache_trimmer(*roots, every=5):
    """Release the file cache of the big files under these folders every few
    seconds while a step runs: osmium reading the 89 GB planet fills the
    cache as it goes, and Windows counts all of it against its own memory."""
    import threading

    def loop():
        while True:
            files = []
            for root in roots:
                if os.path.isfile(root):
                    files.append(root)
                for dirpath, _dirs, names in os.walk(root) if os.path.isdir(root) else ():
                    files += [os.path.join(dirpath, n) for n in names]
            for f in files:
                try:
                    if os.path.getsize(f) > 32 * 2**20:
                        fd = os.open(f, os.O_RDONLY)
                        try:
                            # (pages still being written can't be dropped until
                            # they're on disk: flush the file first; osmium reads
                            # ~1 GB/s, hence every few seconds)
                            if time.time() - os.path.getmtime(f) < 60:
                                os.fsync(fd)
                            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                        finally:
                            os.close(fd)
                except OSError:
                    pass
            time.sleep(every)
    threading.Thread(target=loop, daemon=True).start()


def check_space(need_gb=0):
    f = free_gb()
    if f - need_gb < MIN_FREE_GB:
        raise SystemExit(f"stopping: {f:.0f} GB free, need {need_gb:.0f} GB more and {MIN_FREE_GB:.0f} GB spare")
    return f


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed ({r.returncode}): {r.stderr[-2000:]}")
    return r


# ── state ──────────────────────────────────────────────────────────────────

def load_state(wd):
    p = os.path.join(wd, "state.json")
    return json.load(open(p)) if os.path.exists(p) else {"blocks": {}}


def update_state(wd, fn):
    """Load, change and save the state under a lock: the builder and the
    publisher (planet.py publish) both write it."""
    import fcntl
    with open(os.path.join(wd, "state.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        st = load_state(wd)
        fn(st)
        save_state(wd, st)
        return st


def save_state(wd, st):
    p = os.path.join(wd, "state.json")
    tmp = p + ".tmp"
    json.dump(st, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, p)


def bkey(z, x, y):
    return f"{z}-{x}-{y}"


def tile_bbox(z, x, y):
    """west, south, east, north of a web-mercator tile."""
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


# ── filter ─────────────────────────────────────────────────────────────────

def filter_expressions():
    """osmium tags-filter expressions from the app's own OSM_FILTER
    (services/overpassQuery.js), so the prefilter never drifts from it."""
    out = run(["node", "-e", "import('./services/overpassQuery.js').then((m) => console.log(JSON.stringify(m.OSM_FILTER)))"], cwd=REPO)
    f = json.loads(out.stdout)
    ex = [f"w/{k}" for k in f["wayKeys"]]
    ex += [f"w/{k}={v}" for k, v in f["wayTags"]]
    ex += [f"r/{k}" for k in f["relationKeys"]]
    ex += [f"n/{k}={v}" for k, v in f["nodeTags"]]
    return ex


def cmd_filter(args):
    wd = args.workdir
    os.makedirs(wd, exist_ok=True)
    ex = filter_expressions()
    open(os.path.join(wd, "filter.txt"), "w").write("\n".join(ex) + "\n")
    out = os.path.join(wd, "filtered.osm.pbf")
    t0 = time.time()
    check_space(os.path.getsize(args.planet) / 2**30 * 0.9)     # the filtered copy is a bit smaller
    log(f"tags-filter ({len(ex)} expressions) -> {out}")
    run([OSMIUM, "tags-filter", args.planet, "-e", os.path.join(wd, "filter.txt"), "-o", out, "--overwrite", "--progress" if False else "--no-progress"])
    drop_cache(args.planet, out)
    st = load_state(wd)
    st["planet"] = os.path.abspath(args.planet)
    st["filtered_mb"] = round(os.path.getsize(out) / 2**20)
    save_state(wd, st)
    log(f"filtered: {st['filtered_mb']} MB in {time.time() - t0:.0f} s")
    if args.delete_planet:
        os.remove(args.planet)
        log(f"deleted {args.planet} (re-downloadable); {free_gb():.0f} GB free")


# ── split ──────────────────────────────────────────────────────────────────

def extract_children(src, wd, blocks, batch):
    """osmium extract (smart) of several blocks from one source file in one pass."""
    os.makedirs(os.path.join(wd, "blocks"), exist_ok=True)
    for i in range(0, len(blocks), batch):
        part = blocks[i:i + batch]
        cfg = {"directory": os.path.join(wd, "blocks"), "extracts": []}
        for z, x, y in part:
            w, s, e, n = tile_bbox(z, x, y)
            cfg["extracts"].append({"output": f"{bkey(z, x, y)}.osm.pbf", "output_format": "pbf", "bbox": [w, s, e, n]})
        cfgp = os.path.join(wd, f"extract-{os.getpid()}.json")
        json.dump(cfg, open(cfgp, "w"))
        # (smart completes only multipolygons by default; the builder also
        # assembles type=boundary areas: protected areas, reserves)
        run([OSMIUM, "extract", "-s", "smart", "-S", "types=multipolygon,boundary", "-c", cfgp, src, "--overwrite", "--no-progress"])
        os.remove(cfgp)
        drop_cache(src, *(os.path.join(cfg["directory"], e["output"]) for e in cfg["extracts"]))


def object_count(path):
    if not os.path.exists(path):
        return 0
    # (osmium fileinfo -e stops on "Invalid location" in some near-empty
    # extracts; the object lines of an OPL dump count them plainly)
    out = run([OSMIUM, "cat", "-f", "opl,add_metadata=false", path, "-o", "-"]).stdout
    return sum(1 for line in out.splitlines() if line[:1] in ("n", "w", "r"))


def cmd_split(args):
    wd = args.workdir
    st = load_state(wd)
    src = os.path.join(wd, "filtered.osm.pbf")
    blocks = st["blocks"]
    n = 1 << START_ZOOM
    first = [(START_ZOOM, x, y) for x in range(n) for y in range(n)]
    todo = [b for b in first if bkey(*b) not in blocks]
    if todo:
        # pass by pass, each recorded when it finishes: a crash (this machine
        # segfaults now and then in long runs) only repeats the pass it hit
        if os.path.exists(src):
            check_space(os.path.getsize(src) / 2**30 * 1.15 * len(todo) / len(first))
        log(f"extracting {len(todo)} of {len(first)} zoom-{START_ZOOM} blocks from {src}, {args.batch} per pass")
        t0 = time.time()
        for i in range(0, len(todo), args.batch):
            part = todo[i:i + args.batch]
            extract_children(src, wd, part, args.batch)
            for z, x, y in part:
                blocks[bkey(z, x, y)] = {"z": z, "x": x, "y": y, "state": "extracted"}
            save_state(wd, st)
            log(f"  pass done: {len([b for b in first if bkey(*b) in blocks])}/{len(first)} blocks ({time.time() - t0:.0f} s)")
        if not args.keep_filtered:
            os.remove(src)
            log(f"deleted {src}; {free_gb():.0f} GB free")
    while True:
        changed = False
        for key, b in sorted(blocks.items()):
            if b["state"] != "extracted":
                continue
            p = os.path.join(wd, "blocks", f"{key}.osm.pbf")
            mb = os.path.getsize(p) / 2**20 if os.path.exists(p) else 0
            b["mb"] = round(mb, 1)
            if mb < 2 and object_count(p) == 0:    # empty (ocean): nothing to build
                                                   # (counted, not judged by size: a lone islet is a few KB)
                b["state"] = "empty"
                if os.path.exists(p):
                    os.remove(p)
            elif mb > args.max_mb and b["z"] < TILE_ZOOM - 2:
                z, x, y = b["z"], b["x"], b["y"]
                kids = [(z + 1, 2 * x + dx, 2 * y + dy) for dx in (0, 1) for dy in (0, 1)]
                log(f"{key}: {mb:.0f} MB > {args.max_mb} MB, splitting")
                check_space(mb / 1024 * 1.2)
                extract_children(p, wd, kids, 4)
                for k in kids:
                    blocks[bkey(*k)] = {"z": k[0], "x": k[1], "y": k[2], "state": "extracted"}
                b["state"] = "split"
                os.remove(p)
                changed = True
            else:
                b["state"] = "ready"
            save_state(wd, st)
        if not changed:
            break
    ready = [b for b in blocks.values() if b["state"] == "ready"]
    log(f"{len(ready)} blocks ready, {sum(b['mb'] for b in ready) / 1024:.1f} GB; largest {max((b['mb'] for b in ready), default=0):.0f} MB")


# ── build ──────────────────────────────────────────────────────────────────

def tiles_equal(a, b):
    """Both archives hold the same tiles, compared one tile at a time (they
    come out in tile order; whole archives in memory were GBs per job)."""
    from pmtiles.reader import MmapSource, all_tiles
    import itertools
    with open(a, "r+b") as fa, open(b, "r+b") as fb:
        n = 0
        for ta, tb in itertools.zip_longest(all_tiles(MmapSource(fa)), all_tiles(MmapSource(fb))):
            if ta is None or tb is None or ta[0] != tb[0] or gzip.decompress(ta[1]) != gzip.decompress(tb[1]):
                return False, n
            n += 1
        return True, n


def group_of(b, gz):
    k = b["z"] - gz
    return (gz, b["x"] >> k, b["y"] >> k) if k >= 0 else (b["z"], b["x"], b["y"])


def file_bytes(path):
    return open(path, "rb").read() if os.path.exists(path) else b""


def build_block(wd, b):
    key = bkey(b["z"], b["x"], b["y"])
    src = os.path.join(wd, "blocks", f"{key}.osm.pbf")
    tmp = os.path.join(wd, "tmp", key)
    os.makedirs(tmp, exist_ok=True)
    t0 = time.time()
    check_space(os.path.getsize(src) / 2**30 * 12)     # OPL text is ~8x the pbf, plus two archives
    # node locations onto the ways, then OPL text: pyosmium's own pbf reader
    # corrupted memory part way through big files on this machine
    loc = os.path.join(tmp, "loc.osm.pbf")
    opl = os.path.join(tmp, "in.opl")
    run([OSMIUM, "add-locations-to-ways", "--keep-member-nodes", "-i", "flex_mem", src, "-o", loc, "--overwrite", "--no-progress"])
    run([OSMIUM, "cat", "-f", "opl,add_metadata=false,locations_on_ways=true", loc, "-o", opl, "--overwrite", "--no-progress"])
    os.remove(loc)
    outs = []
    for attempt in range(2):
        a, c = os.path.join(tmp, "a.pmtiles"), os.path.join(tmp, "b.pmtiles")
        for out in (a, c):
            r = run(["/usr/bin/time", "-f", "%M", PY, BUILDER, opl, out, "--opl", "--block", f"{b['z']}/{b['x']}/{b['y']}",
                     "--blocks", os.path.join(wd, "leaves.json")])
            outs.append(int(r.stderr.strip().splitlines()[-1]) // 1024)   # peak MB
        if not os.path.exists(a) and not os.path.exists(c):
            shutil.rmtree(tmp)
            return key, {"state": "empty", "secs": round(time.time() - t0)}
        same, n = tiles_equal(a, c)
        side_a, side_c = a + ".side", c + ".side"
        same = same and file_bytes(side_a) == file_bytes(side_c)
        if same:
            os.makedirs(os.path.join(wd, "built"), exist_ok=True)
            dst = os.path.join(wd, "built", f"{key}.pmtiles")
            os.replace(a, dst)
            if os.path.exists(side_a):
                os.replace(side_a, dst + ".side")
            drop_cache(dst)
            shutil.rmtree(tmp)
            os.remove(src)                     # (built and checked: the extract isn't needed again)
            return key, {"state": "built", "tiles": n, "out_mb": round(os.path.getsize(dst) / 2**20, 1),
                         "peak_mb": max(outs), "secs": round(time.time() - t0), "attempts": attempt + 1}
        log(f"{key}: the two builds differ, building again")
    shutil.rmtree(tmp)
    return key, {"state": "mismatch", "secs": round(time.time() - t0)}


def cmd_build(args):
    wd = args.workdir
    st = load_state(wd)
    todo = [b for b in st["blocks"].values() if b["state"] == "ready" or (args.retry and b["state"] in ("mismatch", "failed"))]
    # zoom-3 group by group, sweeping west to east (column by column), biggest
    # block first inside a group: a group can be published once it and its
    # neighbours are built (features crossing into it come from their owner
    # blocks' side files), and a sweep finishes neighbours close together, so
    # the publisher uploads while the rest builds
    todo.sort(key=lambda b: (group_of(b, START_ZOOM)[1], group_of(b, START_ZOOM)[2], -b.get("mb", 0)))
    if args.only:
        todo = [b for b in todo if bkey(b["z"], b["x"], b["y"]) in args.only.split(",")]
    # every leaf block (the builder writes features into neighbours that hold
    # none of their points: build-osm-tiles.py --blocks)
    leaves = sorted(k for k, b in st["blocks"].items() if b["state"] not in ("split", "extracted"))
    json.dump(leaves, open(os.path.join(wd, "leaves.json"), "w"))
    log(f"building {len(todo)} blocks, {args.jobs} at a time")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futs = {pool.submit(build_block, wd, b): b for b in todo}
        for f in as_completed(futs):
            b = futs[f]
            key = bkey(b["z"], b["x"], b["y"])
            try:
                _, res = f.result()
            except Exception as e:             # (a crash on this machine: retried with --retry)
                res = {"state": "failed", "error": str(e)[-500:]}
            update_state(wd, lambda st, key=key, res=res: st["blocks"][key].update(res))
            log(key, res)


# ── merge ──────────────────────────────────────────────────────────────────

def fold_in(data, extra_elements):
    """A tile with extra elements appended (data None: a tile only side files fill)."""
    body = gzip.decompress(data).decode("utf-8") if data else '{"v":2,"e":[]}'
    head, tail = body[:-2], body[-2:]          # ...]}  (the builder's exact layout)
    assert tail == "]}", "unexpected tile layout"
    sep = "," if not head.endswith("[") else ""
    return gzip.compress((head + sep + ",".join(extra_elements) + tail).encode("utf-8"), compresslevel=9)


def load_side(wd, st, gz):
    """Side files of every built block, grouped by publish archive (features
    owned by one block reaching into tiles of blocks holding none of their
    points). Kept until the end: a block's side lines can belong to a
    neighbouring group published later."""
    side = {}
    for key, b in st["blocks"].items():
        sp = os.path.join(wd, "built", f"{key}.pmtiles.side")
        if b["state"] not in ("built", "merged") or not os.path.exists(sp):
            continue
        with open(sp, encoding="utf-8") as f:
            for line in f:
                xy, el = line.rstrip("\n").split("\t", 1)
                x, y = map(int, xy.split())
                k = TILE_ZOOM - gz
                from pmtiles.tile import zxy_to_tileid
                side.setdefault((gz, x >> k, y >> k), {}).setdefault(zxy_to_tileid(TILE_ZOOM, x, y), []).append(el)
    return side


def merge_group(wd, st, g, keys, extra, delete_built):
    """One archive for group g from its built blocks and side lines; returns its path."""
    from pmtiles.reader import MmapSource, all_tiles
    from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
    from pmtiles.writer import Writer
    os.makedirs(os.path.join(wd, "publish"), exist_ok=True)
    out = os.path.join(wd, "publish", f"planet-{bkey(*g)}-{time.strftime('%Y-%m-%d')}.pmtiles")
    check_space(sum(os.path.getsize(os.path.join(wd, "built", f"{k}.pmtiles")) for k in keys) / 2**30)
    files = [open(os.path.join(wd, "built", f"{key}.pmtiles"), "r+b") for key in keys]

    def stream(f):
        # each archive's tiles come out in tile-id order (checked), so all
        # blocks merge with one tile per block in memory
        last = -1
        for zxy, data in all_tiles(MmapSource(f)):
            tid = zxy_to_tileid(*zxy)
            if tid <= last:
                raise RuntimeError(f"{f.name}: tiles out of order")
            last = tid
            yield tid, zxy, data

    lon0 = lat0 = 1e9
    lon1 = lat1 = -1e9
    count = 0
    with open(out, "wb") as fo:
        w = Writer(fo)
        side_only = ((tid, tileid_to_zxy(tid), None) for tid in sorted(extra))
        last = None
        for tid, (z, x, y), data in heapq.merge(*(stream(f) for f in files), side_only, key=lambda t: t[0]):
            if tid == last:            # (a side-only entry for a tile a block already wrote)
                continue
            last = tid
            if tid in extra:
                data = fold_in(data, extra[tid])
            w.write_tile(tid, data)
            count += 1
            west, south, east, north = tile_bbox(z, x, y)
            lon0, lat0, lon1, lat1 = min(lon0, west), min(lat0, south), max(lon1, east), max(lat1, north)
        w.finalize({
            "tile_type": TileType.UNKNOWN, "tile_compression": Compression.GZIP,
            "min_zoom": TILE_ZOOM, "max_zoom": TILE_ZOOM,
            "min_lon_e7": int(lon0 * 1e7), "min_lat_e7": int(lat0 * 1e7),
            "max_lon_e7": int(lon1 * 1e7), "max_lat_e7": int(lat1 * 1e7),
            "center_zoom": TILE_ZOOM, "center_lon_e7": int((lon0 + lon1) / 2 * 1e7),
            "center_lat_e7": int((lat0 + lat1) / 2 * 1e7),
        }, {
            "name": "mapng-osm", "format": "overpass-json-compact-v2", "source": os.path.basename(st.get("planet", "planet")),
            "zoom": TILE_ZOOM, "group": bkey(*g), "blocks": sorted(keys),
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "attribution": "© OpenStreetMap contributors (ODbL)",
        })
    for f in files:
        f.close()
    drop_cache(out, *(os.path.join(wd, "built", f"{k}.pmtiles") for k in keys))
    if delete_built:
        for key in keys:
            os.remove(os.path.join(wd, "built", f"{key}.pmtiles"))
        update_state(wd, lambda s2: [s2["blocks"][k].update(state="merged") for k in keys])
    log(f"{os.path.basename(out)}: {count} tiles from {len(keys)} blocks, {os.path.getsize(out) / 2**20:.0f} MB")
    return out


def built_groups(st, gz):
    groups = {}
    for key, b in st["blocks"].items():
        if b["state"] == "built":
            groups.setdefault(group_of(b, gz), []).append(key)
    return groups


def cmd_merge(args):
    """Join built blocks into one archive per group-zoom tile. Blocks never share
    a tile, so this is a sort of tile ids, no de-duplication."""
    wd = args.workdir
    st = load_state(wd)
    gz = args.group_zoom
    side = load_side(wd, st, gz)
    groups = built_groups(st, gz)
    for g in side:
        groups.setdefault(g, [])
    for g, keys in sorted(groups.items()):
        merge_group(wd, st, g, keys, side.get(g, {}), args.delete_built)


# Regional archives the planet replaces, by bounding box (w, s, e, n): dropped
# from the manifest once every zoom-3 group they touch is published.
OLD_REGIONS = {
    "arizona": (-114.8224, 31.32659, -109.0437, 37.00596),
    "utah": (-114.0556, 36.9963, -109.0401, 42.00323),
    "florida": (-87.7, 24.4, -79.8, 31.1),
}


def groups_touching(bbox, gz):
    w, s, e, n = bbox
    def xy(lat, lon):
        m = 1 << gz
        x = int((lon + 180) / 360 * m)
        y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * m)
        return min(m - 1, max(0, x)), min(m - 1, max(0, y))
    x0, y0 = xy(n, w)
    x1, y1 = xy(s, e)
    return {(gz, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def cmd_publish(args):
    """Merge and upload each zoom-3 group as soon as it and its neighbours are
    built (side lines from neighbours' owner blocks must be in), while the
    rest builds. --watch repeats until every group is out."""
    wd = args.workdir
    gz = START_ZOOM
    final = ("built", "merged", "empty")
    while True:
        st = load_state(wd)
        leaves = [b for b in st["blocks"].values() if b["state"] not in ("split",)]
        pending = {group_of(b, gz) for b in leaves if b["state"] not in final}
        published = st.get("published", {})
        groups = built_groups(st, gz)
        side = None
        did = False
        for g in sorted(set(groups) | set()):
            if bkey(*g) in published:
                continue
            gx, gy = g[1], g[2]
            near = {(gz, gx + dx, gy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
            if near & pending:
                continue
            if side is None:
                side = load_side(wd, st, gz)
            out = merge_group(wd, st, g, groups[g], side.get(g, {}), True)
            published_now = {**published, bkey(*g): True}
            drop = [r for r, bbox in OLD_REGIONS.items()
                    if r not in st.get("dropped", []) and all(bkey(*t) in published_now for t in groups_touching(bbox, gz))]
            cmd = [PY, os.path.join(REPO, "scripts", "publish-osm-tiles.py"), out, "--tile", f"{g[0]}/{g[1]}/{g[2]}"]
            for r in drop:
                cmd += ["--drop-region", r]
            r = run(cmd)
            log(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else f"published {out}")
            def mark(s2, g=g, drop=drop):
                s2.setdefault("published", {})[bkey(*g)] = True
                s2["dropped"] = sorted(set(s2.get("dropped", [])) | set(drop))
            update_state(wd, mark)
            os.remove(out)                      # (uploaded and listed; R2 holds it now)
            published = load_state(wd).get("published", {})
            did = True
        st = load_state(wd)
        # groups with only side lines (no built block of their own) are rare: merged at the end
        if not args.watch:
            break
        if not [b for b in st["blocks"].values() if b["state"] not in final + ("split",)] and not did and not built_groups(st, gz):
            log("everything published")
            break
        if not did:
            time.sleep(300)


def cmd_status(args):
    print(f"free: {free_gb():.0f} GB (C: and WSL), stops under {MIN_FREE_GB:.0f} GB")
    st = load_state(args.workdir)
    by = {}
    for b in st["blocks"].values():
        by.setdefault(b["state"], []).append(b)
    for k, v in sorted(by.items()):
        extra = ""
        if k == "built":
            extra = f", {sum(b['out_mb'] for b in v) / 1024:.1f} GB out, peak RAM {max(b['peak_mb'] for b in v)} MB"
        if k in ("ready", "built"):
            extra += f", {sum(b.get('mb', 0) for b in v) / 1024:.1f} GB in"
        print(f"{k:9s} {len(v):4d}{extra}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("filter"); p.add_argument("planet"); p.add_argument("workdir"); p.add_argument("--delete-planet", action="store_true")
    p = sub.add_parser("split"); p.add_argument("workdir"); p.add_argument("--max-mb", type=float, default=600); p.add_argument("--batch", type=int, default=16); p.add_argument("--keep-filtered", action="store_true")
    p = sub.add_parser("build"); p.add_argument("workdir"); p.add_argument("--jobs", type=int, default=4); p.add_argument("--retry", action="store_true"); p.add_argument("--only")
    p = sub.add_parser("merge"); p.add_argument("workdir"); p.add_argument("--group-zoom", type=int, default=3); p.add_argument("--delete-built", action="store_true")
    p = sub.add_parser("publish"); p.add_argument("workdir"); p.add_argument("--watch", action="store_true")
    p = sub.add_parser("status"); p.add_argument("workdir")
    args = ap.parse_args()
    roots = [args.workdir] + ([args.planet] if getattr(args, "planet", None) else [])
    if args.cmd != "status":
        start_cache_trimmer(*roots)
    {"filter": cmd_filter, "split": cmd_split, "build": cmd_build, "merge": cmd_merge, "publish": cmd_publish, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
