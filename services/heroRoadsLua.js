// The level script behind the export's Road surfaces > Hero Roads (experimental) choice: written into the level as
// mapngHeroRoads.lua and run by its mainLevel.lua (exportBeamNGLevel.js). Tried in game 2026-11-13 (BeamNG 0.40):
// the Hero Road Editor's own code builds the roads with the World Editor closed.
export const HERO_ROADS_FILE = 'mapngHeroRoads.lua';
export const HERO_ROADS_LUA = String.raw`-- MapNG: Hero Roads (experimental). Written into a level as levels/<name>/mapngHeroRoads.lua when the export's
-- "Road surfaces" choice is Hero Roads; the level's mainLevel.lua loads it and calls it every frame.
--
-- It turns MapNG's paved road surfaces (the DecalRoads named dr_..._b) into BeamNG Hero Roads: a real road
-- mesh with a crown and shoulders, built by the game's Hero Road Editor code. The markings stay MapNG's own:
-- the Hero Road's lines are switched off (it knows one style, the USA's: a tester's French mountain road got
-- double yellow lines) and MapNG's lines, cut at junctions and drawn by each country's rules, are lifted onto
-- the road's surface. The roads are
-- built a few each frame after the level has loaded, and removed when the level is left.
--
-- They are ordinary, unbaked Hero Roads: open the World Editor (F11) > Hero Road and they are there to edit.
-- They are not saved with the level: each load builds them again from MapNG's roads. To keep edits, use the
-- editor's own Save Session and Bake.
--
-- Hero Roads carry nothing for traffic: the game's road map (lua/ge/map.lua) is read from DecalRoads that are
-- drivable, and every decal a Hero Road makes is marked not drivable. So MapNG's DecalRoads stay in the level
-- as the roads traffic, navigation and the minimap follow, but under a Hero Road they are hidden: not drawn,
-- still read (tried in game: the road map is the same with them hidden).
--
-- From the console: dump(mainLevel.heroRoads().status()), mainLevel.heroRoads().rebuild(), mainLevel.heroRoads().remove().
local M = {}

local PER_FRAME = 12           -- roads built a frame
local RELOAD_EVERY = 120       -- the level's collision taken up again after this many roads (and at the end)
local NODE_GAP_M = 4           -- a Hero Road node about this often along MapNG's line
local SHOULDER_M = 0.3
local OVER_GROUND_M = 1.0      -- a line this far over or under the terrain is a bridge deck, ramp or tunnel: left as it is
local MIN_WIDTH_M = 3.0
local LON_PIECES = 4            -- mesh pieces along each stretch between two nodes (a node every 4 m)
local LINE_OVER_DECK_M = 0.02   -- MapNG's painted lines over the Hero Road's surface
local CLEAR_M = 0.03           -- the deck's lowest edge over the highest ground under it

local gm = nil
local queue, at = nil, 0
local built, skipped, failed = 0, 0, 0
local lanesSeen = {}           -- 'forward+backward' -> roads, for status()
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

-- A road surface's lanes: forward, backward, left-hand traffic. Without MapNG's note (a level from an older
-- MapNG): one lane each way, two on a road 13 m wide or more.
local function lanesOf(road, width)
  local ok, note = pcall(function() return road:getField('mapngLanes', 0) end)
  if (not ok or not note or note == '') then ok, note = pcall(function() return road.mapngLanes end) end
  local f, b, lht = tostring(ok and note or ''):match('^(%d+) (%d+) (%d)')
  f, b = tonumber(f), tonumber(b)
  if not f or f + b < 1 then local n = width >= 13 and 2 or 1; return n, n, false end
  return f, b, lht == '1'
end

local layersOf = {}            -- 'dr_<road>_s<n>_' -> the names of that road's DecalRoad layers
local hiddenByUs = {}          -- the layers this script hid (shown again when the Hero Roads are removed)

-- MapNG's painted lines along a road: centre (cl), edges (ell, elr), lanes (l2, l3...), whole or cut in pieces.
local lineNames = {}
local lifted = {}             -- { name, over, z = { node heights before } }: put back when the Hero Roads go
local function lineLayer(name)
  local layer = name:match('^dr_.*_s%d+_([a-z]+%d*)')
  return layer ~= nil and (layer == 'cl' or layer == 'ell' or layer == 'elr' or layer:match('^l%d+$') ~= nil)
end

-- The lines lifted onto the Hero Roads under them. A DecalRoad is drawn on the ground at its nodes' height; the
-- deck lies some centimetres over that, so each node over a deck is raised to the deck's surface and the line
-- is told to drape over objects. A line with no deck under it (a bridge, a road left as it was) is not touched.
local function liftLines()
  local n = 0
  for _, name in ipairs(lineNames) do
    local o = scenetree.findObject(name)
    if o then
      local before, any = {}, false
      for i = 0, o:getNodeCount() - 1 do
        local p = o:getNodePosition(i)
        before[i + 1] = p.z
        local hit = castRay(vec3(p.x, p.y, p.z + 2), vec3(p.x, p.y, p.z - 2), true, true)
        if hit and hit.pt and hit.obj and hit.obj:getClassName() == 'ProceduralMesh' then
          o:setNodePosition(i, vec3(p.x, p.y, hit.pt.z + LINE_OVER_DECK_M)); any = true
        end
      end
      if any then
        lifted[#lifted + 1] = { name = name, over = o:getField('overObjects', 0), z = before }
        o:setField('overObjects', 0, '1')
        n = n + 1
      end
    end
  end
  return n
end

local function collect()
  local list = {}
  layersOf = {}
  lineNames = {}
  for _, name in ipairs(scenetree.findClassObjects('DecalRoad') or {}) do
    if name:match('^dr_.*_b$') then list[#list + 1] = name end
    local prefix, layer = name:match('^(dr_.*_s%d+_)(%w+)$')
    -- (only the surface is hidden under a Hero Road: b, or b1, b2... where it is paved in strips. The lines
    -- are lifted onto the deck below, the grass blends lie outside it, the AI path is what traffic follows)
    if prefix and layer:match('^b%d*$') then
      layersOf[prefix] = layersOf[prefix] or {}
      table.insert(layersOf[prefix], name)
    end
    if lineLayer(name) then lineNames[#lineNames + 1] = name end
  end
  table.sort(list)
  return list
end

-- MapNG's own surface and paint for a road that now has a Hero Road: hidden, kept for traffic.
local function hideLayers(baseName)
  local prefix = baseName and baseName:match('^(dr_.*_s%d+_)b$')
  for _, name in ipairs(prefix and layersOf[prefix] or {}) do
    local o = scenetree.findObject(name)
    if o and not o.hidden then o.hidden = true; hiddenByUs[#hiddenByUs + 1] = name end
  end
end

local function groundAt(x, y) return core_terrain.getTerrainHeight(vec3(x, y, 0)) end

-- One MapNG road surface -> one Hero Road as wide as it, or nil and why.
local function buildOne(name)
  local road = scenetree.findObject(name)
  if not road or road:getNodeCount() < 2 then return nil, 'too short' end
  if not paved(road) then return nil, 'not paved' end
  local n = road:getNodeCount()
  local width = road:getNodeWidth(math.floor(n / 2))
  if width < MIN_WIDTH_M then return nil, 'narrow' end
  local half = width / 2

  -- MapNG's line, thinned to a node every few metres
  local line, last = {}, nil
  for i = 0, n - 1 do
    local p = road:getNodePosition(i)
    local ground = groundAt(p.x, p.y)
    -- (a bridge deck or ramp over the ground, or a tunnel under it: a long mountain tunnel's road was rebuilt
    -- on top of the mountain before this looked both ways)
    if ground and math.abs(p.z - ground) > OVER_GROUND_M then return nil, 'not on the ground' end
    if not last or (p - last):length() >= NODE_GAP_M or i == n - 1 then
      -- (the last node is always kept; one that would sit almost on the node before it replaces it)
      if i == n - 1 and last and #line > 1 and (p - last):length() < NODE_GAP_M * 0.4 then line[#line] = nil end
      line[#line + 1] = vec3(p.x, p.y, ground or p.z)
      last = p
    end
  end
  if #line < 2 then return nil, 'too short' end

  gm.addNewGroup('MapNG ' .. name:sub(4))
  local groups = gm.getGroups()
  local g = groups[#groups]
  -- The lanes each way are OpenStreetMap's (MapNG writes them on the road surface as "forward backward
  -- left-hand tagged"); the width is MapNG's, which is the mapped or measured one where there is one.
  local forward, backward, leftHand = lanesOf(road, width)
  local lanesLeft, lanesRight = backward, forward
  if leftHand then lanesLeft, lanesRight = forward, backward end
  local total = lanesLeft + lanesRight
  gm.applyProfilePreset(g, total >= 4 and 'highway' or 'city')
  g.shoulderWidthM = SHOULDER_M

  -- The deck's height. A Hero Road is a mesh over the ground, highest along its crown and falling to its edges:
  -- set at the centre line's ground height it lay under the terrain wherever the ground is not dead level
  -- across the road (a BeamNG developer's hill road, 2026-11-13: "most of them are under terrain"). Each node
  -- takes the highest ground across the road's width there, plus what the crown and shoulders fall by, so the
  -- deck's lowest edge clears the ground.
  local fall = half * math.abs(tonumber(g.crossfallPct) or 2.5) / 100 + SHOULDER_M * math.abs(tonumber(g.shoulderFallPct) or 6) / 100
  local nodes = {}
  for i = 1, #line do
    local a, b = line[math.max(1, i - 1)], line[math.min(#line, i + 1)]
    local dx, dy = b.x - a.x, b.y - a.y
    local len = math.sqrt(dx * dx + dy * dy)
    local nx, ny = 0, 0
    if len > 0.01 then nx, ny = -dy / len, dx / len end
    local top = line[i].z
    for _, o in ipairs({ -1, -0.5, 0.5, 1 }) do
      local h = groundAt(line[i].x + nx * half * o, line[i].y + ny * half * o)
      if h and h > top and h - line[i].z < OVER_GROUND_M * 2 then top = h end
    end
    nodes[i] = vec3(line[i].x, line[i].y, top + fall + CLEAR_M)
  end

  g.nodes, g.widths, g.nmls = nodes, {}, {}
  for i = 1, #nodes do g.widths[i] = width; g.nmls[i] = vec3(0, 0, 1) end
  -- (the lanes carry the width: the editor's code works the deck out from lanes and shoulders)
  gm.setLaneProfile(g, lanesLeft, lanesRight, math.max(1.5, (width - 2 * SHOULDER_M) / total))
  -- (no lines of the Hero Road's own: MapNG's are lifted onto it, liftLines)
  g.isRoadCenterLine, g.isRoadEdgeLines, g.isRoadLaneLines = false, false, false
  g.geometryMode = 'spline'    -- MapNG's line is already the shape wanted; no re-engineered curves
  -- The mesh's density. The editor's own defaults are 100 pieces along each stretch between two nodes and 16
  -- across each side, meant for a road drawn by hand with a node every 50 m. MapNG gives a node every 4 m, so
  -- that was a hundred times the triangles wanted: minutes to build and, on a tester's 0.3.1-dev.4 map, a GPU
  -- that stopped responding. A piece a metre along, and a metre or so across.
  g.lonRes = LON_PIECES
  g.latRes = math.max(2, math.min(8, math.ceil(width / 2 / 1.2)))
  g.mapngSource = name         -- (which MapNG road it stands for)
  gm.ensureCornerArray(g)
  g.isDirty = true
  local key = forward .. '+' .. backward
  lanesSeen[key] = (lanesSeen[key] or 0) + 1
  return g
end

-- Build the roads marked dirty. The editor's code has the engine take up the whole level's collision again after
-- every single road (a tenth of a second each time, whatever the road: 716 roads were 148 s of loading, nearly
-- all of it that). While it builds, that one call is held back; reloadCollision() below makes it once for many.
local sinceReload = 0
local linesLifted = 0
local function buildDirty()
  local realBe = be
  be = setmetatable({}, { __index = function(_, k)
    if k == 'reloadCollision' then return function() end end
    local v = realBe[k]
    if type(v) == 'function' then return function(_, ...) return v(realBe, ...) end end
    return v
  end })
  local ok, err = pcall(gm.updateDirtyGroups, false)
  be = realBe
  return ok, err
end
local function reloadCollision() sinceReload = 0; be:reloadCollision() end

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
  queue = collect()
  at, built, skipped, failed, firstError, lanesSeen = 0, 0, 0, 0, nil, {}
  t0 = os.clock()
  log('I', 'mapngHeroRoads', string.format('Building Hero Roads from %d MapNG road surfaces', #queue))
  say(string.format('MapNG: building Hero Roads (0/%d)...', #queue), 6)
end

local function step()
  local made = {}
  while at < #queue and #made < PER_FRAME do
    at = at + 1
    local ok, g, why = pcall(buildOne, queue[at])
    if not ok then failed = failed + 1; firstError = firstError or tostring(g)
    elseif g then made[#made + 1] = g
    else skipped = skipped + 1 end
  end
  if #made > 0 then
    local ok, err = buildDirty()
    if ok then
      built = built + #made
      sinceReload = sinceReload + #made
      if sinceReload >= RELOAD_EVERY then reloadCollision() end
      for _, g in ipairs(made) do hideLayers(g.mapngSource) end
    else failed = failed + #made; firstError = firstError or tostring(err) end
  end
  if at % 30 < PER_FRAME then say(string.format('MapNG: building Hero Roads (%d/%d)...', at, #queue), 6) end
  if at >= #queue then
    done = true
    reloadCollision()
    local okLift, nLines = pcall(liftLines)
    if not okLift then firstError = firstError or tostring(nLines); nLines = 0 end
    linesLifted = nLines
    local msg = string.format('MapNG: %d Hero Roads built in %.0f s (%d left as they were, %d failed)', built, os.clock() - t0, skipped, failed)
    log(failed > 0 and 'W' or 'I', 'mapngHeroRoads', msg .. (firstError and (' | first error: ' .. firstError) or ''))
    say(msg, 10)
  end
end

local function remove()
  if gm then pcall(gm.removeAllGroups, true) end
  for _, name in ipairs(hiddenByUs) do local o = scenetree.findObject(name); if o then o.hidden = false end end
  hiddenByUs = {}
  for _, l in ipairs(lifted) do
    local o = scenetree.findObject(l.name)
    if o then
      for i = 0, math.min(o:getNodeCount(), #l.z) - 1 do local p = o:getNodePosition(i); o:setNodePosition(i, vec3(p.x, p.y, l.z[i + 1])) end
      o:setField('overObjects', 0, tostring(l.over or '0'))
    end
  end
  lifted = {}
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

M.status = function() return { started = started, done = done, total = queue and #queue or 0, at = at, built = built, skipped = skipped, failed = failed, firstError = firstError, lanes = lanesSeen, hiddenLayers = #hiddenByUs, linesLifted = linesLifted } end
M.remove = remove
M.rebuild = function() remove(); started, done = false, false end

return M
`;
