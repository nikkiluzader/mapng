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
// a test bug). The drive stops there, physics paused, and the scene is
// screenshot from behind the car, from the driver's seat and from above
// (<out>/<level>/, with index.html). Needs probes v3. Exit code 1 when any
// route has an event other than a mild bump.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyseDrive, buildRoutes } from '../lib/driveAnalysis.mjs';

const args = process.argv.slice(2);
const level = args.find((a, i) => !a.startsWith('--') && !['--routes', '--json', '--only', '--out'].includes(args[i - 1]));
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const URL_MCP = process.env.BEAMNG_MCP_URL || 'http://127.0.0.1:29292/mcp';
if (!level) { console.error('usage: driveTest.mjs <levelName> [--load] [--routes 12] [--only N] [--out dir] [--json out.json]'); process.exit(2); }
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
async function capture(n, type, { pause = true } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  // (a car jammed inside something is not paused: resuming it is what took
  // the game down)
  await lua(`be:getPlayerVehicle(0):queueLuaCommand('ai.setMode("disabled")') ${pause ? 'be:setPhysicsRunning(false)' : ''} ui_visibility.setCef(true) return 'ok'`);
  await sleep(300);
  await lua('ui_visibility.setCef(false) return "ok"');
  const shots = {};
  const views = {
    chase: `commands.setGameCamera() core_camera.setByName(0, 'orbit')`,
    // (the driver's eye: a free camera in the car, looking 30 m ahead)
    driver: `if not commands.isFreeCamera() then commands.setFreeCamera() end
      local v = be:getPlayerVehicle(0) local p = v:getPosition() local d = v:getDirectionVector()
      local c = p + vec3(0, 0, 1.3) local t = p + d * 30 + vec3(0, 0, 0.8)
      local q = quatFromDir((t - c):normalized(), vec3(0, 0, 1))
      core_camera.setPosRot(0, c.x, c.y, c.z, q.x, q.y, q.z, q.w)`,
    above: `if not commands.isFreeCamera() then commands.setFreeCamera() end
      local v = be:getPlayerVehicle(0) local p = v:getPosition() local d = v:getDirectionVector()
      local c = p - d * 14 + vec3(0, 0, 11)
      local q = quatFromDir((p - c):normalized(), vec3(0, 0, 1))
      core_camera.setPosRot(0, c.x, c.y, c.z, q.x, q.y, q.z, q.w)`,
  };
  for (const [name, code] of Object.entries(views)) {
    await lua(`${code} return 'ok'`).catch(() => {});
    await sleep(900);
    const img = await grab();
    if (img) { const f = `route${String(n).padStart(2, '0')}_${type.replace(/\W+/g, '_')}_${name}.jpg`; fs.writeFileSync(path.join(OUT, f), img); shots[name] = f; }
  }
  await lua(`commands.setGameCamera() be:setPhysicsRunning(true) return 'ok'`);
  return shots;
}

// the car stopped, repaired, physics on, the logger off (after an incident
// or an error: a wreck left churning hung the game)
async function calm() {
  await lua(`if _G.mapngDrive then _G.mapngDrive.on = false end
    be:setPhysicsRunning(true)
    local v = be:getPlayerVehicle(0)
    if v then
      v:queueLuaCommand('ai.setMode("disabled")')
      -- out of whatever it is jammed in: back to the level's spawn, repaired
      local sp = scenetree.findObject('spawn_default')
      if sp then local p = sp:getPosition() local q = quat(sp:getRotation()) v:setPosRot(p.x, p.y, p.z + 0.5, q.x, q.y, q.z, q.w) end
      v:queueLuaCommand('obj:requestReset(RESET_PHYSICS)')
    end
    return 'ok'`).catch(() => {});
  await sleep(800);
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
  let clear = false;
  for (let i = 0; i < p.length / 3; i++) {
    // (up from the road, and down from high over it: a ray starting inside
    // a building does not see its walls)
    const over = await lua(`
      local x, y, z = ${p[i][0]}, ${p[i][1]}, ${p[i][2]}
      local up = castRay(vec3(x, y, z + 0.5), vec3(x, y, z + 6), true, true)
      local down = castRay(vec3(x, y, z + 80), vec3(x, y, z - 5), true, true)
      local downName = down and down.obj and down.obj.getName and down.obj:getName() or ''
      local roofOver = down and down.pt.z > z + 1.5 and not downName:find('[Ff]orest')
      return (up or roofOver) and 'blocked' or 'clear'`);
    if (over === 'clear') { p = p.slice(i); clear = true; break; }
  }
  if (!clear) {
    // (a structure over the whole start: the car would be placed inside it)
    await lua(`local v = be:getPlayerVehicle(0) local q = quatFromDir(vec3(1, 0, 0)) v:setPosRot(${p[0][0]}, ${p[0][1]}, ${p[0][2] + 0.4}, q.x, q.y, q.z, q.w) return 'ok'`);
    await sleep(1500);
    const shots = await capture(n, 'start blocked', { pause: false });
    await calm();
    return { completed: false, progress: 0, length: 0, events: [{ type: 'start blocked', x: Math.round(p[0][0]), y: Math.round(p[0][1]), value: 'a building or structure over the road' }], incident: { type: 'start blocked', shots } };
  }
  // facing along the route: the first point 5 m or more ahead
  let k = 1; while (k < p.length - 1 && Math.hypot(p[k][0] - p[0][0], p[k][1] - p[0][1]) < 5) k++;
  const dx = p[k][0] - p[0][0]; const dy = p[k][1] - p[0][1]; const L = Math.hypot(dx, dy) || 1;
  // a fresh car (repaired, brakes released: the last drive ended braking)
  await lua(`
    local veh = be:getPlayerVehicle(0)
    veh:queueLuaCommand('ai.setMode("disabled") input.event("brake", 0, 1) input.event("parkingbrake", 0, 1) obj:requestReset(RESET_PHYSICS)')
    return 'ok'`);
  await sleep(800);
  await lua(`
    local veh = be:getPlayerVehicle(0)
    veh:queueLuaCommand('ai.setMode("disabled") input.event("brake", 0, 1) input.event("parkingbrake", 0, 1)')
    -- on the surface there (the road line's height may be off the terrain)
    local hit = castRay(vec3(${p[0][0]}, ${p[0][1]}, ${p[0][2] + 3}), vec3(${p[0][0]}, ${p[0][1]}, ${p[0][2] - 10}), true, true)
    local z = (hit and hit.pt.z or ${p[0][2]}) + 0.3
    -- exactly there (safeTeleport moves a car that overlaps scenery to a
    -- 'safe' spot elsewhere: in a tunnel everything overlaps)
    local q = quatFromDir(vec3(${dx / L}, ${dy / L}, 0))
    veh:setPosRot(${p[0][0]}, ${p[0][1]}, z, q.x, q.y, q.z, q.w)
    veh:resetBrokenFlexMesh()
    return 'ok'`);
  await sleep(2500);
  const damage0 = await damageNow();
  // placed into something (a building over the road, a wall, under a tunnel
  // floor): wrecked before it moved. Reported, not driven (a jammed car's
  // physics churning once hung the game)
  if (damage0 !== null && damage0 > 50) {
    const shots = await capture(n, 'start blocked', { pause: false });
    await calm();
    return { completed: false, progress: 0, length: 0, events: [{ type: 'start blocked', x: Math.round(p[0][0]), y: Math.round(p[0][1]), value: `damaged ${Math.round(damage0)} on arrival` }], incident: { type: 'start blocked', shots } };
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
  // until the end is reached, the car stops for good or time runs out
  const end = p[p.length - 1];
  const length = p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  const timeout = Date.now() + (length / route.speed * 2.5 + 20) * 1000;
  let stillFor = 0; let incident = null; const trail = [];
  const started = Date.now();
  while (Date.now() < timeout) {
    await sleep(1000);
    const [x, y, z, sp] = (await lua('local v = be:getPlayerVehicle(0) local p = v:getPosition() local u = v:getVelocity() return string.format("%.2f,%.2f,%.2f,%.2f", p.x, p.y, p.z, math.sqrt(u.x*u.x+u.y*u.y))')).split(',').map(Number);
    if (Math.hypot(x - end[0], y - end[1]) < 10) break;
    // the moment something goes wrong: a crash, stuck, under the road
    const dmg = await damageNow();
    let near = p[0]; for (const q of p) if (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(near[0] - x, near[1] - y)) near = q;
    // (stuck: barely moved for 4 s; a car jammed in something jitters, its
    // speed never quite zero)
    trail.push([x, y]); if (trail.length > 5) trail.shift();
    const moved = trail.length === 5 ? Math.hypot(x - trail[0][0], y - trail[0][1]) : Infinity;
    stillFor = (sp < 0.5 || moved < 2) && Date.now() - started > 4000 ? stillFor + 1 : 0;
    const type = damage0 !== null && dmg !== null && dmg - damage0 > 50 ? 'crash'
      : z < near[2] - 3 ? 'fell under the road'
        : stillFor >= 3 ? 'stuck' : null;
    if (type) { incident = { type, x: Math.round(x), y: Math.round(y), z: Math.round(z * 10) / 10 }; break; }
  }
  const raw = await lua(`_G.mapngDrive.on = false return table.concat(_G.mapngDrive.samples, ';')`);
  if (incident) { incident.shots = await capture(n, incident.type); await calm(); }
  await lua(`be:getPlayerVehicle(0):queueLuaCommand('ai.setMode("disabled") input.event("brake", 1, 1)') return 'ok'`);
  const damage1 = await damageNow();
  const samples = raw.split(';').filter(Boolean).map((l) => { const [t, x, y, z, vx, vy, vz] = l.split(',').map(Number); return { t, x, y, z, vx, vy, vz }; });
  const result = analyseDrive({ ...route, points: p }, samples, { settle: 1.5, damage: damage0 !== null && damage1 !== null ? { start: damage0, end: damage1 } : null });
  if (incident) { result.incident = incident; result.events.unshift({ type: incident.type, x: incident.x, y: incident.y }); }
  return result;
}

async function main() {
  if (args.includes('--load')) { process.stderr.write(`loading ${level}...\n`); await loadLevel(); }
  const mission = await lua('return getMissionFilename()');
  if (!mission.includes(`/levels/${level}/`)) throw new Error(`loaded level is ${mission}, not ${level} (use --load)`);
  const raw = await lua(`local f = readFile('/levels/${level}/mapng_probes.json') return f or ''`);
  const data = raw ? JSON.parse(raw) : null;
  if (!data?.lines) throw new Error(`${level} has no road lines in its probes (re-export: probes v3)`);
  let routes = buildRoutes(data.lines, { max: Number(opt('--routes', '12')) });
  // --only N: just route N (to watch one)
  if (args.includes('--only')) routes = [routes[Number(opt('--only', '1')) - 1]].filter(Boolean);
  console.log(`Drive tests: ${level} (${routes.length} routes)`);
  const results = [];
  let bad = false;
  for (const [i, route] of routes.entries()) {
    let r;
    try { r = await drive(route, i + 1); } catch (err) { r = { completed: false, events: [{ type: 'error', value: String(err.message).slice(0, 120) }] }; await calm(); }
    results.push({ i, kind: route.kind, road: route.road, start: route.points[0].map(Math.round), ...r });
    const serious = r.events.filter((e) => !(e.type === 'bump' && Math.abs(e.value) < 12));
    bad ||= serious.length > 0 || !r.completed;
    const evs = r.events.map((e) => `${e.type}${e.value !== undefined ? ` ${e.value}` : ''}${e.x !== undefined ? ` at (${e.x}, ${e.y})` : ''}`).join('; ');
    console.log(`  ${serious.length || !r.completed ? 'FAIL' : 'ok  '} ${String(i + 1).padStart(2)} ${route.kind.padEnd(6)} ${String(route.road).padEnd(14)} ${r.completed ? 'done' : `${r.progress ?? 0}/${r.length ?? '?'} m`} max vert ${r.maxVertAcc ?? '-'} m/s², dev ${r.maxDeviation ?? '-'} m${evs ? ` · ${evs}` : ''}`);
  }
  const out = opt('--json');
  if (out) fs.writeFileSync(out, JSON.stringify({ level, results }, null, 1));
  // the page: every route, its events, the screenshots where it went wrong
  fs.mkdirSync(OUT, { recursive: true });
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Drive tests: ${esc(level)}</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}.r{border-top:1px solid #333;padding:10px 0}.bad{color:#f88}.ok{color:#8f8}img{width:32%;margin-right:1%;border-radius:4px}</style></head><body>
<h1>Drive tests: ${esc(level)}</h1><p>Every route follows a drawn road at an ordinary speed: a crash, stuck or a fall is a bug. Screenshots: behind the car, driver's seat, from above.</p>
${results.map((r) => `<div class="r"><b class="${r.incident || !r.completed ? 'bad' : 'ok'}">${r.i + 1}. ${esc(r.kind)} ${esc(r.road)}</b> start (${r.start.join(', ')}) · ${r.completed ? 'completed' : `${r.progress ?? 0} of ${r.length ?? '?'} m`} · max vertical ${r.maxVertAcc ?? '-'} m/s²
<div>${(r.events || []).map((e) => `${esc(e.type)}${e.value !== undefined ? ` ${esc(e.value)}` : ''}${e.x !== undefined ? ` at (${e.x}, ${e.y})` : ''}`).join(' · ')}</div>
${r.incident?.shots ? `<div>${Object.values(r.incident.shots).map((f) => `<img src="${f}">`).join('')}</div>` : ''}</div>`).join('\n')}
</body></html>`);
  console.log(`page: ${path.join(OUT, 'index.html')}`);
  process.exit(bad ? 1 : 0);
}
main().catch((err) => { console.error(String(err?.message || err)); process.exit(2); });
