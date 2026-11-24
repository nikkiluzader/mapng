#!/usr/bin/env python3
"""Put the in-game labels into an exported test level: each labelled situation of the area's plan drawn as text over
it, 250 m round the camera, whenever the level is loaded (no MCP needed). Test levels only.

    python3 scripts/coverage/addLabels.py <level.zip> <area>

Adds: lua/ge/extensions/mapngTestLabels.lua (the same in every test zip), scripts/mapng_test_labels/modScript.lua
(loads it with the mod, as BeamNG's modding docs show), levels/<level>/test_labels.json (this level's labels).
In game: mapngTestLabels.toggle() hides or shows them.
"""
import json, re, sys, zipfile, shutil, os

EXT = r'''-- MapNG test levels: labels over each test situation (scripts/coverage/addLabels.py). mapngTestLabels.toggle()
local M = {}
local labels, levelSeen, shown = nil, nil, true
local fg, bg = ColorF(1, 1, 0.3, 1), ColorI(0, 0, 0, 170)
local function load()
  local mission = getMissionFilename and getMissionFilename() or ''
  if mission == levelSeen then return end
  levelSeen, labels = mission, nil
  local dir = mission:match('^(/levels/[^/]+/)')
  if not dir or not FS:fileExists(dir .. 'test_labels.json') then return end
  labels = jsonReadFile(dir .. 'test_labels.json')
end
local function onPreRender()
  load()
  if not labels or not shown then return end
  local cam = core_camera.getPosition()
  for _, l in ipairs(labels) do
    local dx, dy = l.x - cam.x, l.y - cam.y
    if dx * dx + dy * dy < 62500 then
      l.z = l.z or ((core_terrain.getTerrainHeight(vec3(l.x, l.y, 0)) or 0) + 6)
      debugDrawer:drawTextAdvanced(vec3(l.x, l.y, l.z), String(l.t), fg, true, false, bg)
    end
  end
end
M.toggle = function() shown = not shown; return shown end
M.onPreRender = onPreRender
return M
'''
MODSCRIPT = 'setExtensionUnloadMode("mapngTestLabels", "manual")\nextensions.load("mapngTestLabels")\n'

def main():
    zpath, area = sys.argv[1], sys.argv[2]
    plan = json.load(open(f'scratch/levelprobe/data/{area}/coverage_plan.json'))['placed']
    # (driver's views are tour stops, not labels)
    labels = [{'x': (q.get('plot') or q['at'])[0], 'y': (q.get('plot') or q['at'])[1], 't': f"{i} {q['what']}"} for i, q in enumerate(plan) if q.get('kind') != 'driver']
    with zipfile.ZipFile(zpath) as z:
        level = next(n.split('/')[1] for n in z.namelist() if re.match(r'levels/[^/]+/info\.json$', n))
    with zipfile.ZipFile(zpath, 'a', zipfile.ZIP_DEFLATED) as z:
        have = set(z.namelist())
        for name, data in [('lua/ge/extensions/mapngTestLabels.lua', EXT), ('scripts/mapng_test_labels/modScript.lua', MODSCRIPT),
                           (f'levels/{level}/test_labels.json', json.dumps(labels))]:
            if name in have: continue
            z.writestr(name, data)
    print(f'{zpath}: {len(labels)} labels for {level}')

if __name__ == '__main__':
    main()
