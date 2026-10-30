#!/usr/bin/env node
// Street photos beside the game: for spots across an exported MapNG level,
// the nearest street-level photo (Mapillary, and Google Street View when a
// key is set) next to a screenshot from the same place and heading in a
// running BeamNG.drive (through its MCP server, like runIngameTests.mjs).
//
//   node scripts/ingame/streetCompare.mjs <levelName> [--load] [--spots 20]
//        [--tests ingame.json] [--source google|mapillary|both] [--out dir] [--min-year 2020]
//
// Google Street View is the default reference: it renders the exact heading,
// field of view and frame asked for, so the game view lines up. Mapillary
// (--source mapillary|both) varies by camera: lenses, mounts and years.
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
const SOURCE = opt('--source', 'google');   // Google's consistent views; Mapillary on request
const OUT = path.join(opt('--out', path.join(os.tmpdir(), 'mapng-streetcompare')), level || '');
// camera over the road surface: Google's car mast; Mapillary's mostly
// dashcams and phones held in a car
const EYE_GOOGLE_M = 2.5;
const EYE_MAPILLARY_M = 1.5;
const H_FOV = 90;           // Google's horizontal field of view (BeamNG's setFOV is VERTICAL)
const MAX_DISTORTION = 0.15; // |k1| over this: too bent to compare with a pinhole render
const MIN_YEAR = Number(opt('--min-year', '0'));
const YEARS_APART = 3;      // flag a pair this many years apart
const OLD_YEARS = 5;        // flag a photo this many years old (the newest there is)
const STREET_M = 6;         // a panorama this far past a carriageway's edge at most (street level)
const TOD = 0.08;           // fixed time of day for every game shot (morning sun, BeamNG's 0..1 day)
// the review rubric: each pair scored 0 (wrong) .. 2 (matches), null = not visible
const RUBRIC = ['alignment', 'roadWidth', 'markings', 'sidewalks', 'structures', 'terrain', 'buildings', 'vegetation', 'furniture'];
// spot categories, each given a share of the spots in turn
const CATEGORIES = ['failure', 'junction', 'roundabout', 'steep', 'ramp', 'bridge', 'under', 'portal', 'sidewalk', 'street'];
const SEARCH_M = 45;        // photos this far from a spot
const SPACING_M = 90;       // spots at least this far apart
if (!level) { console.error('usage: streetCompare.mjs <levelName> [--load] [--spots 20] [--tests ingame.json] [--source google|mapillary|both] [--out dir] [--min-year 2020]'); process.exit(2); }

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

// the HUD off: after a level load the UI reads hidden while the HUD (CEF)
// still shows; showing then hiding the CEF layer takes
// (in two calls: shown and hidden within one frame does nothing)
async function hideHud() {
  await lua('ui_visibility.setCef(true) return "ok"');
  await sleep(400);
  await lua('ui_visibility.setCef(false) ui_visibility.set(false) return "ok"');
  await sleep(600);
}

// put the camera at world (x, y), `eye` m over the surface under it, facing
// compass heading h (degrees clockwise from north), slightly down
// (vFov: BeamNG's setFOV is the vertical field of view, measured)
async function aim(x, y, zHint, h, { eye, vFov, pitch = -3, level = null }) {
  return lua(`
    if not commands.isFreeCamera() then commands.setFreeCamera() end
    local base
    ${level ? `
    -- on the drawn road level under the photo: its surface just there
    local r = castRay(vec3(${x}, ${y}, ${level.z + 1.5}), vec3(${x}, ${y}, ${level.z - 3}), true, true)
    base = r and r.pt.z or ${level.z}` : `
    -- on the terrain, or a deck / sidewalk right there, never a roof or a tree
    local g = core_terrain.getTerrainHeight(vec3(${x}, ${y}, 0)) or ${zHint}
    local r = castRay(vec3(${x}, ${y}, ${zHint + 3}), vec3(${x}, ${y}, ${zHint - 30}), true, true)
    local name = r and r.obj and r.obj.getName and r.obj:getName() or ''
    base = g
    if r and (name:find('^bridge_') or name:find('^sidewalks')) and r.pt.z > g then base = r.pt.z end`}
    local z = base + ${eye}
    -- a building straight over the camera (it stands in one in the game)
    local up = castRay(vec3(${x}, ${y}, z), vec3(${x}, ${y}, z + 8), true, true)
    local upName = up and up.obj and up.obj.getName and up.obj:getName() or ''
    local blocked = (up and not upName:find('^bridge_') and not upName:find('^tunnel_') and not upName:find('[Ff]orest')) and upName or ''
    local a = math.rad(${h}); local p = math.rad(${pitch})
    local d = vec3(math.sin(a) * math.cos(p), math.cos(a) * math.cos(p), math.sin(p))
    local q = quatFromDir(d, vec3(0, 0, 1))
    core_camera.setPosRot(0, ${x}, ${y}, z, q.x, q.y, q.z, q.w)
    core_camera.setFOV(0, ${vFov.toFixed(3)})
    return string.format('%.2f|%s', z, blocked)`);
}
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
// vertical field of view for a horizontal one at an aspect (width / height)
const vFovFor = (hFov, aspect) => deg(2 * Math.atan(Math.tan(rad(hFov) / 2) / aspect));

// width / height of a JPEG (its first SOF marker)
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// a Mapillary camera's view: horizontal / vertical field of view from its
// focal length (normalised by the image's longer side), and its pitch from
// the computed rotation (OpenSfM angle-axis, world -> camera; world east,
// north, up)
function mapillaryView(im) {
  const [f, k1 = 0] = im.camera_parameters || [];
  if (im.camera_type !== 'perspective' || !(f > 0) || !im.width || !im.height) return null;
  if (Math.abs(k1) > MAX_DISTORTION) return null;
  const long = Math.max(im.width, im.height);
  const hFov = deg(2 * Math.atan((im.width / long) / (2 * f)));
  const vFov = deg(2 * Math.atan((im.height / long) / (2 * f)));
  let pitch = 0;
  const r = im.computed_rotation;
  if (Array.isArray(r) && r.length === 3) {
    const th = Math.hypot(...r);
    if (th > 1e-9) {
      const [kx, ky, kz] = r.map((v) => v / th);
      const c = Math.cos(th); const sn = Math.sin(th); const t = 1 - c;
      // the camera's viewing axis in the world: R^T (0, 0, 1) = R's third row
      const dz = t * kz * kz + c;
      const dx = t * kx * kz - sn * ky; const dy = t * ky * kz + sn * kx;
      const len = Math.hypot(dx, dy, dz) || 1;
      pitch = Math.max(-15, Math.min(15, deg(Math.asin(dz / len))));
    }
  }
  return { hFov, vFov, pitch, aspect: im.width / im.height, k1 };
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
// how far a photo's heading is from facing along the road (either way)
const offRoadAxis = (h, roadH) => {
  if (!Number.isFinite(roadH)) return 0;
  const a = Math.abs((((h - roadH) % 360) + 540) % 360 - 180);   // 0..180 from facing along
  return Math.min(a, 180 - a);                                   // 0..90, either direction
};
async function mapillaryNear(x, y, roadH) {
  if (!MAPILLARY) return null;
  const [lat, lng] = toLatLng(x, y);
  const dLat = SEARCH_M / 111320; const dLng = SEARCH_M / (111320 * Math.cos((lat * Math.PI) / 180));
  const url = `https://graph.mapillary.com/images?fields=id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,computed_rotation,is_pano,camera_type,camera_parameters,width,height,make,model,thumb_1024_url&limit=100&bbox=${[lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${MAPILLARY}` } });
  if (!res.ok) return null;
  const list = (await res.json()).data || [];
  let best = null;
  for (const im of list) {
    if (im.is_pano || !im.thumb_1024_url) continue;
    if (MIN_YEAR && new Date(im.captured_at).getUTCFullYear() < MIN_YEAR) continue;
    // (a fisheye, a 360 or a lens we know nothing of: no fair comparison)
    const view = mapillaryView(im);
    if (!view) continue;
    const g = (im.computed_geometry || im.geometry)?.coordinates;
    if (!g) continue;
    const [px, py] = toWorld(g[1], g[0]);
    if (LINES.length && !atStreetLevel(px, py)) continue;
    const d = Math.hypot(px - x, py - y);
    const age = (Date.now() - im.captured_at) / (365 * 86400e3);
    // near first; a newer photo wins between two about as near; a photo
    // facing along the road (a camera in a car on it) over one from a yard
    const along = offRoadAxis(im.computed_compass_angle ?? im.compass_angle, roadH);
    if (along > 45) continue;
    const score = d + age * 2 + along * 0.3;
    if (!best || score < best.score) best = { score, d, x: px, y: py, h: im.computed_compass_angle ?? im.compass_angle, id: im.id, date: new Date(im.captured_at).toISOString().slice(0, 10), url: im.thumb_1024_url, view, camera: [im.make, im.model].filter(Boolean).join(' ') };
  }
  return best;
}

const signGoogle = (pathQuery) => {
  if (!GSECRET) return pathQuery;
  const k = Buffer.from(GSECRET.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = crypto.createHmac('sha1', k).update(pathQuery).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return `${pathQuery}&signature=${sig}`;
};
// Google's metadata (free) returns the default panorama nearest a point,
// not always the newest; positions a little along and across the road often
// find newer drives. The newest street-level panorama among them wins
// (ties: the nearest). The Static API has no date parameter.
const GOOGLE_SAMPLES = [[0, 0], [10, 0], [-10, 0], [20, 0], [-20, 0], [0, 6], [0, -6], [10, 6], [-10, -6]];
async function googleMeta(lat, lng, radius) {
  const meta = await (await fetch(`https://maps.googleapis.com${signGoogle(`/maps/api/streetview/metadata?location=${lat.toFixed(7)},${lng.toFixed(7)}&radius=${radius}&source=outdoor&key=${GKEY}`)}`)).json();
  // (Google's own cars only: user panoramas are indoor rooms, boats, drones)
  return meta.status === 'OK' && /google/i.test(meta.copyright || '') ? meta : null;
}
async function googleNear(x, y, roadHeading) {
  if (!GKEY) return null;
  // along the road (its heading) and across it
  const a = rad(Number.isFinite(roadHeading) ? roadHeading : 0);
  const ux = Math.sin(a); const uy = Math.cos(a);
  const seen = new Map();
  for (const [along, across] of GOOGLE_SAMPLES) {
    const sx = x + ux * along + uy * across; const sy = y + uy * along - ux * across;
    const [lat, lng] = toLatLng(sx, sy);
    const meta = await googleMeta(lat, lng, along || across ? 12 : SEARCH_M);
    if (!meta || seen.has(meta.pano_id)) continue;
    const [px, py] = toWorld(meta.location.lat, meta.location.lng);
    if (LINES.length && !atStreetLevel(px, py)) continue;
    const d = Math.hypot(px - x, py - y);
    if (d > SEARCH_M) continue;
    seen.set(meta.pano_id, { meta, px, py, d });
  }
  const list = [...seen.values()].filter((c) => !MIN_YEAR || Number(String(c.meta.date || '0').slice(0, 4)) >= MIN_YEAR);
  if (!list.length) return null;
  // newest first (dates are YYYY-MM), then nearest
  list.sort((p, q) => String(q.meta.date || '').localeCompare(String(p.meta.date || '')) || p.d - q.d);
  const { meta, px, py, d } = list[0];
  // facing the spot from the panorama, or along the road when standing on it
  const h = d > 6 ? bearing(x - px, y - py) : (roadHeading ?? 0);
  return { d, x: px, y: py, h, pano: meta.pano_id, date: meta.date || '', lat: meta.location.lat, lng: meta.location.lng, candidates: seen.size, oldest: list[list.length - 1].meta.date || '' };
}
async function googleImage(g, aspect) {
  // (the game screen's shape, so its view and Google's frame the same)
  const w = 640; const hgt = Math.min(640, Math.round(w / aspect));
  const q = `/maps/api/streetview?size=${w}x${hgt}&pano=${g.pano}&heading=${g.h.toFixed(1)}&pitch=-3&fov=${H_FOV}&source=outdoor&key=${GKEY}`;
  const res = await fetch(`https://maps.googleapis.com${signGoogle(q)}`);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

// ── spots ───────────────────────────────────────────────────────────────
// the level's drawn lines (mapng_probes.json v3) as a segment grid
let LINES = [];
const SEG = new Map();
function indexLines(lines) {
  LINES = lines || [];
  LINES.forEach((l, li) => {
    for (let i = 0; i + 1 < l.p.length; i++) {
      const [ax, ay] = l.p[i]; const [bx, by] = l.p[i + 1];
      for (let cx = Math.floor(Math.min(ax, bx) / 32) - 1; cx <= Math.floor(Math.max(ax, bx) / 32) + 1; cx++) {
        for (let cy = Math.floor(Math.min(ay, by) / 32) - 1; cy <= Math.floor(Math.max(ay, by) / 32) + 1; cy++) {
          const k = `${cx},${cy}`;
          if (!SEG.has(k)) SEG.set(k, []);
          SEG.get(k).push([li, i]);
        }
      }
    }
  });
}
// distance from (x, y) to a line's centre (and its height there), per line kind
function nearestLine(x, y, kinds) {
  let best = null;
  for (const [li, i] of SEG.get(`${Math.floor(x / 32)},${Math.floor(y / 32)}`) || []) {
    const l = LINES[li];
    if (!kinds.includes(l.k)) continue;
    const [ax, ay, az] = l.p[i]; const [bx, by, bz] = l.p[i + 1];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (!best || d < best.d) best = { d, l, z: az + (bz - az) * t, grade: Math.abs(bz - az) / Math.sqrt(L2) };
  }
  return best;
}
// the drawn levels under (x, y): every road, deck or tunnel line whose
// carriageway (+2 m) it stands on, with the line's height there
function levelsAt(x, y) {
  const out = [];
  for (const [li, i] of SEG.get(`${Math.floor(x / 32)},${Math.floor(y / 32)}`) || []) {
    const l = LINES[li];
    if (!['road', 'deck', 'tunnel'].includes(l.k)) continue;
    const [ax, ay, az] = l.p[i]; const [bx, by, bz] = l.p[i + 1];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d <= l.hw + 2) out.push({ k: l.k, z: az + (bz - az) * t, d });
  }
  // one entry per level (3 m apart)
  out.sort((a, b) => a.z - b.z);
  return out.filter((v, i) => i === 0 || v.z - out[i - 1].z > 3);
}
// the level a photo was taken on and, where roads stack, the other one:
// a deck spot prefers the deck, a tunnel the tunnel, others the ground road
function cameraLevels(x, y, spot) {
  const lv = levelsAt(x, y);
  if (!lv.length) return { main: null, alt: null };
  const want = spot.k === 'deck' ? 'deck' : spot.k === 'tunnel' ? 'tunnel' : 'road';
  const main = lv.find((v) => v.k === want) || (want === 'road' ? lv.find((v) => v.k !== 'tunnel') : null) || lv[0];
  const alt = lv.find((v) => v !== main) || null;
  return { main, alt };
}

// street level: on a carriageway or a deck (within STREET_M of its edge), or
// on a sidewalk (a tunnel's road counts: its inside is compared too);
// not in a yard, on a roof or indoors
function atStreetLevel(x, y) {
  const r = nearestLine(x, y, ['road', 'deck', 'tunnel']);
  if (r && r.d <= r.l.hw + STREET_M) return true;
  const s = nearestLine(x, y, ['sidewalk']);
  return !!s && s.d <= (s.l.w || 2) + 1.5;
}

function categoryOf(p) {
  if (p.why) return 'failure';
  if (p.k === 'deck') return 'bridge';
  if (p.k === 'under') return 'under';
  if (p.k === 'sidewalk') return 'sidewalk';
  if (p.k === 'tunnel') return 'portal';
  const near = (pred, r) => LINES.some((l) => pred(l) && [l.p[0], l.p[l.p.length - 1]].some((q) => Math.hypot(q[0] - p.x, q[1] - p.y) < r));
  if (near((l) => l.k === 'tunnel', 40)) return 'portal';
  const here = nearestLine(p.x, p.y, ['road']);
  if (here?.l.rb) return 'roundabout';
  if (near((l) => l.k === 'deck', 80)) return 'ramp';
  // three or more drawn road ends meeting near it
  let ends = 0;
  for (const l of LINES) if (l.k === 'road') for (const q of [l.p[0], l.p[l.p.length - 1]]) if (Math.hypot(q[0] - p.x, q[1] - p.y) < 18) ends++;
  if (ends >= 3) return 'junction';
  if (here && here.grade > 0.08) return 'steep';
  return 'street';
}

// spots across the level: every category in turn (test failures first),
// SPACING_M apart
function pickSpots(probes, failures) {
  const pool = new Map(CATEGORIES.map((c) => [c, []]));
  for (const f of failures) pool.get('failure').push({ ...f });
  for (const p of probes) {
    // (portals from the roads at a tunnel's ends: no street photos inside)
    if (!['road', 'deck', 'sidewalk', 'under'].includes(p.k)) continue;
    pool.get(categoryOf(p)).push(p);
  }
  // (spread within a category: walk it with a stride)
  for (const [c, list] of pool) {
    if (c === 'failure' || list.length < 2) continue;
    const stride = Math.max(1, Math.floor(list.length / 12));
    pool.set(c, list.filter((_, i) => i % stride === 0));
  }
  const out = [];
  const far = (p) => out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= SPACING_M);
  let added = true;
  while (added && out.length < SPOTS * 3) {
    added = false;
    for (const c of CATEGORIES) {
      const list = pool.get(c);
      while (list.length) {
        const p = list.shift();
        if (far(p)) { out.push({ ...p, category: c }); added = true; break; }
      }
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
  indexLines(data.lines);
  if (!data.lines) process.stderr.write('(no road lines in this level\'s probes: street level not enforced; re-export for v3 probes)\n');
  const failures = opt('--tests') ? JSON.parse(fs.readFileSync(opt('--tests'), 'utf8')).failures || [] : [];
  fs.mkdirSync(OUT, { recursive: true });
  const fovBefore = await lua('return core_camera.getFovDeg()');
  // the same light for every shot
  const todBefore = await lua(`local t = core_environment.getTimeOfDay() local was = t.time t.time = ${TOD} t.play = false core_environment.setTimeOfDay(t) return tostring(was)`);
  await hideHud();
  // the game screen's shape, from one screenshot
  const probe = jpegSize(await grab());
  const screenAspect = probe ? probe.w / probe.h : 16 / 9;
  const rows = [];
  for (const spot of pickSpots(data.probes, failures)) {
    if (rows.length >= SPOTS) break;
    const mly = SOURCE !== 'google' ? await mapillaryNear(spot.x, spot.y, spot.h) : null;
    const goo = SOURCE !== 'mapillary' ? await googleNear(spot.x, spot.y, spot.h) : null;
    if (!mly && !goo) continue;
    const n = String(rows.length + 1).padStart(2, '0');
    const row = { n, spot, mly, goo, shots: {} };
    // the game from each photo's own place and heading
    if (mly) {
      fs.writeFileSync(path.join(OUT, `${n}_mapillary.jpg`), Buffer.from(await (await fetch(mly.url)).arrayBuffer()));
      // the photo's own vertical view (the wider game screen is cropped to
      // the photo's shape on the page)
      await aim(mly.x, mly.y, spot.z, mly.h, { eye: EYE_MAPILLARY_M, vFov: mly.view.vFov, pitch: mly.view.pitch }); await sleep(900);
      fs.writeFileSync(path.join(OUT, `${n}_game_m.jpg`), await grab());
      row.shots.m = `${n}_game_m.jpg`;
    }
    if (goo) {
      const img = await googleImage(goo, screenAspect);
      if (img) fs.writeFileSync(path.join(OUT, `${n}_google.jpg`), img);
      // on the road level under the panorama; where roads stack, from the
      // other level too (which one Google's car was on is not known)
      const { main, alt } = LINES.length ? cameraLevels(goo.x, goo.y, spot) : { main: null, alt: null };
      const view = { eye: EYE_GOOGLE_M, vFov: vFovFor(H_FOV, screenAspect), pitch: -3 };
      const [, blocked] = String(await aim(goo.x, goo.y, spot.z, goo.h, { ...view, level: main })).split('|');
      await sleep(900);
      fs.writeFileSync(path.join(OUT, `${n}_game_g.jpg`), await grab());
      row.shots.g = `${n}_game_g.jpg`;
      row.gImage = !!img;
      row.level = main ? main.k : 'terrain';
      if (blocked) row.blocked = blocked;
      if (alt) {
        await aim(goo.x, goo.y, spot.z, goo.h, { ...view, level: alt }); await sleep(900);
        fs.writeFileSync(path.join(OUT, `${n}_game_g2.jpg`), await grab());
        row.shots.g2 = `${n}_game_g2.jpg`;
        row.altLevel = alt.k;
      }
    }
    rows.push(row);
    process.stderr.write(`spot ${n}: ${spot.category} ${spot.k} (${Math.round(spot.x)}, ${Math.round(spot.y)})${mly ? ` mapillary ${Math.round(mly.d)} m` : ''}${goo ? ` google ${goo.date} (newest of ${goo.candidates}) ${Math.round(goo.d)} m` : ''}\n`);
  }
  await lua(`core_camera.setFOV(0, ${Number(fovBefore) || 65}) local t = core_environment.getTimeOfDay() t.time = ${Number(todBefore) || 0} core_environment.setTimeOfDay(t) ui_visibility.set(true) return 'ok'`);
  // the page
  const cell = (src, cap, aspect) => `<figure>${src ? `<img src="${src}" loading="lazy"${aspect ? ` style="aspect-ratio:${aspect.toFixed(4)};object-fit:cover"` : ''}>` : '<div class="none">no image</div>'}<figcaption>${cap}</figcaption></figure>`;
  const yearOf = (d) => Number(String(d || '').slice(0, 4)) || null;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Street compare: ${esc(level)}</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#111;color:#ddd}h1{font-size:18px}
.row{border-top:1px solid #333;padding:12px 0}.pair{display:flex;gap:8px;flex-wrap:wrap}
figure{margin:0;flex:1 1 300px;max-width:520px}img{width:100%;border-radius:4px}.none{aspect-ratio:16/10;display:grid;place-items:center;background:#222}
figcaption{font-size:12px;color:#999;margin-top:4px}.why{color:#f88}a{color:#8cf}
</style></head><body><h1>Street photos vs game: ${esc(level)}</h1>
<p>Each row: the real photo and the game from the same place, heading and field of view (Google: ${H_FOV}° wide at ${EYE_GOOGLE_M} m; Mapillary: each photo's own lens, perspective cameras only, at ${EYE_MAPILLARY_M} m, the game cropped to the photo's shape). Mapillary images CC-BY-SA; Google images for viewing only, not stored or used as data.</p>
${rows.map((r) => {
    const [lat, lng] = toLatLng(r.spot.x, r.spot.y);
    const head = `<b>${r.n}</b> [${esc(r.spot.category)}] ${esc(r.spot.k)} ${esc(r.spot.road || '')} at (${Math.round(r.spot.x)}, ${Math.round(r.spot.y)}) · ${lat.toFixed(6)}, ${lng.toFixed(6)}${r.spot.why ? ` · <span class="why">test: ${esc(r.spot.why)}</span>` : ''}`;
    const parts = [];
    const ym = yearOf(r.mly?.date); const yg = yearOf(r.goo?.date);
    const apart = ym && yg && Math.abs(ym - yg) >= YEARS_APART ? ` <span class="why">photos ${Math.abs(ym - yg)} years apart</span>` : '';
    if (r.mly) parts.push(`<div class="pair">${cell(`${r.n}_mapillary.jpg`, `Mapillary ${esc(r.mly.date)}${apart}, ${Math.round(r.mly.d)} m from the spot, heading ${Math.round(r.mly.h)}°, ${r.mly.view.hFov.toFixed(0)}°×${r.mly.view.vFov.toFixed(0)}° view, pitch ${r.mly.view.pitch.toFixed(1)}°${r.mly.camera ? `, ${esc(r.mly.camera)}` : ''} · <a href="https://www.mapillary.com/app/?pKey=${r.mly.id}">open</a>`)}${cell(r.shots.m, `game, same place, heading and lens (${EYE_MAPILLARY_M} m up)`, r.mly.view.aspect)}</div>`);
    if (r.goo) parts.push(`<div class="pair">${cell(r.gImage ? `${r.n}_google.jpg` : '', `Google ${esc(r.goo.date)}${yearOf(r.goo.date) && new Date().getFullYear() - yearOf(r.goo.date) >= OLD_YEARS ? ` <span class="why">${new Date().getFullYear() - yearOf(r.goo.date)} years old (newest of ${r.goo.candidates} nearby)</span>` : ` (newest of ${r.goo.candidates} nearby)`}, ${Math.round(r.goo.d)} m from the spot, heading ${Math.round(r.goo.h)}°, ${H_FOV}° wide · <a href="https://www.google.com/maps/@?api=1&map_action=pano&pano=${r.goo.pano}&heading=${Math.round(r.goo.h)}">open</a>`)}${cell(r.shots.g, `game on the ${esc(r.level)} level, same place, heading and ${H_FOV}° view (${EYE_GOOGLE_M} m up)${r.blocked ? ` <span class="why">camera under ${esc(r.blocked)}</span>` : ''}`)}${r.shots.g2 ? cell(r.shots.g2, `game on the ${esc(r.altLevel)} level (roads stack here)`) : ''}</div>`);
    return `<div class="row"><div>${head}</div>${parts.join('')}</div>`;
  }).join('\n')}
</body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, 'spots.json'), JSON.stringify(rows.map(({ shots, ...r }) => r), null, 1));
  // the review to fill in: each pair scored per RUBRIC item, notes; kept
  // (no images) so scores can be compared over runs
  const review = {
    level, date: new Date().toISOString().slice(0, 10), rubric: RUBRIC, scale: '0 wrong, 1 partly, 2 matches, null not visible',
    pairs: rows.map((r) => ({
      n: r.n, category: r.spot.category, kind: r.spot.k, road: r.spot.road || null, x: Math.round(r.spot.x), y: Math.round(r.spot.y),
      test: r.spot.why || null, google: r.goo ? { pano: r.goo.pano, date: r.goo.date, d: Math.round(r.goo.d), h: Math.round(r.goo.h) } : null,
      level: r.level || null, altLevel: r.altLevel || null, matchedLevel: null, cameraBlocked: r.blocked || null,
      scores: Object.fromEntries(RUBRIC.map((k) => [k, null])), notes: '',
    })),
  };
  if (!fs.existsSync(path.join(OUT, 'review.json'))) fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 1));
  console.log(`${rows.length} spot(s): ${path.join(OUT, 'index.html')}`);
}

main().catch((err) => { console.error(String(err?.message || err)); process.exit(2); });
