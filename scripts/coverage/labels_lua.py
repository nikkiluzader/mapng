# The coverage level's in-game labels: every plot and structure of the plan, as a Lua table for ingame_labels.lua.
#   python3 scripts/coverage/labels_lua.py <area> <out.lua>
import json, sys
area, out = sys.argv[1], sys.argv[2]
plan = json.load(open(f'scratch/levelprobe/data/{area}/coverage_plan.json'))['placed']
rows = []
for i, q in enumerate(plan):
    x, y = q.get('plot') or q['at']
    rows.append('{x=%d, y=%d, t=%s}' % (x, y, json.dumps(f"{i} {q['what']}")))
open(out, 'w').write('covLabels = {\n' + ',\n'.join(rows) + '\n}\n')
print(len(rows), 'labels')
