#!/usr/bin/env node
// Street photos beside the game: for spots across an exported MapNG level,
// the nearest street-level photo (Mapillary, and Google Street View when a
// key is set) next to a screenshot from the same place and heading in a
// running BeamNG.drive (through its MCP server, like runIngameTests.mjs).
//
//   node scripts/ingame/streetCompare.mjs <levelName> [--load] [--spots 20]
//        [--tests ingame.json] [--source both|mapillary|google] [--out dir]
//
// Keys come from ~/.config/mapng/mapng.env (MAPILLARY_ACCESS_TOKEN,
// GOOGLE_STREETVIEW_KEY, GOOGLE_STREETVIEW_SIGNING_SECRET) and are never
// printed. Writes <out>/<level>/index.html with photo | game | spot rows.
//
// Google's terms: its images are fetched to look at only. They stay in the
// output folder (default: the system temp dir), are never committed and are
// never used to derive map data. Mapillary images are CC-BY-SA.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const level = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !args[args.indexOf(a) - 1]?.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL_MCP = process.env.BEAMNG_MCP_URL || 'http://127.0.0.1:29292/mcp';
const SPOTS = Number(opt('--spots', '20'));
const SOURCE = opt('--source', 'both');
const OUT = path.join(opt('--out', path.join(os.tmpdir(), 'mapng-streetcompare')), level || '');
const EYE_M = 2.2;          // camera over the road surface (a car-mounted street camera)
const FOV = 90;
const SEARCH_M = 45;        // photos this far from a spot
const SPACING_M = 90;       // spots at least this far apart
if (!level) { console.error('usage: streetCompare.mjs <levelName> [--load] [--spots 20] [--tests ingame.json] [--source both|mapillary|google] [--out dir]'); process.exit(2); }

// ── keys ────────────────────────────────────────────────────────────────
const envText = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.config/mapng/mapng.env'), 'utf8'); } catch { return ''; } })();
const key = (name) => process.env[name] || (envText.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*"?([^"\\s]+)"?`, 'm')) || [])[1] || '';
const MAPILLARY = key('MAPILLARY_ACCESS_TOKEN');
const GKEY = key('GOOGLE_STREETVIEW_KEY');
const GSECRET = key('GOOGLE_STREETVIEW_SIGNING_SECRET');

// ── game ────────────────────────────────────────────────────────────────
let rpcId = 0;
async function mcp(name, argsObj) {
  const res = await fetch(URL_MCP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: argsObj } }),
  });
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
    const state = await lua(`return (getMissionFilename():find('/levels/${level}/', 1, true) and scenetree.findObject('theTerrain') and be:getPlayerVehicle(0)) and 'ready' or 'wait'`).catch(() => 'wait');
    if (state === 'ready') { await sleep(4000); return; }
  }
  throw new Error(`level ${level} did not load in 10 minutes`);
}

// a screenshot (JPG bytes) of what the camera sees now
async function grab(scale = 0.75) {
  await mcp('screenshot_image', { scale });
  for (let i = 0; i < 20; i++) {
    await sleep(700);
    const content = await mcp('screenshot_image', { scale });
    const img = content.find((c) => c.type === 'image');
    if (img?.data) return Buffer.from(img.data, 'base64');
  }
  throw new Error('no screenshot');
}

// put the camera at world (x, y), EYE_M over the surface under it, facing
// compass heading h (degrees clockwise from north), slightly down
async function aim(x, y, zHint, h) {
  return lua(`
    if not commands.isFreeCamera() then commands.setFreeCamera() end
    local r = castRay(vec3(${x}, ${y}, ${zHint + 8}), vec3(${x}, ${y}, ${zHint - 30}), true, true)
    local z = (r and r.pt.z or ${zHint}) + ${EYE_M}
    local a = math.rad(${h})
    local d = vec3(math.sin(a), math.cos(a), -0.06):normalized()
    local q = quatFromDir(d, vec3(0, 0, 1))
    core_camera.setPosRot(0, ${x}, ${y}, z, q.x, q.y, q.z, q.w)
    core_camera.setFOV(0, ${FOV})
    ui_visibility.set(false)
    return string.format('%.2f', z)`);
}

// ── geo ─────────────────────────────────────────────────────────────────
let GEO;
const toLatLng = (x, y) => {
  const { bounds: b, worldSize: W } = GEO;
  return [b.north - (0.5 - y / W) * (b.north - b.south), b.west + (x / W + 0.5) * (b.east - b.west)];
};
const toWorld = (lat, lng) => {
  const { bounds: b, worldSize: W } = GEO;
  return [((lng - b.west) / (b.east - b.west) - 0.5) * W, (0.5 - (b.north - lat) / (b.north - b.south)) * W];
};
const bearing = (dx, dy) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

// ── photos ──────────────────────────────────────────────────────────────
async function mapillaryNear(x, y) {
  if (!MAPILLARY) return null;
  const [lat, lng] = toLatLng(x, y);
  const dLat = SEARCH_M / 111320; const dLng = SEARCH_M / (111320 * Math.cos((lat * Math.PI) / 180));
  const url = `https://graph.mapillary.com/images?fields=id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,is_pano,thumb_1024_url&limit=50&bbox=${[lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${MAPILLARY}` } });
  if (!res.ok) return null;
  const list = (await res.json()).data || [];
  let best = null;
  for (const im of list) {
    if (im.is_pano || !im.thumb_1024_url) continue;
    const g = (im.computed_geometry || im.geometry)?.coordinates;
    if (!g) continue;
    const [px, py] = toWorld(g[1], g[0]);
    const d = Math.hypot(px - x, py - y);
    const age = (Date.now() - im.captured_at) / (365 * 86400e3);
    // near first; a newer photo wins between two about as near
    const score = d + age * 2;
    if (!best || score < best.score) best = { score, d, x: px, y: py, h: im.computed_compass_angle ?? im.compass_angle, id: im.id, date: new Date(im.captured_at).toISOString().slice(0, 10), url: im.thumb_1024_url };
  }
  return best;
}

const signGoogle = (pathQuery) => {
  if (!GSECRET) return pathQuery;
  const k = Buffer.from(GSECRET.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = crypto.createHmac('sha1', k).update(pathQuery).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return `${pathQuery}&signature=${sig}`;
};
async function googleNear(x, y, roadHeading) {
  if (!GKEY) return null;
  const [lat, lng] = toLatLng(x, y);
  const meta = await (await fetch(`https://maps.googleapis.com${signGoogle(`/maps/api/streetview/metadata?location=${lat.toFixed(7)},${lng.toFixed(7)}&radius=${SEARCH_M}&source=outdoor&key=${GKEY}`)}`)).json();
  if (meta.status !== 'OK') return null;
  const [px, py] = toWorld(meta.location.lat, meta.location.lng);
  const d = Math.hypot(px - x, py - y);
  // facing the spot from the panorama, or along the road when standing on it
  const h = d > 6 ? bearing(x - px, y - py) : (roadHeading ?? 0);
  return { d, x: px, y: py, h, pano: meta.pano_id, date: meta.date || '', lat: meta.location.lat, lng: meta.location.lng };
}
async function googleImage(g) {
  const q = `/maps/api/streetview?size=640x400&pano=${g.pano}&heading=${g.h.toFixed(1)}&pitch=-3&fov=${FOV}&source=outdoor&key=${GKEY}`;
  const res = await fetch(`https://maps.googleapis.com${signGoogle(q)}`);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

// ── spots ───────────────────────────────────────────────────────────────
function pickSpots(probes, failures) {
  const out = [];
  const far = (p) => out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= SPACING_M);
  // the test failures first (each a place to look at), then an even spread
  for (const f of failures) if (out.length < Math.ceil(SPOTS / 2) && far(f)) out.push({ ...f, why: f.why });
  const pool = probes.filter((p) => ['road', 'deck', 'sidewalk'].includes(p.k));
  const quota = { road: 0.5, deck: 0.25, sidewalk: 0.25 };
  for (const k of Object.keys(quota)) {
    const list = pool.filter((p) => p.k === k);
    const want = Math.round(SPOTS * quota[k]);
    let got = 0;
    for (let i = 0; i < list.length && got < want && out.length < SPOTS * 3; i += Math.max(1, Math.floor(list.length / (want * 3)))) {
      if (far(list[i])) { out.push(list[i]); got++; }
    }
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  if (args.includes('--load')) { process.stderr.write(`loading ${level}...\n`); await loadLevel(); }
  const mission = await lua('return getMissionFilename()');
  if (!mission.includes(`/levels/${level}/`)) throw new Error(`loaded level is ${mission}, not ${level} (use --load)`);
  const raw = await lua(`local f = readFile('/levels/${level}/mapng_probes.json') return f or ''`);
  if (!raw) throw new Error(`no mapng_probes.json in ${level}`);
  const data = JSON.parse(raw);
  if (!data.geo) throw new Error(`${level} was exported before probes carried the level's frame (re-export it)`);
  GEO = data.geo;
  const failures = opt('--tests') ? JSON.parse(fs.readFileSync(opt('--tests'), 'utf8')).failures || [] : [];
  fs.mkdirSync(OUT, { recursive: true });
  const fovBefore = await lua('return core_camera.getFovDeg()');
  const rows = [];
  for (const spot of pickSpots(data.probes, failures)) {
    if (rows.length >= SPOTS) break;
    const mly = SOURCE !== 'google' ? await mapillaryNear(spot.x, spot.y) : null;
    const goo = SOURCE !== 'mapillary' ? await googleNear(spot.x, spot.y, spot.h) : null;
    if (!mly && !goo) continue;
    const n = String(rows.length + 1).padStart(2, '0');
    const row = { n, spot, mly, goo, shots: {} };
    // the game from each photo's own place and heading
    if (mly) {
      fs.writeFileSync(path.join(OUT, `${n}_mapillary.jpg`), Buffer.from(await (await fetch(mly.url)).arrayBuffer()));
      await aim(mly.x, mly.y, spot.z, mly.h); await sleep(900);
      fs.writeFileSync(path.join(OUT, `${n}_game_m.jpg`), await grab());
      row.shots.m = `${n}_game_m.jpg`;
    }
    if (goo) {
      const img = await googleImage(goo);
      if (img) fs.writeFileSync(path.join(OUT, `${n}_google.jpg`), img);
      await aim(goo.x, goo.y, spot.z, goo.h); await sleep(900);
      fs.writeFileSync(path.join(OUT, `${n}_game_g.jpg`), await grab());
      row.shots.g = `${n}_game_g.jpg`;
      row.gImage = !!img;
    }
    rows.push(row);
    process.stderr.write(`spot ${n}: ${spot.k} (${Math.round(spot.x)}, ${Math.round(spot.y)})${mly ? ` mapillary ${Math.round(mly.d)} m` : ''}${goo ? ` google ${Math.round(goo.d)} m` : ''}\n`);
  }
  await lua(`core_camera.setFOV(0, ${Number(fovBefore) || 65}) ui_visibility.set(true) return 'ok'`);
  // the page
  const cell = (src, cap) => `<figure>${src ? `<img src="${src}" loading="lazy">` : '<div class="none">no image</div>'}<figcaption>${cap}</figcaption></figure>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Street compare: ${esc(level)}</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#111;color:#ddd}h1{font-size:18px}
.row{border-top:1px solid #333;padding:12px 0}.pair{display:flex;gap:8px;flex-wrap:wrap}
figure{margin:0;flex:1 1 300px;max-width:520px}img{width:100%;border-radius:4px}.none{aspect-ratio:16/10;display:grid;place-items:center;background:#222}
figcaption{font-size:12px;color:#999;margin-top:4px}.why{color:#f88}a{color:#8cf}
</style></head><body><h1>Street photos vs game: ${esc(level)}</h1>
<p>Each row: the real photo and the game from the same place and heading (camera ${EYE_M} m over the road, ${FOV}° field of view). Mapillary images CC-BY-SA; Google images for viewing only, not stored or used as data.</p>
${rows.map((r) => {
    const [lat, lng] = toLatLng(r.spot.x, r.spot.y);
    const head = `<b>${r.n}</b> ${esc(r.spot.k)} ${esc(r.spot.road || '')} at (${Math.round(r.spot.x)}, ${Math.round(r.spot.y)}) · ${lat.toFixed(6)}, ${lng.toFixed(6)}${r.spot.why ? ` · <span class="why">test: ${esc(r.spot.why)}</span>` : ''}`;
    const parts = [];
    if (r.mly) parts.push(`<div class="pair">${cell(`${r.n}_mapillary.jpg`, `Mapillary ${esc(r.mly.date)}, ${Math.round(r.mly.d)} m from the spot, heading ${Math.round(r.mly.h)}° · <a href="https://www.mapillary.com/app/?pKey=${r.mly.id}">open</a>`)}${cell(r.shots.m, 'game, same place and heading')}</div>`);
    if (r.goo) parts.push(`<div class="pair">${cell(r.gImage ? `${r.n}_google.jpg` : '', `Google ${esc(r.goo.date)}, ${Math.round(r.goo.d)} m from the spot, heading ${Math.round(r.goo.h)}° · <a href="https://www.google.com/maps/@?api=1&map_action=pano&pano=${r.goo.pano}&heading=${Math.round(r.goo.h)}">open</a>`)}${cell(r.shots.g, 'game, same place and heading')}</div>`);
    return `<div class="row"><div>${head}</div>${parts.join('')}</div>`;
  }).join('\n')}
</body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, 'spots.json'), JSON.stringify(rows.map(({ shots, ...r }) => r), null, 1));
  console.log(`${rows.length} spot(s): ${path.join(OUT, 'index.html')}`);
}

main().catch((err) => { console.error(String(err?.message || err)); process.exit(2); });
