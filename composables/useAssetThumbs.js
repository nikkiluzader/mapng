// The game models behind each What to build item, with their photos: only where the site serves the asset review
// data (/api/asset-page/, the dev site: worker/assetPage.js). Anywhere else the request finds nothing and the UI
// shows nothing more than before. Loaded once, when first asked for.
import { ref } from 'vue';

const NONE_KEY = 'mapng_asset_page_none';
const NONE_FOR_MS = 24 * 3600 * 1000;
const byItem = ref(null);   // { [itemId]: [{ shape, name, thumb, used, is, tag }] }, or null where there is none
let asked = false;

const SIGN_ITEMS = new Set(['signs', 'infoBoards', 'billboards']);

/** data.json -> the models of each item, those an export places today first, one entry per model. */
export function modelsByItem(data) {
  const out = {};
  for (const t of data?.tags || []) {
    if (!t.item) continue;
    for (const a of t.assets || []) {
      const m = data.models?.[a.shape];
      if (!m?.thumb) continue;
      // (a sign stands with the signs, whatever its tag's item: a race track's or a motorway's signs were listed
      // among the road surfaces)
      const list = (out[m.sign && !SIGN_ITEMS.has(t.item) ? 'signs' : t.item] ||= []);
      const have = list.find((x) => x.shape === a.shape);
      // (uses: each tag the model stands for, and whether an export places it for that tag today)
      if (have) { have.used = have.used || !!a.used; have.uses.push({ tag: t.tag, used: !!a.used, region: a.region || 'any' }); continue; }
      list.push({ shape: a.shape, name: m.name, thumb: m.thumb, used: !!a.used, is: a.is || '', tag: t.tag, level: m.level || '', size: m.size || null, kind: m.kind || '', uses: [{ tag: t.tag, used: !!a.used, region: a.region || 'any' }] });
    }
  }
  for (const list of Object.values(out)) list.sort((p, q) => Number(q.used) - Number(p.used));
  return out;
}

/** Which tags an area's map data holds: a test for a library tag ("amenity=bench", "traffic_sign=*"). */
export function tagsPresent(features) {
  const pairs = new Set(); const keys = new Set();
  for (const f of features || []) for (const [k, v] of Object.entries(f?.tags || {})) { if (v == null || v === 'no') continue; keys.add(k); pairs.add(`${k}=${v}`); }
  return (tag) => { const i = tag.indexOf('='); const k = tag.slice(0, i); return tag.slice(i + 1) === '*' ? keys.has(k) : pairs.has(tag); };
}

/**
 * Of an item's models, those this export can place: a model an export places today, for a tag this area's map data
 * holds, of this area's region. As the export picks (services/tagModels.js): a tag with models of the area's own
 * region uses those, else the ones for everywhere. (Every candidate for every tag is the review page's.)
 */
export function modelsInUse(list, present, region = 'any') {
  // (per tag: has the area's region models of its own among the placed ones?)
  const own = new Set();
  for (const m of list || []) for (const u of m.uses || []) if (u.used && region !== 'any' && u.region === region) own.add(u.tag);
  return (list || []).filter((m) => (m.uses || []).some((u) => u.used && present(u.tag) && (own.has(u.tag) ? u.region === region : (u.region || 'any') === 'any')));
}

/** Whether this page is one that may serve the model photos: the dev site, or a local server. */
export const assetDataSite = (host = (typeof location !== 'undefined' ? location.hostname : '')) => host === 'dev.mapng.com' || host === 'localhost' || host === '127.0.0.1';

export function useAssetThumbs() {
  // (shelved until the game's developers agree to the photos being public: asked for only on the dev site and on
  // a developer's own machine, so the public site and the desktop app make no request at all. To switch the feature
  // on for everyone later, drop this test and set ASSET_PAGE on the public worker.)
  if (!asked && typeof fetch === 'function' && assetDataSite()) {
    asked = true;
    // (a site that does not serve the data says so once: remembered for NONE_FOR_MS, not asked on every visit)
    let none = 0; try { none = Number(localStorage.getItem(NONE_KEY)) || 0; } catch { /* storage blocked */ }
    if (!(Date.now() - none < NONE_FOR_MS)) {
      fetch('/api/asset-page/data.json', { credentials: 'same-origin' })
        .then((r) => {
          if (r.ok && String(r.headers.get('Content-Type') || '').includes('json')) return r.json();
          if (r.status === 404) { try { localStorage.setItem(NONE_KEY, String(Date.now())); } catch { /* storage blocked */ } }
          return null;
        })
        .then((d) => { if (d?.tags) { byItem.value = modelsByItem(d); try { localStorage.removeItem(NONE_KEY); } catch { /* storage blocked */ } } })
        .catch(() => {});
    }
  }
  return { assetModels: byItem, thumbUrl: (m) => `/api/asset-page/t/${m.thumb}` };
}
