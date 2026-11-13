// The level script behind the export's Road surfaces > Hero Roads (experimental) choice: written into the level as
// mapngHeroRoads.lua and run by its mainLevel.lua (exportBeamNGLevel.js). Tried in game 2026-11-13 (BeamNG 0.40):
// the Hero Road Editor's own code builds the roads with the World Editor closed.
export const HERO_ROADS_FILE = 'mapngHeroRoads.lua';
export const HERO_ROADS_LUA = String.raw`-- MapNG: Hero Roads (experimental). Written into a level as levels/<name>/mapngHeroRoads.lua when the export's
-- "Road surfaces" choice is Hero Roads; the level's mainLevel.lua loads it and calls it every frame.
--
-- It turns MapNG's paved road surfaces (the DecalRoads named dr_..._b) into BeamNG Hero Roads: a real road
-- mesh with a crown, shoulders and its own markings, built by the game's Hero Road Editor code. The roads are
-- built a few each frame after the level has loaded, and removed when the level is left: they are not saved.
-- MapNG's own DecalRoads stay underneath (traffic and the minimap read them).
--
-- From the console: dump(mainLevel.heroRoads().status()), mainLevel.heroRoads().rebuild(), mainLevel.heroRoads().remove().
local M = {}

local PER_FRAME = 3            -- roads built a frame
local NODE_GAP_M = 6           -- a Hero Road node about this often along MapNG's line
local SHOULDER_M = 0.3
local OVER_GROUND_M = 1.0      -- a line this far over the terrain is a bridge deck or ramp: left as it is
local MIN_WIDTH_M = 3.0

local gm = nil
local queue, at = nil, 0
local built, skipped, failed = 0, 0, 0
local firstError = nil
local started, done = false, false
local t0 = 0

local function say(msg, ttl)
  if ui_message then ui_message(msg, ttl or 4, 'mapngHeroRoads') end
end

local function paved(road)
  local mat = tostring(road:getField('material', 0) or ''):lower()
  return mat:find('asphalt', 1, true) ~= nil or mat:find('concrete', 1, true) ~= nil
end

local function collect()
  local list = {}
  for _, name in ipairs(scenetree.findClassObjects('DecalRoad') or {}) do
    if name:match('^dr_.*_b$') then list[#list + 1] = name end
  end
  table.sort(list)
  return list
end

-- One MapNG road surface -> one Hero Road as wide as it, or nil and why.
local function buildOne(name)
  local road = scenetree.findObject(name)
  if not road or road:getNodeCount() < 2 then return nil, 'too short' end
  if not paved(road) then return nil, 'not paved' end
  local n = road:getNodeCount()
  local width = road:getNodeWidth(math.floor(n / 2))
  if width < MIN_WIDTH_M then return nil, 'narrow' end
  local nodes, last = {}, nil
  for i = 0, n - 1 do
    local p = road:getNodePosition(i)
    local ground = core_terrain.getTerrainHeight(vec3(p.x, p.y, 0))
    if ground and p.z - ground > OVER_GROUND_M then return nil, 'off the ground' end
    if not last or (p - last):length() >= NODE_GAP_M or i == n - 1 then
      -- (the last node is always kept; one that would sit almost on the node before it replaces it)
      if i == n - 1 and last and #nodes > 1 and (p - last):length() < NODE_GAP_M * 0.4 then nodes[#nodes] = nil end
      nodes[#nodes + 1] = vec3(p.x, p.y, ground or p.z)
      last = p
    end
  end
  if #nodes < 2 then return nil, 'too short' end

  gm.addNewGroup('MapNG ' .. name:sub(4))
  local groups = gm.getGroups()
  local g = groups[#groups]
  gm.applyProfilePreset(g, width >= 13 and 'highway' or 'city')
  local lanesEachWay = width >= 13 and 2 or 1
  g.shoulderWidthM = SHOULDER_M
  g.nodes, g.widths, g.nmls = nodes, {}, {}
  for i = 1, #nodes do g.widths[i] = width; g.nmls[i] = vec3(0, 0, 1) end
  -- (the lanes carry the width: the editor's code works the deck out from lanes and shoulders)
  gm.setLaneProfile(g, lanesEachWay, lanesEachWay, math.max(1.5, (width - 2 * SHOULDER_M) / (2 * lanesEachWay)))
  g.geometryMode = 'spline'    -- MapNG's line is already the shape wanted; no re-engineered curves
  gm.ensureCornerArray(g)
  g.isDirty = true
  return g
end

local function start()
  local ok, mod = pcall(require, 'editor/heroRoadEditor/groupMgr')
  if not ok or not mod then
    done = true
    log('E', 'mapngHeroRoads', 'The Hero Road Editor code did not load; the level keeps its decal roads. ' .. tostring(mod))
    say('MapNG: Hero Roads are not available in this game version; the level keeps its normal roads.', 10)
    return
  end
  gm = mod
  -- (two editor helpers the road code calls; they exist only once the World Editor has been opened)
  editor = editor or {}
  if not editor.setDirty then editor.setDirty = function() end end
  if not editor.getNodes then
    editor.getNodes = function(road)
      local t = {}
      for i = 0, road:getNodeCount() - 1 do t[#t + 1] = { pos = road:getNodePosition(i), width = road:getNodeWidth(i), depth = road:getNodeDepth(i) } end
      return t
    end
  end
  queue, at, built, skipped, failed, firstError = collect(), 0, 0, 0, 0, nil
  t0 = os.clock()
  log('I', 'mapngHeroRoads', string.format('Building Hero Roads from %d MapNG road surfaces', #queue))
  say(string.format('MapNG: building Hero Roads (0/%d)...', #queue), 6)
end

local function step()
  local made = 0
  while at < #queue and made < PER_FRAME do
    at = at + 1
    local ok, g, why = pcall(buildOne, queue[at])
    if not ok then failed = failed + 1; firstError = firstError or tostring(g)
    elseif g then made = made + 1
    else skipped = skipped + 1 end
  end
  if made > 0 then
    local ok, err = pcall(gm.updateDirtyGroups, false)
    if ok then built = built + made else failed = failed + made; firstError = firstError or tostring(err) end
  end
  if at % 30 < PER_FRAME then say(string.format('MapNG: building Hero Roads (%d/%d)...', at, #queue), 6) end
  if at >= #queue then
    done = true
    local msg = string.format('MapNG: %d Hero Roads built in %.0f s (%d left as they were, %d failed)', built, os.clock() - t0, skipped, failed)
    log(failed > 0 and 'W' or 'I', 'mapngHeroRoads', msg .. (firstError and (' | first error: ' .. firstError) or ''))
    say(msg, 10)
  end
end

local function remove()
  if gm then pcall(gm.removeAllGroups, true) end
  queue, at, started, done = nil, 0, true, true
end

M.onUpdate = function()
  if done then return end
  if not started then
    if core_gamestate.loading() or not scenetree.MissionGroup then return end
    started = true
    start()
    return
  end
  if queue then step() end
end

M.status = function() return { started = started, done = done, total = queue and #queue or 0, at = at, built = built, skipped = skipped, failed = failed, firstError = firstError } end
M.remove = remove
M.rebuild = function() remove(); started, done = false, false end

return M
`;
