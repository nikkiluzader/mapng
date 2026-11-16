// The game models behind each What to build item, with their photos: only where the site serves the asset review
// data (/api/asset-page/, the dev site: worker/assetPage.js). Anywhere else the request finds nothing and the UI
// shows nothing more than before. Loaded once, when first asked for.
import { ref } from 'vue';

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
      if (have) { have.used = have.used || !!a.used; continue; }
      list.push({ shape: a.shape, name: m.name, thumb: m.thumb, used: !!a.used, is: a.is || '', tag: t.tag });
    }
  }
  for (const list of Object.values(out)) list.sort((p, q) => Number(q.used) - Number(p.used));
  return out;
}

export function useAssetThumbs() {
  if (!asked && typeof fetch === 'function') {
    asked = true;
    fetch('/api/asset-page/data.json', { credentials: 'same-origin' })
      .then((r) => (r.ok && String(r.headers.get('Content-Type') || '').includes('json') ? r.json() : null))
      .then((d) => { if (d?.tags) byItem.value = modelsByItem(d); })
      .catch(() => {});
  }
  return { assetModels: byItem, thumbUrl: (m) => `/api/asset-page/t/${m.thumb}` };
}
