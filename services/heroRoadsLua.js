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
-- The first time the level is opened the roads are built and then baked with the editor's own Bake: each
-- becomes mesh files with levels of detail under the level's art/heroRoad folder (in the game's user folder),
-- and this script writes a list of them there. Every load after that places those meshes: no rebuilding.
-- To edit the roads in the World Editor (F11) > Hero Road: mainLevel.heroRoads().edit() in the console builds
-- them again as live, unbaked Hero Roads for this session; use the editor's own Save Session to keep edits.
--
-- Hero Roads carry nothing for traffic: the game's road map (lua/ge/map.lua) is read from DecalRoads that are
-- drivable, and every decal a Hero Road makes is marked not drivable. So MapNG's DecalRoads stay in the level
-- as the roads traffic, navigation and the minimap follow, but under a Hero Road they are hidden: not drawn,
-- still read (tried in game: the road map is the same with them hidden).
--
-- From the console: dump(mainLevel.heroRoads().status()), and mainLevel.heroRoads().rebuild() (build and bake
-- again), .edit() (live roads to edit), .remove() (MapNG's own roads back for this session).
local M = {}

local PER_FRAME = 12           -- roads built a frame
local RELOAD_EVERY = 120       -- the level's collision taken up again after this many roads (and at the end)
local NODE_GAP_M = 4           -- MapNG's line is read about this often
-- A Hero Road is a spline through its nodes, so it needs a node only where the road's shape changes (a BeamNG
-- developer, 2026-11-14: "way too many points... you get smooth roads with less nodes"). Of the points read,
-- a node is kept where leaving it out would move the line this far sideways or in height, and at least this often.
-- In height the line may only pass over a point left out, never under it: the nodes either side are raised
-- by what it would have passed under.
local THIN_SIDE_M = 0.08
local THIN_HEIGHT_M = 0.06
local THIN_GAP_M = 24
-- MapNG cuts a road at every junction; the same tester's map was "over 400 roads" in the editor's list. Pieces
-- that run on into each other (end on end, the same width and lanes, no more than this much of a turn) are
-- built as one Hero Road, up to about this length. A piece drawn the other way round is read backwards.
local JOIN_TURN_COS = 0.906    -- 25 degrees
local JOIN_END_M = 0.5
local JOIN_WIDTH_M = 0.15
local JOIN_LENGTH_M = 1500
local SHOULDER_M = 0.3
local OVER_GROUND_M = 1.0      -- a line this far over or under the terrain is a bridge deck, ramp or tunnel: left as it is
local MIN_WIDTH_M = 3.0
local LON_PIECES = 4            -- mesh pieces along each stretch between two nodes (a node every 4 m)
local LINE_OVER_DECK_M = 0.02   -- MapNG's painted lines over the Hero Road's surface
local CLEAR_M = 0.03           -- the deck's lowest edge over the highest ground under it
local BAKE_FRAME_S = 0.03      -- baking goes on for about this long each frame
local PLACE_PER_FRAME = 60     -- baked meshes placed a frame on a later load
local BUILD = '__MAPNG_BUILD__' -- (this export's own mark: a bake from another export of the level is not used)
local BAKED_GROUP = 'MapNG_HeroRoads_baked'

local gm = nil
local queue, at = nil, 0
local built, skipped, failed = 0, 0, 0
local surfaces, nodesRead, nodesKept = 0, 0, 0
local lanesSeen = {}           -- 'forward+backward' -> roads, for status()
local firstError = nil
local started, done = false, false
local phase = nil              -- 'build' | 'bake' | 'place'
local live = false             -- edit(): live roads this session, no bake
local bakedState = nil         -- what was read from or is being written to the list of baked meshes
local bakeAt, baked, bakeFailed = 0, 0, 0
local placeAt = 0
local fromBake = false
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
local function lanesNote(road)
  local ok, note = pcall(function() return road:getField('mapngLanes', 0) end)
  if (not ok or not note or note == '') then ok, note = pcall(function() return road.mapngLanes end) end
  return ok, note
end
local function lanesOf(road, width)
  local ok, note = lanesNote(road)
  local f, b, lht = tostring(ok and note or ''):match('^(%d+) (%d+) (%d)')
  f, b = tonumber(f), tonumber(b)
  if not f or f + b < 1 then local n = width >= 13 and 2 or 1; return n, n, false, nil end
  -- (the fifth number: the width of the driving lanes together; levels from before 0.3.1-dev.10 have none)
  local driving = tonumber(tostring(note):match('^%d+ %d+ %d %d ([%d%.]+)'))
  if driving and (driving < 2 or driving > width + 0.01) then driving = nil end
  return f, b, lht == '1', driving
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
local function isDeck(obj)
  local class = obj:getClassName()
  if class == 'ProceduralMesh' then return true end
  if class ~= 'TSStatic' then return false end
  local name = tostring(obj:getName() or '')
  return name:find('^HeroRoadBaked_') ~= nil or name:find('^MapNGHeroRoad_') ~= nil
end
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
        if hit and hit.pt and hit.obj and isDeck(hit.obj) then
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

-- A lanes note read the other way along the road: forward and backward change places.
local function swappedNote(note)
  local f, b, rest = note:match('^(%d+) (%d+)(.*)$')
  if not f then return note end
  return b .. ' ' .. f .. rest
end

-- The road surfaces in the runs they are built in: pieces that run on into each other, one after the other,
-- each { name, reversed }. Every piece has two ends (1 its start, 2 its end); two ends are joined only when
-- each is the other's straightest way on, so at a fork neither branch is taken.
local function joinRuns(list)
  local info, cells = {}, {}
  for _, name in ipairs(list) do
    local r = scenetree.findObject(name)
    local n = r and r:getNodeCount() or 0
    if n >= 2 then
      local a, a2, z2, z = r:getNodePosition(0), r:getNodePosition(1), r:getNodePosition(n - 2), r:getNodePosition(n - 1)
      local da, dz = a - a2, z - z2      -- (pointing away from the piece at each end)
      da.z, dz.z = 0, 0
      local la, lz = da:length(), dz:length()
      if la > 0.01 and lz > 0.01 then
        local ok, note = lanesNote(r)
        local it = { name = name, pos = { a, z }, out = { da / la, dz / lz }, width = r:getNodeWidth(math.floor(n / 2)),
          note = tostring(ok and note or ''), len = (z - a):length() }
        info[name] = it
        for e = 1, 2 do
          local c = math.floor(it.pos[e].x / 2) .. ':' .. math.floor(it.pos[e].y / 2)
          cells[c] = cells[c] or {}
          table.insert(cells[c], { it = it, e = e })
        end
      end
    end
  end
  -- each end's straightest way on
  local best = {}
  for _, name in ipairs(list) do
    local A = info[name]
    if A then
      best[name] = {}
      for e = 1, 2 do
        local cx, cy = math.floor(A.pos[e].x / 2), math.floor(A.pos[e].y / 2)
        for ix = cx - 1, cx + 1 do
          for iy = cy - 1, cy + 1 do
            for _, c in ipairs(cells[ix .. ':' .. iy] or {}) do
              local B, eb = c.it, c.e
              -- (start on end: both run the same way, the notes must match; end on end or start on start: one is
              -- read backwards, its note must match the other way round)
              local sameWay = e ~= eb
              if B ~= A and (B.pos[eb] - A.pos[e]):length() <= JOIN_END_M and math.abs(B.width - A.width) <= JOIN_WIDTH_M
                and ((sameWay and B.note == A.note) or (not sameWay and B.note == swappedNote(A.note))) then
                local turn = -(A.out[e].x * B.out[eb].x + A.out[e].y * B.out[eb].y)
                if turn >= JOIN_TURN_COS and (not best[name][e] or turn > best[name][e].turn) then
                  best[name][e] = { it = B, e = eb, turn = turn }
                end
              end
            end
          end
        end
      end
    end
  end
  local function linkAt(it, e)
    local on = best[it.name] and best[it.name][e]
    if not on then return nil end
    local back = best[on.it.name] and best[on.it.name][on.e]
    if back and back.it == it and back.e == e then return on end
    return nil
  end
  local runs, used = {}, {}
  -- (from: the end the piece is entered at; entered at its end, it is read backwards)
  local function walk(it, from)
    local run, len = {}, 0
    while it and not used[it.name] do
      used[it.name] = true
      if #run > 0 and len + it.len > JOIN_LENGTH_M then runs[#runs + 1] = run; run, len = {}, 0 end
      run[#run + 1] = { name = it.name, reversed = from == 2 }
      len = len + it.len
      local on = linkAt(it, 3 - from)
      if on then it, from = on.it, on.e else it = nil end
    end
    if #run > 0 then runs[#runs + 1] = run end
  end
  for _, name in ipairs(list) do
    local it = info[name]
    if not it then runs[#runs + 1] = { { name = name, reversed = false } }; used[name] = true
    elseif not used[name] and not linkAt(it, 1) then walk(it, 1) end
  end
  for _, name in ipairs(list) do
    local it = info[name]
    if it and not used[name] and not linkAt(it, 2) then walk(it, 2) end
  end
  for _, name in ipairs(list) do if not used[name] then walk(info[name], 1) end end   -- (a ring of pieces has no first one)
  return runs
end

-- Of a road's points, the ones its shape needs: the ends, and any point the line between its neighbours would
-- miss by more than THIN_SIDE_M sideways or THIN_HEIGHT_M in height, and one at least every THIN_GAP_M.
local function thinned(pts)
  local n = #pts
  if n <= 2 then return pts end
  local keep = { [1] = true, [n] = true }
  local stack = { { 1, n } }
  while #stack > 0 do
    local i, j = stack[#stack][1], stack[#stack][2]
    stack[#stack] = nil
    if j - i >= 2 then
      local a, b = pts[i], pts[j]
      local ax, ay, az = b.x - a.x, b.y - a.y, b.z - a.z
      local l2 = ax * ax + ay * ay + az * az
      local worst, at = 0, nil
      for k = i + 1, j - 1 do
        local p = pts[k]
        local t = l2 > 0 and ((p.x - a.x) * ax + (p.y - a.y) * ay + (p.z - a.z) * az) / l2 or 0
        local dx, dy, dz = p.x - (a.x + ax * t), p.y - (a.y + ay * t), p.z - (a.z + az * t)
        local s = math.max(math.sqrt(dx * dx + dy * dy) / THIN_SIDE_M, math.abs(dz) / THIN_HEIGHT_M)
        if s > worst then worst, at = s, k end
      end
      if worst <= 1 and l2 > THIN_GAP_M * THIN_GAP_M then at = math.floor((i + j) / 2) elseif worst <= 1 then at = nil end
      if at then keep[at] = true; stack[#stack + 1] = { i, at }; stack[#stack + 1] = { at, j } end
    end
  end
  -- (what the straight line between two kept nodes would pass under, both are raised by)
  local raise, last = {}, 1
  for i = 2, n do
    if keep[i] then
      local a, b = pts[last], pts[i]
      local short = 0
      for k = last + 1, i - 1 do
        local t = (k - last) / (i - last)
        local d = pts[k].z - (a.z + (b.z - a.z) * t)
        if d > short then short = d end
      end
      raise[last] = math.max(raise[last] or 0, short)
      raise[i] = math.max(raise[i] or 0, short)
      last = i
    end
  end
  local out = {}
  for i = 1, n do if keep[i] then out[#out + 1] = vec3(pts[i].x, pts[i].y, pts[i].z + (raise[i] or 0)) end end
  return out
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

-- One MapNG road surface's line on the ground, with its width and lanes, or nil and why.
local function readSurface(name)
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
  return { name = name, road = road, line = line, width = width }
end

-- A run of MapNG road surfaces that run on into each other -> one Hero Road as wide as they are.
local function buildRun(parts)
  local name, road, width = parts[1].name, parts[1].road, parts[1].width
  local half = width / 2
  local line = {}
  for k, part in ipairs(parts) do
    -- (the point two pieces share is taken once)
    for i = (k > 1 and 2 or 1), #part.line do line[#line + 1] = part.line[i] end
  end

  gm.addNewGroup('MapNG ' .. name:sub(4) .. (#parts > 1 and (' +' .. (#parts - 1)) or ''))
  local groups = gm.getGroups()
  local g = groups[#groups]
  -- The lanes each way are OpenStreetMap's (MapNG writes them on the road surface as "forward backward
  -- left-hand tagged"); the width is MapNG's, which is the mapped or measured one where there is one.
  local forward, backward, leftHand, driving = lanesOf(road, width)
  if parts[1].reversed then forward, backward = backward, forward end
  local lanesLeft, lanesRight = backward, forward
  if leftHand then lanesLeft, lanesRight = forward, backward end
  local total = lanesLeft + lanesRight
  gm.applyProfilePreset(g, total >= 4 and 'highway' or 'city')
  -- The lanes are as wide as MapNG's driving lanes, and what is left of the road surface each side (a paved
  -- shoulder, a parking lane) is the Hero Road's shoulder. With the whole surface shared out among the lanes,
  -- a 7 m road with 0.9 m shoulders got lanes of 4.1 m (a BeamNG developer, 2026-11-14: "all roads use width
  -- 4.1 vs 2.75 for lane width").
  local shoulder = SHOULDER_M
  if driving then shoulder = math.max(0.05, (width - driving) / 2) end
  local laneWidth = math.max(1.5, ((driving or (width - 2 * SHOULDER_M))) / total)
  g.shoulderWidthM = shoulder

  -- The deck's height. A Hero Road is a mesh over the ground, highest along its crown and falling to its edges:
  -- set at the centre line's ground height it lay under the terrain wherever the ground is not dead level
  -- across the road (a BeamNG developer's hill road, 2026-11-13: "most of them are under terrain"). Each node
  -- takes the highest ground across the road's width there, plus what the crown and shoulders fall by, so the
  -- deck's lowest edge clears the ground.
  local fall = half * math.abs(tonumber(g.crossfallPct) or 2.5) / 100 + shoulder * math.abs(tonumber(g.shoulderFallPct) or 6) / 100
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
  nodesRead = nodesRead + #nodes
  nodes = thinned(nodes)
  nodesKept = nodesKept + #nodes

  g.nodes, g.widths, g.nmls = nodes, {}, {}
  for i = 1, #nodes do g.widths[i] = width; g.nmls[i] = vec3(0, 0, 1) end
  -- (the lanes carry the width: the editor's code works the deck out from lanes and shoulders)
  gm.setLaneProfile(g, lanesLeft, lanesRight, laneWidth)
  -- (no lines of the Hero Road's own: MapNG's are lifted onto it, liftLines)
  g.isRoadCenterLine, g.isRoadEdgeLines, g.isRoadLaneLines = false, false, false
  -- (baked, the far level of detail stays a mesh: the editor's default draws nothing there and leaves the road
  -- to the decals under it, and MapNG's are hidden under a Hero Road)
  g.lodFarNull = false
  g.geometryMode = 'spline'    -- MapNG's line is already the shape wanted; no re-engineered curves
  -- The mesh's density. The editor's own defaults are 100 pieces along each stretch between two nodes and 16
  -- across each side, meant for a road drawn by hand with a node every 50 m. MapNG gives a node every 4 m, so
  -- that was a hundred times the triangles wanted: minutes to build and, on a tester's 0.3.1-dev.4 map, a GPU
  -- that stopped responding. A piece a metre along, and a metre or so across.
  g.lonRes = LON_PIECES
  g.latRes = math.max(2, math.min(8, math.ceil(width / 2 / 1.2)))
  g.mapngSources = {}          -- (which MapNG road surfaces it stands for)
  for k, part in ipairs(parts) do g.mapngSources[k] = part.name end
  gm.ensureCornerArray(g)
  g.isDirty = true
  local key = forward .. '+' .. backward
  lanesSeen[key] = (lanesSeen[key] or 0) + 1
  return g
end

-- A run from joinRuns -> its Hero Roads: one, or more where a piece in it is left as it is (a bridge, a tunnel).
local function buildOne(run)
  local made, parts = {}, {}
  local function flush()
    if #parts > 0 then made[#made + 1] = buildRun(parts) end
    parts = {}
  end
  for _, piece in ipairs(run) do
    local part = readSurface(piece.name)
    if part then
      if piece.reversed then
        local back = {}
        for i = #part.line, 1, -1 do back[#back + 1] = part.line[i] end
        part.line, part.reversed = back, true
      end
      parts[#parts + 1] = part
    else skipped = skipped + 1; flush() end
  end
  flush()
  return made
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

local stubbed = {}
local function unstub()
  if editor then
    if stubbed.setDirty then editor.setDirty = nil end
    if stubbed.getNodes then editor.getNodes = nil end
    if stubbed.table and next(editor) == nil then editor = nil end
  end
  stubbed = {}
end

-- The list of baked meshes, kept beside them: levels/<level>/art/heroRoad/mapngHeroRoads.json.
local function levelName()
  local name = core_levels and getMissionFilename and core_levels.getLevelName(getMissionFilename()) or nil
  if not name or name == '' then return nil end
  return name
end
local function statePath()
  local name = levelName()
  return name and ('/levels/' .. name .. '/art/heroRoad/mapngHeroRoads.json') or nil
end
local function readState()
  local path = statePath()
  if not path or not FS:fileExists(path) then return nil end
  local ok, s = pcall(jsonReadFile, path)
  if not ok or type(s) ~= 'table' or type(s.chunks) ~= 'table' then return nil end
  return s
end
-- The mesh files a list names, and the list: taken away (a bake from another export, or to build again).
local function forgetState(s)
  if type(s) == 'table' and type(s.chunks) == 'table' then
    for _, c in ipairs(s.chunks) do
      if type(c.path) == 'string' and c.path:find('/art/heroRoad/', 1, true) then
        if FS:fileExists(c.path) then FS:removeFile(c.path) end
        local cdae = c.path:gsub('%.dae$', '.cdae')
        if cdae ~= c.path and FS:fileExists(cdae) then FS:removeFile(cdae) end
      end
    end
  end
  local path = statePath()
  if path and FS:fileExists(path) then FS:removeFile(path) end
end
local function usable(s)
  if not s or s.build ~= BUILD or #s.chunks == 0 then return false end
  for _, c in ipairs(s.chunks) do
    if type(c.path) ~= 'string' or not FS:fileExists(c.path) then return false end
  end
  return true
end

local function finish(msg)
  done = true
  phase = nil
  reloadCollision()
  local okLift, nLines = pcall(liftLines)
  if not okLift then firstError = firstError or tostring(nLines); nLines = 0 end
  linesLifted = nLines
  log((failed > 0 or bakeFailed > 0) and 'W' or 'I', 'mapngHeroRoads', msg .. (firstError and (' | first error: ' .. firstError) or ''))
  say(msg, 10)
end

local function start()
  queue, at, built, skipped, failed, firstError, lanesSeen = nil, 0, 0, 0, 0, nil, {}
  nodesRead, nodesKept, bakeAt, baked, bakeFailed, placeAt, fromBake = 0, 0, 0, 0, 0, 0, false
  t0 = os.clock()
  local list = collect()
  surfaces = #list
  -- A bake of this export is there: its meshes are placed, nothing is built.
  local state = not live and readState() or nil
  if usable(state) then
    bakedState, phase, fromBake = state, 'place', true
    local group = createObject('SimGroup')
    group.canSave = false
    group:registerObject(BAKED_GROUP)
    scenetree.MissionGroup:addObject(group)
    log('I', 'mapngHeroRoads', string.format('Placing %d baked Hero Road meshes', #state.chunks))
    return
  end
  if state then forgetState(state) end
  local ok, mod = pcall(require, 'editor/heroRoadEditor/groupMgr')
  if not ok or not mod then
    done = true
    log('E', 'mapngHeroRoads', 'The Hero Road Editor code did not load; the level keeps its decal roads. ' .. tostring(mod))
    say('MapNG: Hero Roads are not available in this game version; the level keeps its normal roads.', 10)
    return
  end
  gm = mod
  -- (two editor helpers the road code calls; they exist only once the World Editor has been opened)
  -- (what is added here is taken away again once the roads are built, in unstub: a global "editor" left behind
  -- reads to the rest of the game as the World Editor's own table, with most of it missing)
  if editor == nil then editor = {}; stubbed.table = true end
  if not editor.setDirty then editor.setDirty = function() end; stubbed.setDirty = true end
  if not editor.getNodes then
    stubbed.getNodes = true
    editor.getNodes = function(road)
      local t = {}
      for i = 0, road:getNodeCount() - 1 do t[#t + 1] = { pos = road:getNodePosition(i), width = road:getNodeWidth(i), depth = road:getNodeDepth(i) } end
      return t
    end
  end
  queue = joinRuns(list)
  phase = 'build'
  log('I', 'mapngHeroRoads', string.format('Building Hero Roads from %d MapNG road surfaces in %d runs', surfaces, #queue))
  say(string.format('MapNG: building Hero Roads (0/%d)...', #queue), 6)
end

local function builtMessage()
  return string.format('MapNG: %d Hero Roads built from %d road pieces in %.0f s (%d left as they were, %d failed)', built, surfaces, os.clock() - t0, skipped, failed)
end

local function buildStep()
  local made = {}
  while at < #queue and #made < PER_FRAME do
    at = at + 1
    local ok, gs = pcall(buildOne, queue[at])
    if not ok then failed = failed + 1; firstError = firstError or tostring(gs)
    else
      for _, g in ipairs(gs) do made[#made + 1] = g end
    end
  end
  if #made > 0 then
    local ok, err = buildDirty()
    if ok then
      built = built + #made
      sinceReload = sinceReload + #made
      if sinceReload >= RELOAD_EVERY then reloadCollision() end
      for _, g in ipairs(made) do
        for _, source in ipairs(g.mapngSources) do hideLayers(source) end
      end
    else failed = failed + #made; firstError = firstError or tostring(err) end
  end
  if at % 30 < PER_FRAME then say(string.format('MapNG: building Hero Roads (%d/%d)...', at, #queue), 6) end
  if at >= #queue then
    local okEx, ex = pcall(require, 'editor/heroRoadEditor/exportMgr')
    if live or not okEx or not ex or not ex.bakeGroup or not statePath() or built == 0 then
      unstub()
      finish(builtMessage())
      return
    end
    M.exportMgr = ex
    bakedState = { build = BUILD, chunks = {}, sources = {} }
    phase = 'bake'
    say(string.format('MapNG: baking %d Hero Roads...', built), 6)
  end
end

-- The roads baked, a few each frame: the editor's Bake writes each road's mesh files and puts them in the level
-- in place of the live road. What it placed is not saved with the level (this script places the meshes on
-- every load: saved too, they would be there twice).
local function bakeStep()
  local groups = gm.getGroups()
  local till = os.clock() + BAKE_FRAME_S
  while bakeAt < #groups and os.clock() < till do
    bakeAt = bakeAt + 1
    local g = groups[bakeAt]
    if g.mapngSources then
      local ok, did, why = pcall(M.exportMgr.bakeGroup, g)
      if ok and did and g.bakedManifest and #g.bakedManifest > 0 then
        baked = baked + 1
        for n, c in ipairs(g.bakedManifest) do
          bakedState.chunks[#bakedState.chunks + 1] = { path = c.path, x = c.x, y = c.y, z = c.z }
          local o = scenetree.findObject('HeroRoadBaked_' .. tostring(g.id) .. '_' .. n)
          if o then o.canSave = false end
        end
        local folder = g.sceneTreeFolderId and scenetree.findObjectById(g.sceneTreeFolderId)
        if folder then folder.canSave = false end
        for _, source in ipairs(g.mapngSources) do bakedState.sources[#bakedState.sources + 1] = source end
      else
        bakeFailed = bakeFailed + 1
        firstError = firstError or ('bake: ' .. tostring(ok and why or did))
      end
    end
  end
  if bakeAt % 40 == 0 then say(string.format('MapNG: baking Hero Roads (%d/%d)...', bakeAt, #groups), 6) end
  if bakeAt >= #groups then
    unstub()
    -- (the list is written only for a whole bake: with a road missing from it, the next load builds again)
    if bakeFailed == 0 and baked > 0 then
      local path = statePath()
      local ok = pcall(jsonWriteFile, path, bakedState, true)
      if not ok or not FS:fileExists(path) then firstError = firstError or 'the list of baked meshes could not be written' end
    end
    finish(builtMessage() .. string.format('; %d baked%s', baked, bakeFailed > 0 and (', ' .. bakeFailed .. ' not: they are built again on the next load') or ''))
  end
end

-- A later load: the baked meshes placed as the editor's Bake places them.
local function placeStep()
  local group = scenetree.findObject(BAKED_GROUP)
  local chunks = bakedState.chunks
  local n = 0
  while placeAt < #chunks and n < PLACE_PER_FRAME do
    placeAt = placeAt + 1
    n = n + 1
    local c = chunks[placeAt]
    local ts = createObject('TSStatic')
    ts:setField('shapeName', 0, c.path)
    ts:setField('collisionType', 0, 'Collision Mesh')
    ts:setField('decalType', 0, 'Visible Mesh Final')
    ts.canSave = false
    ts:registerObject('MapNGHeroRoad_' .. placeAt)
    if group then group:addObject(ts.obj) end
    ts:setPosRot(c.x, c.y, c.z, 0, 0, 0, 1)
  end
  if placeAt >= #chunks then
    for _, source in ipairs(bakedState.sources or {}) do hideLayers(source) end
    built = #chunks
    finish(string.format('MapNG: Hero Roads loaded from their bake (%d meshes, %.0f s)', #chunks, os.clock() - t0))
  end
end

local function remove()
  if gm then pcall(gm.removeAllGroups, true) end
  local n = 1
  while true do
    local o = scenetree.findObject('MapNGHeroRoad_' .. n)
    if not o then break end
    o:delete()
    n = n + 1
  end
  local group = scenetree.findObject(BAKED_GROUP)
  if group then group:delete() end
  unstub()
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
  queue, at, started, done, phase = nil, 0, true, true, nil
end

M.onUpdate = function()
  if done then return end
  if not started then
    if core_gamestate.loading() or not scenetree.MissionGroup then return end
    started = true
    start()
    return
  end
  if phase == 'build' then buildStep()
  elseif phase == 'bake' then bakeStep()
  elseif phase == 'place' then placeStep() end
end

M.status = function()
  return { started = started, done = done, phase = phase, total = queue and #queue or 0, at = at, built = built, surfaces = surfaces,
    nodesRead = nodesRead, nodesKept = nodesKept, skipped = skipped, failed = failed, baked = baked, bakeFailed = bakeFailed,
    fromBake = fromBake, firstError = firstError, lanes = lanesSeen, hidden = #hiddenByUs, linesLifted = linesLifted }
end
M.remove = remove
-- The bake's files and list taken away (the next load, or rebuild(), builds and bakes again).
M.forget = function() forgetState(readState()) end
M.rebuild = function() remove(); M.forget(); live = false; started, done = false, false end
-- Live, unbaked Hero Roads for this session, to edit in the World Editor's Hero Road tool.
M.edit = function() remove(); live = true; started, done = false, false end

return M
`;
