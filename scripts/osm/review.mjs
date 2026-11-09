#!/usr/bin/env node
// Review a batch of proposed OSM tag fixes against the live data and real photos.
//
//   node scripts/osm/review.mjs refs/osm-fixes/<batch>.json            gather + write <batch>.review.html
//   node scripts/osm/review.mjs <batch>.json --approve w123,w456        mark proposals approved
//   node scripts/osm/review.mjs <batch>.json --skip w789                mark proposals skipped
//
// Per proposal: the element as it is on the server now (its version, its tags; a change since the
// proposal was written is flagged), the tag diff, the written evidence, and photos to judge it by:
// Mapillary street-level images round the element (CC BY-SA, usable as an OSM source) and Wikimedia
// Commons (the item's Wikidata image and Commons category, and geotagged photos nearby). Nothing is
// uploaded here: apply.mjs does that, for approved proposals only. Google Street View is never a source.
import fs from 'node:fs';
import path from 'node:path';
import { SERVERS, getElement, readEnv, UA, applyChange, stillAsSeen } from './common.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => a.endsWith('.json'));
if (!file) { console.error('usage: review.mjs <batch>.json [--approve ids] [--skip ids]'); process.exit(2); }
const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, `${JSON.stringify(batch, null, 1)}\n`);
const listArg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? (argv[i + 1] || '').split(',').filter(Boolean) : []; };
const keyOf = (p) => `${p.type[0]}${p.id}`;

// --approve / --skip: record the decision and stop
const approve = listArg('--approve'); const skip = listArg('--skip');
if (approve.length || skip.length) {
  for (const p of batch.proposals) {
    if (approve.includes(keyOf(p))) { p.status = 'approved'; p.decidedAt = new Date().toISOString(); }
    if (skip.includes(keyOf(p))) { p.status = 'skipped'; p.decidedAt = new Date().toISOString(); }
  }
  save();
  for (const p of batch.proposals) console.log(`${keyOf(p).padEnd(14)} ${String(p.status || 'proposed').padEnd(9)} ${p.name || ''}`);
  process.exit(0);
}

const live = SERVERS.live;
const photoDir = file.replace(/\.json$/, '.photos');
fs.mkdirSync(photoDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, headers = { 'User-Agent': UA }) {
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(url, { headers }); if (r.ok) return await r.json(); if (r.status === 429) { await sleep(6000); continue; } return null; } catch { await sleep(2000); }
  }
  return null;
}
async function download(url, out, headers = { 'User-Agent': UA }) {
  if (fs.existsSync(out)) return true;
  try { const r = await fetch(url, { headers }); if (!r.ok) return false; fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); return true; } catch { return false; }
}

// the element's shape: its nodes' positions (a way's), for the photo searches
async function shapeOf(p) {
  if (p.type === 'node') { const e = await getElement(live, 'node', p.id); return [[e.lat, e.lon]]; }
  if (p.type === 'way') {
    const d = await getJson(`${live.api}/way/${p.id}/full.json`);
    return (d?.elements || []).filter((e) => e.type === 'node').map((e) => [e.lat, e.lon]);
  }
  const d = await getJson(`${live.api}/relation/${p.id}.json`);
  const ways = (d?.elements?.[0]?.members || []).filter((m) => m.type === 'way').slice(0, 4);
  const pts = [];
  for (const m of ways) { const w = await getJson(`${live.api}/way/${m.ref}/full.json`); pts.push(...(w?.elements || []).filter((e) => e.type === 'node').map((e) => [e.lat, e.lon])); }
  return pts;
}

async function mapillaryNear(pts, dir, max = 8) {
  const tokenM = readEnv('MAPILLARY_ACCESS_TOKEN');
  if (!tokenM || !pts.length) return [];
  // (small boxes at up to 6 points along the element: Mapillary refuses a big one, a long bridge's)
  const pad = 0.0006; const imgs = []; const ids = new Set();
  const step = Math.max(1, Math.floor(pts.length / 6));
  for (let i = 0; i < pts.length; i += step) {
    const [lat, lng] = pts[i];
    const url = `https://graph.mapillary.com/images?fields=id,captured_at,computed_compass_angle,computed_geometry,is_pano,thumb_1024_url&limit=60&bbox=${[lng - pad, lat - pad, lng + pad, lat + pad].join(',')}`;
    const d = await getJson(url, { Authorization: `OAuth ${tokenM}` });
    for (const m of d?.data || []) if (m.thumb_1024_url && !m.is_pano && !ids.has(m.id)) { ids.add(m.id); imgs.push(m); }
  }
  // spread over the element: the newest few from each part of its length, facing different ways
  imgs.sort((a, b) => (b.captured_at || 0) - (a.captured_at || 0));
  const picked = []; const seen = new Set();
  for (const m of imgs) {
    const [lng, lat] = m.computed_geometry?.coordinates || [];
    const near = pts.reduce((best, p, i) => { const dd = Math.hypot(p[0] - lat, (p[1] - lng) * Math.cos(lat * Math.PI / 180)); return dd < best[0] ? [dd, i] : best; }, [Infinity, 0]);
    const cell = `${Math.floor((near[1] / Math.max(1, pts.length)) * 4)}:${Math.round((m.computed_compass_angle || 0) / 90) % 4}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    const out = path.join(dir, `mly_${m.id}.jpg`);
    if (await download(m.thumb_1024_url, out)) picked.push({ file: out, source: 'Mapillary', license: 'CC BY-SA 4.0', url: `https://www.mapillary.com/app/?pKey=${m.id}`, date: m.captured_at ? new Date(m.captured_at).toISOString().slice(0, 10) : '', heading: Math.round(m.computed_compass_angle || 0) });
    if (picked.length >= max) break;
  }
  return picked;
}

async function commonsOf(qid, pts, dir, max = 8) {
  const out = []; const titles = new Set();
  if (qid) {
    const wd = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&format=json`);
    const img = wd?.claims?.P18?.[0]?.mainsnak?.datavalue?.value; if (img) titles.add(`File:${img}`);
    const cat = wd?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
    if (cat) {
      const m = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtype=file&cmlimit=20&format=json&cmtitle=${encodeURIComponent(`Category:${cat}`)}`);
      for (const x of m?.query?.categorymembers || []) titles.add(x.title);
    }
  }
  if (pts.length) {
    const c = pts[Math.floor(pts.length / 2)];
    const g = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsnamespace=6&gsradius=300&gslimit=15&format=json&gscoord=${c[0]}|${c[1]}`);
    for (const x of g?.query?.geosearch || []) titles.add(x.title);
  }
  for (const t of [...titles]) {
    if (out.length >= max) break;
    if (!/\.(jpe?g|png)$/i.test(t)) continue;
    await sleep(700);
    const ii = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&titles=${encodeURIComponent(t)}`);
    const pg = Object.values(ii?.query?.pages || {})[0]?.imageinfo?.[0];
    if (!pg?.thumburl) continue;
    const f = path.join(dir, `commons_${out.length}.jpg`);
    if (await download(pg.thumburl, f)) out.push({ file: f, source: 'Wikimedia Commons', title: t.replace(/^File:/, ''), license: pg.extmetadata?.LicenseShortName?.value || '', url: pg.descriptionurl });
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rows = [];
for (const p of batch.proposals) {
  const k = keyOf(p);
  const dir = path.join(photoDir, k); fs.mkdirSync(dir, { recursive: true });
  const e = await getElement(live, p.type, p.id);
  const check = stillAsSeen(e.tags, p);
  p.liveVersion = e.version; p.liveCheckedAt = new Date().toISOString(); p.drift = check.drift;
  const after = applyChange(e.tags, p.change);
  const pts = await shapeOf(p);
  const photos = [...await mapillaryNear(pts, dir), ...await commonsOf(p.wikidata || e.tags?.wikidata, pts, dir)];
  p.photos = photos.map((ph) => ({ ...ph, file: path.relative(path.dirname(file), ph.file) }));
  console.log(`${k.padEnd(14)} v${e.version} ${check.ok ? 'as proposed' : `CHANGED since the proposal: ${check.drift.join(', ')}`}; ${photos.filter((x) => x.source === 'Mapillary').length} Mapillary, ${photos.filter((x) => x.source !== 'Mapillary').length} Commons photos`);
  const keys = [...new Set([...Object.keys(e.tags || {}), ...Object.keys(after)])].sort();
  const diff = keys.map((kk) => {
    const a = e.tags?.[kk]; const b = after[kk];
    const cls = a === b ? '' : a == null ? 'add' : b == null ? 'del' : 'mod';
    return `<tr class="${cls}"><td>${esc(kk)}</td><td>${esc(a ?? '')}</td><td>${esc(b ?? '')}</td></tr>`;
  }).join('');
  rows.push(`<section><h2>${esc(p.name || k)} <small><a href="https://www.openstreetmap.org/${p.type}/${p.id}">${p.type} ${p.id}</a> v${e.version} · ${esc(p.status || 'proposed')}${p.confidence ? ` · confidence: ${esc(p.confidence)}` : ''}</small></h2>
${check.ok ? '' : `<p class="warn">Changed on OSM since the proposal: ${esc(check.drift.join(', '))}. apply.mjs will refuse it until it is re-proposed.</p>`}
<p>${esc(p.reason)}</p>
<table><tr><th>tag</th><th>now</th><th>proposed</th></tr>${diff}</table>
<ul>${(p.evidence || []).map((ev) => `<li>${ev.url ? `<a href="${esc(ev.url)}">${esc(ev.text)}</a>` : esc(ev.text)}</li>`).join('')}</ul>
<div class="photos">${p.photos.map((ph) => `<figure><a href="${esc(ph.url)}"><img src="${esc(ph.file)}" loading="lazy"></a><figcaption>${esc(ph.source)}${ph.date ? ` ${esc(ph.date)}` : ''}${ph.heading != null ? `, facing ${ph.heading}°` : ''}${ph.title ? `: ${esc(ph.title)}` : ''} · ${esc(ph.license)}</figcaption></figure>`).join('') || '<p>No photos found.</p>'}</div>
<p class="cmd">approve: <code>node scripts/osm/review.mjs ${esc(file)} --approve ${k}</code> · skip: <code>--skip ${k}</code></p></section>`);
}
save();
const html = `<!doctype html><meta charset="utf-8"><title>${esc(batch.title || 'OSM fixes')}</title>
<style>body{font:15px system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;color:#222}h2{margin-top:40px;border-top:1px solid #ccc;padding-top:16px}small{font-weight:normal;color:#666}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ddd;padding:3px 8px;text-align:left;font:13px ui-monospace,monospace}tr.add td{background:#e6ffed}tr.del td{background:#ffeef0}tr.mod td{background:#fff5d6}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}figure{margin:0}img{width:100%;border-radius:4px}figcaption{font-size:12px;color:#555}.warn{background:#ffeef0;padding:6px 10px}.cmd{color:#555;font-size:13px}</style>
<h1>${esc(batch.title || 'OSM fixes')}</h1><p>${esc(batch.description || '')}</p><p>Checked against the live OSM data ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Photos: Mapillary (CC BY-SA 4.0) and Wikimedia Commons (licence per photo). Nothing here has been uploaded.</p>${rows.join('\n')}`;
const out = file.replace(/\.json$/, '.review.html');
fs.writeFileSync(out, html);
console.log(`review page: ${out}`);
