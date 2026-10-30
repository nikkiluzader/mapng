#!/usr/bin/env node
// Drive tests for an exported MapNG level in a running BeamNG.drive (MCP
// server, like runIngameTests.mjs): the AI drives routes over the level's
// structures (every deck, tunnel and steep street, with road either side)
// while every frame is logged; each drive is judged for bumps, being
// airborne, falling under the road, leaving the route, getting stuck and
// damage (scripts/lib/driveAnalysis.mjs).
//
//   node scripts/ingame/driveTest.mjs <levelName> [--load] [--routes 12] [--json out.json]
//
// Every route follows a road the export drew at an ordinary speed, so it
// should drive cleanly: a crash, getting stuck or falling is a level bug (or
// a test bug), and so is backing up (the AI's own recovery). The drive
// stops there, physics paused, and the scene is screenshot from every side
// of the car, from above and from the hood; after a crash the car is also
// put back where it was 2 s before the impact (from the drive's own log) and
// photographed the same way. Each set comes with Google Street View from the
// nearest Google car panorama: ahead, right, behind and left, beside the
// game from the same place and lens (looked at only, never kept in the repo).
// The car spawns with its tyres on the road surface, nothing counted for
// half a second; a bad spawn (damaged, tilted sideways, sunk, floating) is
// photographed and tried again further on. What is running shows on the
// game's screen and in the screenshots. --vary N picks other routes of
// each kind (the Nth on); --reverse drives every route end to start.
// Output: <out>/<level>/index.html. Needs probes v3. Exit code 1 when any
// route has an event other than a mild bump.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyseDrive, buildRoutes, impactOf } from '../lib/driveAnalysis.mjs';
import { EYE_GOOGLE_M, PITCH, H_FOV, bearing, levelGeo, streetView, vFovFor } from '../lib/streetView.mjs';
import { key } from '../sweep/env.mjs';

const args = process.argv.slice(2);
const level = args.find((a, i) => !a.startsWith('--') && !['--routes', '--json', '--only', '--out', '--vary'].includes(args[i - 1]));
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const URL_MCP = process.env.BEAMNG_MCP_URL || 'http://127.0.0.1:29292/mcp';
if (!level) { console.error('usage: driveTest.mjs <levelName> [--load] [--routes 12] [--only N] [--out dir] [--json out.json] [--no-street] [--vary N] [--reverse]'); process.exit(2); }
const SPAWN_TRIES = 3;
const MAX_SANE_MS = 100;   // a speed reading past this is the game's teleport artefact
const SPAWN_GRACE_S = 0.5;  // nothing counted while the car lands
const SPAWN_ROLL_DEG = 8;   // tilted sideways more: a bad spawn (nose up or down: a hill)
const REVERSE_MS = -1;      // backing up this fast (the AI's own recovery): stopped and photographed
const MAX_DRIVE_S = 180;   // the in-game logger stops itself after this (the script may die)
const OUT = path.join(opt('--out', path.join(os.tmpdir(), 'mapng-drives')), level);

let rpcId = 0;
async function mcp(name, a) {
  const res = await fetch(URL_MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: a } }) });
  const body = await res.json();
  if (body.error || body?.result?.isError) throw new Error(`${name}: ${JSON.stringify(body.error || body.result.content).slice(0, 300)}`);
  return body.result.content || [];
}
const lua = async (code) => (await mcp('run_lua', { code }))[0]?.text ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadLevel() {
  await lua(`core_modmanager.initDB() freeroam_freeroam.startFreeroam('/levels/${level}/main/') return 'ok'`);
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    await sleep(3000);
    const s = await lua(`return (getMissionFilename():find('/levels/${level}/', 1, true) and scenetree.findObject('theTerrain') and be:getPlayerVehicle(0)) and 'ready' or 'wait'`).catch(() => 'wait');
    if (s === 'ready') { await sleep(4000); return; }
  }
  throw new Error(`level ${level} did not load`);
}

// a screenshot (JPG bytes) of what the camera sees now
async function grab(scale = 0.6) {
  await mcp('screenshot_image', { scale });
  for (let i = 0; i < 20; i++) {
    await sleep(700);
    const img = (await mcp('screenshot_image', { scale })).find((c) => c.type === 'image');
    if (img?.data) return Buffer.from(img.data, 'base64');
  }
  return null;
}
// stop, freeze the scene and photograph it: behind the car, the driver's
// view, from above
// a free camera at an offset in the car's frame (forward, right, up),
// looking at a point in it
const carCam = (fwd, right, up, lookFwd = 0, lookUp = 0.6) => `if not commands.isFreeCamera() then commands.setFreeCamera() end
      local v = be:getPlayerVehicle(0) local p = v:getPosition() local d = v:getDirectionVector() d.z = 0 d = d:normalized()
      local r = d:cross(vec3(0, 0, 1)):normalized()
      local c = p + d * ${fwd} + r * ${right} + vec3(0, 0, ${up})
      local t = p + d * ${lookFwd} + vec3(0, 0, ${lookUp})
      local q = quatFromDir((t - c):normalized(), vec3(0, 0, 1))
      core_camera.setPosRot(0, c.x, c.y, c.z, q.x, q.y, q.z, q.w)`;
// every side of the car from outside, from above, and the hood view
const VIEWS = {
  behind: carCam(-9, 0, 3.2),
  front: carCam(9, 0, 3.2),
  left: carCam(0, -9, 3.2),
  right: carCam(0, 9, 3.2),
  above: carCam(-12, 0, 13),
  hood: carCam(0.9, 0, 1.25, 30, 0.8),
};

// stop, freeze the scene and photograph it from every VIEWS angle; tag
// names the moment (crash, rewind)
async function capture(n, type, { pause = true, tag = 'crash', street = true } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  // (a car jammed inside something is not paused: resuming it is what took
  // the game down)
  // (the HUD stays in the shots: the status line says which route and what
  // happened)
  await lua(`be:getPlayerVehicle(0):queueLuaCommand('ai.setMode("disabled")') ${pause ? 'be:setPhysicsRunning(false)' : ''} ui_visibility.setCef(true) return 'ok'`);
  await sleep(300);
  const shots = {};
  const at = await lua(`local v = be:getPlayerVehicle(0) local p = v:getPosition() local d = v:getDirectionVector() return string.format('%.2f,%.2f,%.2f,%.3f,%.3f', p.x, p.y, p.z, d.x, d.y)`).then((t) => { const [x, y, z, dx, dy] = t.split(',').map(Number); return { x, y, z, dx, dy }; }).catch(() => null);
  for (const [name, code] of Object.entries(VIEWS)) {
    await lua(`${code} return 'ok'`).catch(() => {});
    await sleep(700);
    const img = await grab();
    if (img) { const f = `route${String(n).padStart(2, '0')}_${type.replace(/\W+/g, '_')}_${tag}_${name}.jpg`; fs.writeFileSync(path.join(OUT, f), img); shots[name] = f; }
  }
  if (street && at && Number.isFinite(at.x)) {
    const sv = await captureStreet(n, type, tag, at);
    if (sv) Object.defineProperty(shots, 'street', { value: sv, enumerable: false });
  }
  // (the HUD back on: the status line shows while driving)
  await lua(`commands.setGameCamera() be:setPhysicsRunning(true) ui_visibility.setCef(true) return 'ok'`);
  return shots;
}

// REWIND_S before the impact (the sharpest slowing in the last seconds
// logged; the poll that noticed it is up to a second late), from the drive's
// own log: the car put back there, repaired, facing its way of travel
const REWIND_S = 2;
function rewindPoint(samples) {
  if (samples.length < 10) return null;
  const end = samples[samples.length - 1].t;
  let tc = end; let worst = 0;
  for (let i = 5; i < samples.length; i++) {
    const a = samples[i]; const b = samples[i - 5];
    if (a.t < end - 2.5) continue;
    const decel = (Math.hypot(b.vx, b.vy) - Math.hypot(a.vx, a.vy)) / Math.max(1e-3, a.t - b.t);
    if (decel > worst) { worst = decel; tc = b.t; }
  }
  let pick = null;
  for (const q of samples) if (q.t <= tc - REWIND_S) pick = q;
  if (!pick || Math.hypot(pick.vx, pick.vy) < 0.5) return pick && { ...pick, dx: 1, dy: 0, still: true };
  const L = Math.hypot(pick.vx, pick.vy);
  return { ...pick, dx: pick.vx / L, dy: pick.vy / L };
}
async function captureRewind(n, type, samples) {
  const q = rewindPoint(samples);
  if (!q || q.still) return null;
  await lua(`be:setPhysicsRunning(true)
    local v = be:getPlayerVehicle(0)
    v:queueLuaCommand('ai.setMode("disabled") obj:requestReset(RESET_PHYSICS)')
    return 'ok'`);
  await sleep(500);
  await lua(`local v = be:getPlayerVehicle(0) local q = quatFromDir(vec3(${q.dx}, ${q.dy}, 0))
    v:setPosRot(${q.x}, ${q.y}, ${q.z}, q.x, q.y, q.z, q.w) v:resetBrokenFlexMesh() return 'ok'`);
  await sleep(250);
  return capture(n, type, { tag: 'rewind' });
}

// Google Street View beside the game at each incident: the newest Google
// car panorama near the car, and from its exact place, 2.5 m up, Google's
// lens: ahead, right, behind and left of the car's way (one pair each).
// Keys from ~/.config/mapng/mapng.env; --no-street skips it. Google's
// images are for looking at only: they stay in the output folder.
const SV = args.includes('--no-street') ? null : streetView({ key: key('GOOGLE_STREETVIEW_KEY'), secret: key('GOOGLE_STREETVIEW_SIGNING_SECRET') });
const STREET_DIRS = [['ahead', 0], ['right', 90], ['behind', 180], ['left', 270]];
const NON_DRIVABLE = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor', 'track']);
let GEO = null; let ROADS = [];
// (Google's car: standing on a drivable carriageway, not a sidewalk)
function onCarriageway(x, y) {
  for (const l of ROADS) {
    for (let i = 0; i + 1 < l.p.length; i++) {
      const [ax, ay] = l.p[i]; const [bx, by] = l.p[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      if (Math.hypot(ax + vx * t - x, ay + vy * t - y) <= (l.hw || 3) + 1.5) return true;
    }
  }
  return false;
}
function jpegAspect(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5);
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return 16 / 9;
}
let ASPECT = null;
async function captureStreet(n, type, tag, at) {
  if (!SV || !GEO) return null;
  const travel = bearing(at.dx, at.dy);
  const g = await SV.newestNear(at.x, at.y, travel, { geo: GEO, onRoad: ROADS.length ? onCarriageway : null, searchM: 40 }).catch(() => null);
  if (!g) return { none: true };
  if (!ASPECT) { await lua(`if not commands.isFreeCamera() then commands.setFreeCamera() end return 'ok'`); await sleep(500); const probe = await grab(); ASPECT = probe ? jpegAspect(probe) : 16 / 9; }
  const vFov = vFovFor(H_FOV, ASPECT);
  // (no HUD over the game frame beside Google's photo)
  await lua('ui_visibility.setCef(false) return "ok"');
  const pairs = [];
  for (const [dir, turn] of STREET_DIRS) {
    const h = (travel + turn) % 360;
    const a = (h * Math.PI) / 180; const p = (PITCH * Math.PI) / 180;
    // the surface under the panorama at the car's level (a deck, the road)
    await lua(`if not commands.isFreeCamera() then commands.setFreeCamera() end
      local r = castRay(vec3(${g.x}, ${g.y}, ${at.z + 3}), vec3(${g.x}, ${g.y}, ${at.z - 8}), true, true)
      local base = r and r.pt.z or (core_terrain.getTerrainHeight(vec3(${g.x}, ${g.y}, 0)) or ${at.z})
      local d = vec3(${Math.sin(a) * Math.cos(p)}, ${Math.cos(a) * Math.cos(p)}, ${Math.sin(p)})
      local q = quatFromDir(d, vec3(0, 0, 1))
      core_camera.setPosRot(0, ${g.x}, ${g.y}, base + ${EYE_GOOGLE_M}, q.x, q.y, q.z, q.w)
      core_camera.setFOV(0, ${vFov.toFixed(3)})
      return 'ok'`);
    await sleep(700);
    const game = await grab();
    const photo = await SV.image(g.pano, h, ASPECT).catch(() => null);
    const stem = `route${String(n).padStart(2, '0')}_${type.replace(/\W+/g, '_')}_${tag}_street_${dir}`;
    const pair = { dir };
    if (game) { pair.game = `${stem}_game.jpg`; fs.writeFileSync(path.join(OUT, pair.game), game); }
    if (photo) { pair.google = `${stem}_google.jpg`; fs.writeFileSync(path.join(OUT, pair.google), photo); }
    pairs.push(pair);
  }
  await lua(`commands.setGameCamera() ui_visibility.setCef(true) return 'ok'`);
  return { date: g.date, d: Math.round(g.d), pairs };
}

// the car's damaged parts, worst first: [{ part, damage 0..1 }] (BeamNG's
// own per-part scores, from the vehicle's Lua; the tool answers on a second
// call)
async function damagedParts() {
  if (JBEAM === null) JBEAM = await lua('return be:getPlayerVehicle(0):getJBeamFilename()').catch(() => '');
  // parts past BeamNG's damage score, and the damaged deform groups (the
  // working parts: radiator, engine, headlights, ...), which minor crashes
  // reach first
  const code = `local t = {} for k, v in pairs(beamstate.getPartDamageData()) do t[#t + 1] = string.format('%s=%.3f', type(v.name) == 'string' and v.name or tostring(k), v.damage) end for g, d in pairs(beamstate.deformGroupDamage or {}) do if d.damage and d.damage > 0.01 then t[#t + 1] = string.format('%s=%.3f', tostring(g), math.min(1, d.damage)) end end return table.concat(t, ';')`;
  try {
    await mcp('run_lua_vehicle', { code });
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      const text = (await mcp('run_lua_vehicle', { code }))[0]?.text || '';
      if (text.startsWith('queued')) continue;
      const vals = Object.values(JSON.parse(text));
      return String(vals[0] ?? '').split(';').filter(Boolean).map((kv) => {
        const at = kv.lastIndexOf('='); return { part: kv.slice(0, at), damage: Number(kv.slice(at + 1)) };
      }).sort((a, b) => b.damage - a.damage);
    }
  } catch { /* no answer */ }
  return null;
}
// a part's name for people: its slot, without the car model's prefix
// (pessima_bumper_F -> bumper F)
let JBEAM = null;
const partLabel = (p) => {
  let name = p.part.replace(/^.*\//, '');
  if (JBEAM && name.toLowerCase().startsWith(`${JBEAM.toLowerCase()}_`)) name = name.slice(JBEAM.length + 1);
  return name.replace(/_/g, ' ');
};
const partsText = (parts, n = 4) => (parts?.length ? parts.slice(0, n).map((p) => `${partLabel(p)} ${Math.round(p.damage * 100)}%`).join(', ') + (parts.length > n ? ` +${parts.length - n} more` : '') : '');

// what is running, on the game's screen and in the screenshots (one line,
// replaced as it goes)
let STATUS_PREFIX = '';
const status = (msg, ttl = 600) => lua(`ui_message(${JSON.stringify(`${STATUS_PREFIX}${msg}`)}, ${ttl}, 'mapngDriveTest', 'directions_car') return 'ok'`).catch(() => {});

// brake to a stop, then the parking brake on and the brake off (held at a
// standstill, the brake of the arcade gearbox is reverse: after the last
// route the car backed away until it crashed)
async function stopCar() {
  await lua(`be:getPlayerVehicle(0):queueLuaCommand('ai.setMode("disabled") input.event("throttle", 0, 1) input.event("brake", 1, 1)') return 'ok'`);
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const sp = Number(await lua('local v = be:getPlayerVehicle(0) return string.format("%.2f", v:getVelocity():length())'));
    if (!(sp > 0.5)) break;
  }
  await lua(`be:getPlayerVehicle(0):queueLuaCommand('input.event("parkingbrake", 1, 1) input.event("brake", 0, 1)') return 'ok'`);
}

// after an incident or an error: the logger and the AI off, the car's
// controls let go and physics paused where it is (a wreck left churning
// hung the game). The next spawn places it at its start before physics
// runs again: no detour by the level's spawn point.
async function calm() {
  await lua(`if _G.mapngDrive then _G.mapngDrive.on = false end
    local v = be:getPlayerVehicle(0)
    if v then v:queueLuaCommand('ai.setMode("disabled") input.event("throttle", 0, 1) input.event("brake", 0, 1)') end
    return 'ok'`).catch(() => {});
  await sleep(200);
  await lua(`be:setPhysicsRunning(false) return 'ok'`).catch(() => {});
}

async function damageNow() {
  const text = (await mcp('get_vehicle_damage', {}).catch(() => []))[0]?.text || '';
  const m = text.match(/"damageSum"\s*:\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

// one drive: teleport to the start, log every frame, AI along the points
async function drive(route, n) {
  // start where nothing stands over the road (a building over it: dropped
  // into its collision the car was wrecked before it moved): the first
  // point, or the next one on, up to a third of the route
  let p = route.points;
  const starts = [];   // clear start points, SPAWN_TRIES at most, 10 m apart
  for (let i = 0; i < p.length / 3 && starts.length < SPAWN_TRIES; i++) {
    if (starts.length && Math.hypot(p[i][0] - p[starts[starts.length - 1]][0], p[i][1] - p[starts[starts.length - 1]][1]) < 10) continue;
    // (up from the road, and down from high over it: a ray starting inside
    // a building does not see its walls)
    const over = await lua(`
      local x, y, z = ${p[i][0]}, ${p[i][1]}, ${p[i][2]}
      local up = castRay(vec3(x, y, z + 0.5), vec3(x, y, z + 6), true, true)
      local down = castRay(vec3(x, y, z + 80), vec3(x, y, z - 5), true, true)
      local downName = down and down.obj and down.obj.getName and down.obj:getName() or ''
      local roofOver = down and down.pt.z > z + 1.5 and not downName:find('[Ff]orest')
      return (up or roofOver) and 'blocked' or 'clear'`);
    if (over === 'clear') starts.push(i);
  }
  // spawn: at a clear start, tyres on the surface (from the car's own
  // bounding box: dropped from too high, or placed into the road, it hit
  // hard and slowed the game), nothing counted for SPAWN_GRACE_S; then
  // settled, undamaged, not tilted sideways (nose up or down is a hill).
  // A bad spawn is photographed and tried again further on, SPAWN_TRIES
  // times; none good: the route is reported as not spawned.
  const spawns = [];
  let damage0 = null; let spawned = false;
  for (let a = 0; a < starts.length; a++) {
    const q0 = p[starts[a]];
    const rest = p.slice(starts[a]);
    let k = 1; while (k < rest.length - 1 && Math.hypot(rest[k][0] - q0[0], rest[k][1] - q0[1]) < 5) k++;
    const dx = rest[k][0] - q0[0]; const dy = rest[k][1] - q0[1]; const L = Math.hypot(dx, dy) || 1;
    await status(`spawning${a ? ` (try ${a + 1})` : ''}`);
    // straight to the start with physics paused, then a fresh car there
    // (repaired, brakes released: the last drive ended on the parking brake)
    const placed = await lua(`
      be:setPhysicsRunning(false)
      local veh = be:getPlayerVehicle(0)
      -- the reference point's height over the bottom of the car
      local bb = veh:getSpawnWorldOOBB()
      local bottom = bb:getCenter() - veh:getDirectionVectorUp() * bb:getHalfExtents().z
      local refH = veh:getPosition().z - bottom.z
      if refH < 0 or refH > 3 then refH = 0.5 end
      -- the surface nearest the road line's height (not a median wall's or
      -- a barrier's top over it)
      local ground, best, top = ${q0[2]}, math.huge, ${q0[2] + 3}
      for _ = 1, 6 do
        local hit = castRay(vec3(${q0[0]}, ${q0[1]}, top), vec3(${q0[0]}, ${q0[1]}, ${q0[2] - 10}), true, true)
        if not hit then break end
        if math.abs(hit.pt.z - ${q0[2]}) < best then best = math.abs(hit.pt.z - ${q0[2]}) ground = hit.pt.z end
        top = hit.pt.z - 0.05
      end
      -- exactly there (safeTeleport moves a car that overlaps scenery to a
      -- 'safe' spot elsewhere: in a tunnel everything overlaps)
      local q = quatFromDir(vec3(${dx / L}, ${dy / L}, 0))
      veh:setPosRot(${q0[0]}, ${q0[1]}, ground + refH + 0.05, q.x, q.y, q.z, q.w)
      veh:resetBrokenFlexMesh()
      return string.format('%.3f,%.3f', ground, refH)`);
    const [ground, refH] = placed.split(',').map(Number);
    await lua(`be:setPhysicsRunning(true)
      be:getPlayerVehicle(0):queueLuaCommand('ai.setMode("disabled") input.event("throttle", 0, 1) input.event("brake", 0, 1) input.event("parkingbrake", 0, 1) obj:requestReset(RESET_PHYSICS)')
      return 'ok'`);
    await sleep(SPAWN_GRACE_S * 1000);
    const dmgA = await damageNow();
    await sleep(1500);
    const dmgB = await damageNow();
    const st = await lua(`local v = be:getPlayerVehicle(0) local d = v:getDirectionVector() local u = v:getDirectionVectorUp()
      local r = d:cross(u):normalized() local pos = v:getPosition() local vel = v:getVelocity()
      return string.format('%.2f,%.2f,%.2f,%.2f', math.deg(math.asin(math.max(-1, math.min(1, r.z)))), math.deg(math.asin(math.max(-1, math.min(1, d:normalized().z)))), pos.z, vel:length())`);
    const [roll, pitch, z, speedRaw] = st.split(',').map(Number);
    // (just after a teleport the game can report an impossible speed: read
    // again, and never judge one past MAX_SANE_MS)
    let speed = speedRaw;
    if (!(speed < MAX_SANE_MS)) { await sleep(500); speed = Number(await lua('return string.format("%.2f", be:getPlayerVehicle(0):getVelocity():length())')); }
    if (!(speed < MAX_SANE_MS)) speed = 0;
    const problems = [];
    if (dmgA !== null && dmgB !== null && dmgB - dmgA > 50) problems.push(`damaged ${Math.round(dmgB - dmgA)} settling`);
    if (Math.abs(roll) > SPAWN_ROLL_DEG) problems.push(`tilted ${Math.round(roll)}° sideways`);
    if (z - refH < ground - 0.5) problems.push(`sank ${(ground - (z - refH)).toFixed(1)} m into the surface`);
    if (z - refH > ground + 1) problems.push(`${(z - refH - ground).toFixed(1)} m over the surface`);
    if (speed > 1.5) problems.push(`moving ${speed.toFixed(1)} m/s after settling`);
    const spawn = { x: Math.round(q0[0]), y: Math.round(q0[1]), roll, pitch, problems };
    spawns.push(spawn);
    if (!problems.length) { p = rest; damage0 = dmgB; spawned = true; break; }
    if (dmgA !== null && dmgB !== null && dmgB - dmgA > 50) spawn.parts = await damagedParts();
    await status(`bad spawn (${problems.join(', ')})${spawn.parts?.length ? `: ${partsText(spawn.parts)} damaged` : ''}; taking screenshots`);
    spawn.shots = await capture(n, `spawn ${a + 1}`, { pause: false, street: false });
    await calm();
  }
  if (!spawned) {
    const why = !starts.length ? 'a building or structure over the road at every start' : spawns.map((q) => q.problems.join(', ')).join(' / ');
    if (!starts.length) {
      // (a structure over the whole start: the car would be placed inside it)
      await lua(`local v = be:getPlayerVehicle(0) local q = quatFromDir(vec3(1, 0, 0)) v:setPosRot(${p[0][0]}, ${p[0][1]}, ${p[0][2] + 0.4}, q.x, q.y, q.z, q.w) return 'ok'`);
      await sleep(1500);
      spawns.push({ x: Math.round(p[0][0]), y: Math.round(p[0][1]), problems: ['start blocked'], shots: await capture(n, 'start blocked', { pause: false, street: false }) });
      await calm();
    }
    return { completed: false, progress: 0, length: 0, spawns, events: [{ type: 'no spawn', x: spawns[0]?.x, y: spawns[0]?.y, value: why }], incident: { type: 'no spawn' } };
  }
  const script = p.map((q, i) => `{x=${q[0].toFixed(2)},y=${q[1].toFixed(2)},z=${q[2].toFixed(2)},r=${(route.half * 2).toFixed(1)},v=${(i === 0 ? route.speed * 0.6 : route.speed).toFixed(1)}}`).join(',');
  await lua(`
    _G.mapngDrive = { samples = {}, on = true }
    local veh = be:getPlayerVehicle(0)
    local hp = hptimer()
    core_jobsystem.create(function(job)
      while _G.mapngDrive.on and hp:stop() < ${MAX_DRIVE_S * 1000} do
        local v = be:getPlayerVehicle(0)
        if v then
          local pos = v:getPosition(); local vel = v:getVelocity()
          local s = _G.mapngDrive.samples
          s[#s + 1] = string.format('%.3f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f', hp:stop() / 1000, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z)
        end
        job.sleep(0.02)
      end
    end, 0.01)
    veh:queueLuaCommand('ai.driveUsingPath({script = {${script}}, avoidCars = "off", driveInLane = "off", aggression = 0.6})')
    return 'ok'`);
  await status('driving');
  // until the end is reached, the car stops for good or time runs out
  const end = p[p.length - 1];
  const length = p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  const timeout = Date.now() + (length / route.speed * 2.5 + 20) * 1000;
  let stillFor = 0; let reversing = 0; let incident = null; const trail = [];
  const started = Date.now();
  while (Date.now() < timeout) {
    await sleep(500);
    const [x, y, z, sp, fwd] = (await lua('local v = be:getPlayerVehicle(0) local p = v:getPosition() local u = v:getVelocity() local d = v:getDirectionVector():normalized() return string.format("%.2f,%.2f,%.2f,%.2f,%.2f", p.x, p.y, p.z, math.sqrt(u.x*u.x+u.y*u.y), u:dot(d))')).split(',').map(Number);
    if (Math.hypot(x - end[0], y - end[1]) < 10) break;
    // the moment something goes wrong: a crash, stuck, under the road
    const dmg = await damageNow();
    let near = p[0]; for (const q of p) if (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(near[0] - x, near[1] - y)) near = q;
    // (stuck: barely moved for 4 s; a car jammed in something jitters, its
    // speed never quite zero)
    // (polls every 0.5 s: stuck is 4 s barely moving)
    trail.push([x, y]); if (trail.length > 9) trail.shift();
    const moved = trail.length === 9 ? Math.hypot(x - trail[0][0], y - trail[0][1]) : Infinity;
    stillFor = (sp < 0.5 || moved < 2) && Date.now() - started > 4000 ? stillFor + 1 : 0;
    reversing = fwd < REVERSE_MS ? reversing + 1 : 0;
    const type = damage0 !== null && dmg !== null && dmg - damage0 > 50 ? 'crash'
      : z < near[2] - 3 ? 'fell under the road'
        : reversing >= 2 ? 'reversing'
          : stillFor >= 6 ? 'stuck' : null;
    if (type) { incident = { type, x: Math.round(x), y: Math.round(y), z: Math.round(z * 10) / 10 }; break; }
  }
  const raw = await lua(`_G.mapngDrive.on = false return table.concat(_G.mapngDrive.samples, ';')`);
  const samples = raw.split(';').filter(Boolean).map((l) => { const [t, x, y, z, vx, vy, vz] = l.split(',').map(Number); return { t, x, y, z, vx, vy, vz }; });
  if (incident) {
    if (incident.type === 'crash') { incident.parts = await damagedParts(); incident.impact = impactOf(samples); }
    const hit = incident.impact ? `${incident.impact.where} impact (${incident.impact.dv} m/s)` : '';
    await status(`${incident.type} at (${incident.x}, ${incident.y})${hit ? `: ${hit}` : ''}${incident.parts?.length ? `; damaged ${partsText(incident.parts)}` : ''}; taking screenshots`);
    incident.shots = await capture(n, incident.type);
    incident.street = incident.shots.street ?? null;
    // and REWIND_S earlier: what the car was driving into
    if (incident.type === 'crash' || incident.type === 'reversing') {
      incident.rewindShots = await captureRewind(n, incident.type, samples);
      incident.rewindStreet = incident.rewindShots?.street ?? null;
    }
    await calm();
  }
  await stopCar();
  const damage1 = await damageNow();
  const result = analyseDrive({ ...route, points: p }, samples, { settle: 1.5, damage: damage0 !== null && damage1 !== null ? { start: damage0, end: damage1 } : null });
  if (incident) {
    result.incident = incident;
    const what = [incident.impact ? `${incident.impact.where} impact ${incident.impact.dv} m/s` : '', incident.parts?.length ? partsText(incident.parts, 3) : ''].filter(Boolean).join('; ');
    result.events.unshift({ type: incident.type, x: incident.x, y: incident.y, ...(what ? { value: what } : {}) });
  }
  // (a good spawn after bad ones: the bad ones are worth a look too)
  if (spawns.length > 1) { result.spawns = spawns; result.events.push({ type: 'respawned', value: spawns.length - 1 }); }
  return result;
}

async function main() {
  if (args.includes('--load')) { process.stderr.write(`loading ${level}...\n`); await loadLevel(); }
  const mission = await lua('return getMissionFilename()');
  if (!mission.includes(`/levels/${level}/`)) throw new Error(`loaded level is ${mission}, not ${level} (use --load)`);
  // (the HUD back on: a run cut short leaves it hidden from a screenshot)
  await lua('ui_visibility.setCef(true) return "ok"').catch(() => {});
  const raw = await lua(`local f = readFile('/levels/${level}/mapng_probes.json') return f or ''`);
  const data = raw ? JSON.parse(raw) : null;
  if (!data?.lines) throw new Error(`${level} has no road lines in its probes (re-export: probes v3)`);
  if (data.geo?.bounds && data.geo?.worldSize) GEO = levelGeo(data.geo);
  ROADS = data.lines.filter((l) => l.k !== 'sidewalk' && !NON_DRIVABLE.has(l.road));
  let routes = buildRoutes(data.lines, { max: Number(opt('--routes', '12')), offset: Number(opt('--vary', '0')) });
  // --reverse: every route driven end to start (against a one-way road's
  // traffic: the structures are what is tested)
  if (args.includes('--reverse')) routes = routes.map((r) => ({ ...r, points: [...r.points].reverse(), kind: `${r.kind} reversed` }));
  // --only N: just route N (to watch one)
  if (args.includes('--only')) routes = [routes[Number(opt('--only', '1')) - 1]].filter(Boolean);
  console.log(`Drive tests: ${level} (${routes.length} routes)`);
  const results = [];
  let bad = false;
  for (const [i, route] of routes.entries()) {
    let r;
    STATUS_PREFIX = `MapNG drive test ${i + 1}/${routes.length} · ${route.kind} ${route.road} · `;
    try { r = await drive(route, i + 1); } catch (err) { r = { completed: false, events: [{ type: 'error', value: String(err.message).slice(0, 120) }] }; await calm(); }
    results.push({ i, kind: route.kind, road: route.road, start: route.points[0].map(Math.round), ...r });
    // (a respawn that then drove is noted, photographed, not a failure)
    const serious = r.events.filter((e) => !(e.type === 'bump' && Math.abs(e.value) < 12) && e.type !== 'respawned');
    bad ||= serious.length > 0 || !r.completed;
    const evs = r.events.map((e) => `${e.type}${e.value !== undefined ? ` ${e.value}` : ''}${e.x !== undefined ? ` at (${e.x}, ${e.y})` : ''}`).join('; ');
    console.log(`  ${serious.length || !r.completed ? 'FAIL' : 'ok  '} ${String(i + 1).padStart(2)} ${route.kind.padEnd(6)} ${String(route.road).padEnd(14)} ${r.completed ? 'done' : `${r.progress ?? 0}/${r.length ?? '?'} m`} max vert ${r.maxVertAcc ?? '-'} m/s², dev ${r.maxDeviation ?? '-'} m${evs ? ` · ${evs}` : ''}`);
  }
  STATUS_PREFIX = '';
  await lua(`be:setPhysicsRunning(true) return 'ok'`).catch(() => {});
  await status(`MapNG drive tests done: ${results.filter((x) => x.completed && !x.incident).length} of ${results.length} routes clean`, 15);
  const out = opt('--json');
  if (out) fs.writeFileSync(out, JSON.stringify({ level, results }, null, 1));
  // the page: every route, its events, the screenshots where it went wrong
  fs.mkdirSync(OUT, { recursive: true });
  const streetHtml = (st, when) => {
    if (!st) return '';
    if (st.none) return `<p class="dim">No Google car panorama near the car (${when}).</p>`;
    return `<p>Google Street View ${esc(st.date)}, ${st.d} m away, beside the game from the same place (${when}): ahead, right, behind, left</p>
<div class="pairs">${st.pairs.map((q) => `<div class="pair"><span>${esc(q.dir)}</span>${q.google ? `<img src="${q.google}">` : '<i>no photo</i>'}${q.game ? `<img src="${q.game}">` : '<i>no shot</i>'}</div>`).join('')}</div>`;
  };
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Drive tests: ${esc(level)}</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}.r{border-top:1px solid #333;padding:10px 0}.bad{color:#f88}.ok{color:#8f8}img{width:32%;margin:0 1% 6px 0;border-radius:4px}.pairs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair img{width:49%}.pair span{display:block;color:#aaa}.dim{color:#888}</style></head><body>
<h1>Drive tests: ${esc(level)}</h1><p>Every route follows a drawn road at an ordinary speed: a crash, stuck or a fall is a bug. Screenshots at each incident (and, for a crash, 2 s before it): behind, front, left, right, from above, the hood view.</p>
${results.map((r) => `<div class="r"><b class="${r.incident || !r.completed ? 'bad' : 'ok'}">${r.i + 1}. ${esc(r.kind)} ${esc(r.road)}</b> start (${r.start.join(', ')}) · ${r.completed ? 'completed' : `${r.progress ?? 0} of ${r.length ?? '?'} m`} · max vertical ${r.maxVertAcc ?? '-'} m/s²
<div>${(r.events || []).map((e) => `${esc(e.type)}${e.value !== undefined ? ` ${esc(e.value)}` : ''}${e.x !== undefined ? ` at (${e.x}, ${e.y})` : ''}`).join(' · ')}</div>
${r.incident?.impact ? `<p>Impact: ${esc(r.incident.impact.where)}, ${r.incident.impact.dv} m/s at (${r.incident.impact.at.join(', ')})</p>` : ''}
${r.incident?.parts?.length ? `<p>Damaged: ${esc(partsText(r.incident.parts, 12))}</p>` : ''}
${r.incident?.shots ? `<p>At the ${esc(r.incident.type)}:</p><div>${Object.values(r.incident.shots).map((f) => `<img src="${f}">`).join('')}</div>` : ''}
${(r.spawns || []).filter((q) => q.shots).map((q, k) => `<p>Spawn ${k + 1} at (${q.x}, ${q.y}): ${esc(q.problems.join(', '))}${q.parts?.length ? `; damaged: ${esc(partsText(q.parts, 8))}` : ''}</p><div>${Object.values(q.shots).map((f) => `<img src="${f}">`).join('')}</div>`).join('')}
${streetHtml(r.incident?.street, 'at the incident')}
${r.incident?.rewindShots ? `<p>${REWIND_S} s earlier:</p><div>${Object.values(r.incident.rewindShots).map((f) => `<img src="${f}">`).join('')}</div>` : ''}
${streetHtml(r.incident?.rewindStreet, `${REWIND_S} s earlier`)}</div>`).join('\n')}
</body></html>`);
  console.log(`page: ${path.join(OUT, 'index.html')}`);
  process.exit(bad ? 1 : 0);
}
main().catch((err) => { console.error(String(err?.message || err)); process.exit(2); });
