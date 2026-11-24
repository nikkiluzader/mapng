-- The coverage level's labels in game: each plot's tag (and each structure's name) drawn as text over it, within
-- 250 m of the camera. Load with loadstring(readFile('/covtour/labels.lua'))(); loadstring(readFile('/covtour/labels_draw.lua'))()
-- (labels.lua made by labels_lua.py). Off again: extensions.unload('covLabels').
local M = {}
local fg = ColorF(1, 1, 0.3, 1)
local bg = ColorI(0, 0, 0, 170)
local function onPreRender()
  if not covLabels then return end
  local cam = core_camera.getPosition()
  for _, l in ipairs(covLabels) do
    local dx, dy = l.x - cam.x, l.y - cam.y
    if dx * dx + dy * dy < 62500 then
      l.z = l.z or ((core_terrain.getTerrainHeight(vec3(l.x, l.y, 0)) or 0) + 6)
      debugDrawer:drawTextAdvanced(vec3(l.x, l.y, l.z), String(l.t), fg, true, false, bg)
    end
  end
end
M.onPreRender = onPreRender
return M
