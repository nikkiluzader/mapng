-- The coverage level's in-game tour (scripts/coverage/README.md): one framed shot per target of
-- /covtour/targets.lua (made by tour_targets.py), saved as /screenshots/mcp/cov/NNN.jpg; a log in /covtour/log.tsv.
-- The sun is held at noon (TimeOfDay play off) so every shot has the same light; the simulation keeps running,
-- so turbines turn and water moves. Each spot takes about half a second.
loadstring(readFile('/covtour/targets.lua'))()
covTourLog = {}
local statics = {}
for _, n in ipairs(scenetree.findClassObjects('TSStatic')) do local o = scenetree.findObject(n); if o then statics[#statics + 1] = o end end
local function boxOf(t)
  if t.kind ~= 'model' then return nil end
  local p = vec3(t.x, t.y, t.z); local best, bd = nil, 0.6
  for _, o in ipairs(statics) do local d = (o:getPosition() - p):length(); if d < bd then best, bd = o, d end end
  if not best then return nil end
  local b = best:getWorldBox(); return { c = (b.minExtents + b.maxExtents) * 0.5, r = (b.maxExtents - b.minExtents):length() * 0.5 }
end
-- a driver's view: eye height over the road at (x, y), looking along the heading; the road found by a ray down from
-- above (a deck, an open road) or up from below (a tunnel's floor, under the hill)
local function driverView(t)
  local p, hit
  if t.find == 'up' then
    p = vec3(t.x, t.y, -200); hit = castRayStatic(p, vec3(0, 0, 1), 600)
    if hit then p = vec3(t.x, t.y, -200 + hit) end
  else
    p = vec3(t.x, t.y, 1000); hit = castRayStatic(p, vec3(0, 0, -1), 1200)
    if hit then p = vec3(t.x, t.y, 1000 - hit) end
  end
  if not hit then p = vec3(t.x, t.y, core_terrain.getTerrainHeight(vec3(t.x, t.y, 0)) or 0) end
  local cam = p + vec3(0, 0, 1.4)
  local dir = vec3(math.cos(t.heading), math.sin(t.heading), -0.03):normalized()
  core_camera.setPosition(0, cam); core_camera.setRotation(0, quatFromDir(dir, vec3(0, 0, 1)))
  return 'driver', cam, 0
end
local function frame(t)
  if t.kind == 'driver' then return driverView(t) end
  local gz = core_terrain.getTerrainHeight(vec3(t.x, t.y, 0)) or 20
  local c, r = vec3(t.x, t.y, t.z or gz), 4
  local bx = boxOf(t); if bx then c, r = bx.c, math.max(0.8, bx.r) end
  local dist = t.dist or math.max(5, r * 2.6 + 3)
  local pitch = math.rad(35)
  local yaws = t.yaw and { t.yaw } or { 0, -35, 35, -90, 90, 180, -135, 135 }
  local chosen, cam
  for _, ydeg in ipairs(yaws) do
    local yaw = math.rad(ydeg)
    local back = vec3(-math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))
    local pos = c + back * dist
    local cg = core_terrain.getTerrainHeight(vec3(pos.x, pos.y, 0)) or -1000
    if pos.z < cg + 2 then pos.z = cg + 2 end
    local dir = (c - pos); local L = dir:length(); dir = dir / L
    local hit = castRayStatic(pos, dir, L)
    if not hit or hit >= L - r - 0.5 or t.yaw then chosen, cam = ydeg, pos; if not hit or hit >= L - r - 0.5 then break end end
  end
  if not cam then local yaw = math.rad(yaws[1]); cam = c + vec3(-math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)) * dist; chosen = 'blocked' end
  core_camera.setPosition(0, cam); core_camera.setRotation(0, quatFromDir((c - cam):normalized(), vec3(0, 0, 1)))
  return chosen, cam, dist
end
core_environment.setTimeOfDay({ time = 0, play = false })
core_jobsystem.create(function(job)
  for i, t in ipairs(covTargets) do
    local y, cam, dist = frame(t)
    job.sleep(0.3)
    local name = string.format('%03d', i)
    screenshot.doScreenshot(nil, false, '/screenshots/mcp/cov/' .. name, 'jpg')
    covTourLog[#covTourLog + 1] = string.format('%s\t%s\t%s\t%.0f %.0f %.0f\t%s\t%.0f', name, t.kind, t.label, cam.x, cam.y, cam.z, tostring(y), dist)
    job.sleep(0.2)
  end
  writeFile('/covtour/log.tsv', table.concat(covTourLog, '\n'))
  covTourDone = true
end)
