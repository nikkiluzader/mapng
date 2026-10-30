#!/usr/bin/env node
// In-game tests for an exported MapNG level, run in a live BeamNG.drive
// through its MCP server (the beamng-mcp mod, http://127.0.0.1:29292/mcp).
//
//   node scripts/ingame/runIngameTests.mjs <levelName> [--load] [--json out.json] [--max-fail 0.02]
//
// The level must be installed (mods/<zip>) and exported by a MapNG with
// in-game probes (levels/<name>/mapng_probes.json). With --load the level is
// started in freeroam first; otherwise it must already be the loaded level.
// Each probe drops a ray from far above onto where a surface should be (a
// road, a deck, a sidewalk, a tunnel floor, the spawn) and the result is
// judged by services/ingameProbes.js. Exit code 1 when any kind fails on more
// than --max-fail of its probes.
import fs from 'node:fs';
import { judgeProbes } from '../../services/ingameProbes.js';

const args = process.argv.slice(2);
const level = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL_MCP = process.env.BEAMNG_MCP_URL || 'http://127.0.0.1:29292/mcp';
const maxFail = Number(opt('--max-fail', '0.02'));
if (!level) { console.error('usage: runIngameTests.mjs <levelName> [--load] [--json out.json] [--max-fail 0.02]'); process.exit(2); }

let rpcId = 0;
async function lua(code) {
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: 'run_lua', arguments: { code } } }),
  });
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text;
  if (body.error || body?.result?.isError) throw new Error(`lua error: ${JSON.stringify(body.error || text).slice(0, 400)}`);
  return text;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadLevel() {
  await lua(`core_modmanager.initDB() freeroam_freeroam.startFreeroam('/levels/${level}/main/') return 'ok'`);
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    await sleep(3000);
    let state = '';
    try {
      state = await lua(`local ok = getMissionFilename():find('/levels/${level}/', 1, true) and scenetree.findObject('theTerrain') and be:getPlayerVehicle(0) return ok and 'ready' or 'wait'`);
    } catch { state = 'wait'; }
    if (state === 'ready') { await sleep(4000); return; }
  }
  throw new Error(`level ${level} did not finish loading in 10 minutes (if the loading screen hangs with "waiting for ui", restart the game)`);
}

// rays for a batch of probes; one line per probe:
// z|obj|class|below|roof|lowZ|lowObj|lowClass|roofObj
const RAY_LUA = `
local out = {}
local function hit(a, b)
  local r = castRay(a, b, true, true)
  if not r then return nil end
  local o = r.obj
  return r.pt.z, (o and o.getName and o:getName()) or 'none', (o and o.getClassName and o:getClassName()) or 'none'
end
for line in string.gmatch(PROBES, '[^;]+') do
  local k, x, y, z = line:match('(%a+),([%-%d%.]+),([%-%d%.]+),([%-%d%.]+)')
  x, y, z = tonumber(x), tonumber(y), tonumber(z)
  local hz, obj, cls, below, roof, lz, lobj, lcls, roofObj
  if k == 'under' then
    -- the road under a deck: its surface from a car's height, the deck's
    -- underside straight up from it
    lz, lobj, lcls = hit(vec3(x, y, z + 2.5), vec3(x, y, z - 40))
    hz, obj, cls = lz, lobj, lcls
    local rz, robj = hit(vec3(x, y, (lz or z) + 0.3), vec3(x, y, z + 40))
    if rz then roof = rz - (lz or z); roofObj = robj end
  elseif k == 'tunnel' then
    hz, obj, cls = hit(vec3(x, y, z + 1.5), vec3(x, y, z - 10))
    local rz = hit(vec3(x, y, z + 1.5), vec3(x, y, z + 40))
    if rz then roof = rz - z end
  else
    hz, obj, cls = hit(vec3(x, y, z + 80), vec3(x, y, z - 40))
    -- (from a car's height: under tree crowns, into anything standing there)
    lz, lobj, lcls = hit(vec3(x, y, z + 2.5), vec3(x, y, z - 40))
    if k == 'sidewalk' and lz and lobj ~= 'theTerrain' then
      local gz = core_terrain.getTerrainHeight(vec3(x, y, 0))
      if gz then below = lz - gz end
    end
  end
  out[#out + 1] = string.format('%s|%s|%s|%s|%s|%s|%s|%s|%s', hz and string.format('%.3f', hz) or '', obj or '', cls or '', below and string.format('%.3f', below) or '', roof and string.format('%.2f', roof) or '', lz and string.format('%.3f', lz) or '', lobj or '', lcls or '', roofObj or '')
end
return table.concat(out, ';')`;

async function main() {
  if (args.includes('--load')) { process.stderr.write(`loading ${level}...\n`); await loadLevel(); }
  const mission = await lua('return getMissionFilename()');
  if (!mission.includes(`/levels/${level}/`)) throw new Error(`loaded level is ${mission}, not ${level} (use --load)`);
  const raw = await lua(`local f = readFile('/levels/${level}/mapng_probes.json') return f or ''`);
  if (!raw) throw new Error(`no /levels/${level}/mapng_probes.json (export the level with a MapNG that writes in-game probes)`);
  const { probes } = JSON.parse(raw);
  const hits = [];
  const BATCH = 150;
  for (let i = 0; i < probes.length; i += BATCH) {
    const batch = probes.slice(i, i + BATCH);
    const list = batch.map((p) => `${p.k},${p.x},${p.y},${p.z}`).join(';');
    const text = await lua(`local PROBES = '${list}'\n${RAY_LUA}`);
    for (const line of text.split(';')) {
      const [z, obj, cls, below, roof, lz, lobj, lcls, roofObj] = line.split('|');
      const num = (v) => (v === '' || v === undefined ? NaN : Number(v));
      hits.push({ z: num(z), obj, cls, below: num(below), roof: num(roof), lz: num(lz), lobj, lcls, roofObj });
    }
  }
  const { byKind, failures } = judgeProbes(probes, hits);
  let bad = false;
  console.log(`In-game tests: ${level} (${probes.length} probes)`);
  for (const [k, { n, fail }] of Object.entries(byKind)) {
    const rate = n ? fail / n : 0;
    const over = rate > maxFail;
    bad ||= over;
    console.log(`  ${over ? 'FAIL' : 'ok  '} ${k.padEnd(9)} ${String(fail).padStart(4)} / ${n} failed (${(rate * 100).toFixed(1)}%)`);
  }
  // the kinds of failure, most common first, with a few places each
  const groups = new Map();
  for (const f of failures) {
    const key = `${f.k}: ${f.why.replace(/: .*/, '')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  - ${key} x${list.length}: ${list.slice(0, 4).map((f) => `(${Math.round(f.x)}, ${Math.round(f.y)}${f.obj ? ` ${f.obj}` : ''}${f.dz !== undefined ? ` dz ${f.dz}` : ''}${f.gap !== undefined ? ` gap ${f.gap}` : ''})`).join(' ')}`);
  }
  const out = opt('--json');
  if (out) fs.writeFileSync(out, JSON.stringify({ level, byKind, failures }, null, 1));
  process.exit(bad ? 1 : 0);
}

main().catch((err) => { console.error(String(err?.message || err)); process.exit(2); });
