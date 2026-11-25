# Aim each labelled spot's tour camera down the street nearest to it (ingame_tour.lua: yaw puts the camera at
# (-sin yaw, -cos yaw) from the spot, 35 degrees up): the street and its sidewalks run up the middle of the shot.
#   python aim.py <area dir> [dist]
import json, math, sys
d = sys.argv[1]; DIST = float(sys.argv[2]) if len(sys.argv) > 2 else 30
meta = json.load(open(f'{d}/meta.json')); feats = json.load(open(f'{d}/osm.json')); plan = json.load(open(f'{d}/coverage_plan.json'))
lat0, lng0 = meta['center']['lat'], meta['center']['lng']; kx = 111320 * math.cos(math.radians(lat0)); ky = 111320
segs = []
for f in feats:
    t = f.get('tags') or {}
    if not t.get('highway') or not f.get('geometry') or len(f['geometry']) < 2: continue
    pts = [((p['lng'] - lng0) * kx, (p['lat'] - lat0) * ky) for p in f['geometry']]
    road = t['highway'] not in ('footway', 'path', 'steps', 'cycleway', 'bridleway')
    for a, b in zip(pts, pts[1:]): segs.append((a, b, road))
aimed = 0
for q in plan['placed']:
    if q.get('kind') != 'structure': continue
    x, y = q['at']; best = None
    for a, b, road in segs:
        dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
        f = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); dd = math.hypot(a[0] + dx * f - x, a[1] + dy * f - y) + (0 if road else 3)
        if dd < 20 and (best is None or dd < best[0]): best = (dd, dx, dy)
    if best:
        L = math.hypot(best[1], best[2]); q['tour'] = [DIST, round(math.degrees(math.atan2(best[1] / L, best[2] / L)), 1)]; aimed += 1
json.dump(plan, open(f'{d}/coverage_plan.json', 'w'), indent=1); print(aimed, 'spots aimed down their street')
