-- Every paved road line walked at an even 0.5 m: the height the ray meets, what it meets, the terrain under it.
local out, names, nameIdx = {}, {}, {}
local function idx(n) if not nameIdx[n] then names[#names+1] = n; nameIdx[n] = #names end return nameIdx[n] end
for _, name in ipairs(scenetree.findClassObjects('DecalRoad')) do if name:match('^dr_.*_s%d+_b$') then local o = scenetree.findObject(name); local nc = o:getNodeCount(); local mat = tostring(o:getField('material',0)):lower()
  if nc >= 2 and (mat:find('asphalt',1,true) or mat:find('concrete',1,true)) and o:getNodeWidth(math.floor(nc/2)) >= 3 then
    local pts, carry = {}, 0
    for i = 0, nc - 2 do local a, b = o:getNodePosition(i), o:getNodePosition(i+1); local len = (b - a):length(); local d = carry
      while d < len do local p = a + (b - a) * (d / len)
        local hit = castRay(vec3(p.x, p.y, p.z + 1.6), vec3(p.x, p.y, p.z - 3), true, true)
        local z, c, n = -999, 0, 0
        if hit and hit.pt then z = hit.pt.z; local cls = hit.obj and hit.obj:getClassName() or '?'; c = (cls == 'MeshRoad' and 1) or (cls == 'TerrainBlock' and 2) or 3; n = idx(hit.obj and hit.obj:getName() or '?') end
        pts[#pts+1] = {math.floor(p.x*100+0.5)/100, math.floor(p.y*100+0.5)/100, math.floor(z*1000+0.5)/1000, c, n, math.floor(core_terrain.getTerrainHeight(vec3(p.x,p.y,0))*1000+0.5)/1000, math.floor(p.z*1000+0.5)/1000}
        d = d + 0.5 end
      carry = d - len end
    out[#out+1] = {name = name, w = o:getNodeWidth(math.floor(nc/2)), pts = pts}
  end end end
local decks = {}
for _, name in ipairs(scenetree.findClassObjects('MeshRoad') or {}) do local o = scenetree.findObject(name); local nodes = {}
  pcall(function() for i = 0, o:getNodeCount() - 1 do local p = o:getNodePosition(i); nodes[#nodes+1] = {p.x, p.y, p.z, o:getNodeWidth(i)} end end)
  decks[#decks+1] = {name = name, nodes = nodes} end
jsonWriteFile('/temp/mapng_profile.json', {roads = out, names = names, decks = decks})
return tostring(#out) .. ' roads, ' .. tostring(#decks) .. ' decks'
