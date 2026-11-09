// What kinds of trees grow where an export is: the tree species people have
// recorded around it (iNaturalist's research-grade observations, an open,
// worldwide public API), sorted into the kinds the tree library can show.
// A town of palms and live oaks came out aspens, beeches and Douglas firs
// from a climate rule by latitude alone. OSM's own species / genus tags on
// a tree use the same table (beamngTrees.treeHintFromTags).
//
// Kinds: palm, live_oak (broad evergreen oaks), oak, broadleaf, conifer,
// juniper, eucalyptus, olive, cypress, tropical (mangrove: named, a tree of
// the tidal shore, left out of a town's mix). Genera not listed (herbs,
// grasses, shrubs) aren't trees here and are left out.

const GENUS_KIND = {
  // palms
  sabal: 'palm', washingtonia: 'palm', phoenix: 'palm', syagrus: 'palm', cocos: 'palm', roystonea: 'palm',
  trachycarpus: 'palm', butia: 'palm', livistona: 'palm', chamaerops: 'palm', archontophoenix: 'palm',
  dypsis: 'palm', bismarckia: 'palm', wodyetia: 'palm', howea: 'palm', jubaea: 'palm', brahea: 'palm', elaeis: 'palm',
  // oaks (the evergreen ones by species, below)
  quercus: 'oak', lithocarpus: 'oak', notholithocarpus: 'oak',
  // broadleaves
  acer: 'broadleaf', ulmus: 'broadleaf', fraxinus: 'broadleaf', platanus: 'broadleaf', betula: 'broadleaf', fagus: 'broadleaf',
  tilia: 'broadleaf', liquidambar: 'broadleaf', magnolia: 'broadleaf', populus: 'broadleaf', prunus: 'broadleaf', carya: 'broadleaf',
  celtis: 'broadleaf', liriodendron: 'broadleaf', juglans: 'broadleaf', aesculus: 'broadleaf', castanea: 'broadleaf', carpinus: 'broadleaf',
  alnus: 'broadleaf', salix: 'broadleaf', robinia: 'broadleaf', gleditsia: 'broadleaf', catalpa: 'broadleaf', morus: 'broadleaf',
  sorbus: 'broadleaf', malus: 'broadleaf', pyrus: 'broadleaf', cercis: 'broadleaf', cornus: 'broadleaf', nyssa: 'broadleaf',
  ilex: 'broadleaf', lagerstroemia: 'broadleaf', cinnamomum: 'broadleaf', persea: 'broadleaf', ailanthus: 'broadleaf', sassafras: 'broadleaf',
  diospyros: 'broadleaf', zelkova: 'broadleaf', ginkgo: 'broadleaf', koelreuteria: 'broadleaf', sapium: 'broadleaf', triadica: 'broadleaf',
  melia: 'broadleaf', jacaranda: 'broadleaf', schinus: 'broadleaf', laurus: 'broadleaf', arbutus: 'broadleaf', umbellularia: 'broadleaf',
  // conifers (junipers and cypresses apart)
  pinus: 'conifer', abies: 'conifer', picea: 'conifer', pseudotsuga: 'conifer', tsuga: 'conifer', cedrus: 'conifer', larix: 'conifer',
  sequoia: 'conifer', sequoiadendron: 'conifer', taxodium: 'conifer', metasequoia: 'conifer', araucaria: 'conifer', podocarpus: 'conifer',
  taxus: 'conifer', calocedrus: 'conifer',
  juniperus: 'juniper', thuja: 'juniper', platycladus: 'juniper',
  cupressus: 'cypress', hesperocyparis: 'cypress', chamaecyparis: 'cypress',
  eucalyptus: 'eucalyptus', corymbia: 'eucalyptus', angophora: 'eucalyptus',
  olea: 'olive',
  // the tropics' and the coasts' own
  // (mangroves: in tidal water only, never a street's; out of the mix)
  avicennia: 'mangrove', rhizophora: 'mangrove', laguncularia: 'mangrove', conocarpus: 'mangrove', bruguiera: 'mangrove', sonneratia: 'mangrove',
  ficus: 'tropical',
  bursera: 'tropical', coccoloba: 'tropical', swietenia: 'tropical', delonix: 'tropical', terminalia: 'tropical', tabebuia: 'tropical',
  handroanthus: 'tropical', mangifera: 'tropical', ceiba: 'tropical', tectona: 'tropical', bauhinia: 'tropical', spathodea: 'tropical',
};

// oaks green all year: a broad, spreading crown, not a deciduous oak's
const EVERGREEN_OAKS = new Set(['virginiana', 'geminata', 'agrifolia', 'wislizeni', 'chrysolepis', 'ilex', 'suber', 'rotundifolia',
  'coccifera', 'engelmannii', 'emoryi', 'oblongifolia', 'laurifolia', 'hemisphaerica', 'myrtifolia', 'chapmanii', 'fusiformis', 'tomentella']);

/** The kind of tree a scientific name ("Genus species", or a genus) is, or null. */
export function speciesKind(name) {
  const [genus = '', epithet = ''] = String(name || '').trim().toLowerCase().split(/\s+/);
  const kind = GENUS_KIND[genus] ?? null;
  if (kind === 'oak' && EVERGREEN_OAKS.has(epithet)) return 'live_oak';
  return kind;
}

const MIX_MIN_RECORDS = 12;       // fewer tree records than this: no mix (the climate rule decides)
const MIX_MIN_SHARE = 0.03;       // kinds under this share dropped (one stray record of a garden tree)

/**
 * The share of each kind among the trees recorded: counts [{ name, count }]
 * (scientific names). Returns { shares: { kind: share }, records } or null
 * with too few tree records.
 */
export function treeMixFromCounts(counts = []) {
  const byKind = {};
  let records = 0;
  for (const { name, count } of counts) {
    const kind = speciesKind(name);
    if (!kind || kind === 'mangrove' || !(count > 0)) continue;
    byKind[kind] = (byKind[kind] || 0) + count;
    records += count;
  }
  if (records < MIX_MIN_RECORDS) return null;
  const kept = Object.entries(byKind).filter(([, n]) => n / records >= MIX_MIN_SHARE);
  const total = kept.reduce((s, [, n]) => s + n, 0);
  return { shares: Object.fromEntries(kept.map(([k, n]) => [k, n / total])), records };
}

/** A kind drawn from a mix by u in [0, 1). */
export function kindFromMix(mix, u) {
  let acc = 0;
  const entries = Object.entries(mix?.shares || {});
  for (const [kind, share] of entries) { acc += share; if (u < acc) return kind; }
  return entries.length ? entries[entries.length - 1][0] : null;
}

const MIX_MIN_SPAN_DEG = 0.03;    // looked for over at least ~3 km, an export smaller than that grown to it
const MIX_TIMEOUT_MS = 8000;
const INAT_SPECIES_COUNTS = 'https://api.inaturalist.org/v1/observations/species_counts';
export const TREE_MIX_CREDIT = 'Tree species mix: iNaturalist research-grade observations (api.inaturalist.org)';

/**
 * The tree mix around bounds ({ north, south, east, west }), from
 * iNaturalist's species counts; null when offline, slow or too few records
 * (the climate rule decides then). Only the box is sent.
 */
export async function fetchTreeSpeciesMix(bounds, { fetchImpl = globalThis.fetch, timeoutMs = MIX_TIMEOUT_MS } = {}) {
  if (!bounds || typeof fetchImpl !== 'function') return null;
  // (too few records over ~3 km, a rural place: once more over ~11 km)
  const near = await fetchMixOver(bounds, MIX_MIN_SPAN_DEG, fetchImpl, timeoutMs);
  if (near) return near;
  return fetchMixOver(bounds, MIX_WIDE_SPAN_DEG, fetchImpl, timeoutMs);
}
const MIX_WIDE_SPAN_DEG = 0.1;

async function fetchMixOver(bounds, minSpan, fetchImpl, timeoutMs) {
  const grow = (lo, hi) => { const span = hi - lo; const pad = Math.max(0, (minSpan - span) / 2); return [lo - pad, hi + pad]; };
  const [south, north] = grow(bounds.south, bounds.north);
  const [west, east] = grow(bounds.west, bounds.east);
  // (iNaturalist reads swlng > nelng as a box across the date line, and
  // clamps anything past ±180, so a date-line export is sent in that form)
  const wrap = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
  const params = new URLSearchParams({
    swlat: south.toFixed(5), swlng: wrap(west).toFixed(5), nelat: north.toFixed(5), nelng: (east === 180 ? 180 : wrap(east)).toFixed(5),
    iconic_taxa: 'Plantae', quality_grade: 'research', per_page: '500',
  });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${INAT_SPECIES_COUNTS}?${params}`, { signal: controller?.signal, headers: { Accept: 'application/json' } });
    if (!res?.ok) return null;
    const body = await res.json();
    const counts = (body?.results || []).map((r) => ({ name: r?.taxon?.name, count: r?.count }));
    return treeMixFromCounts(counts);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The local tree mix read while generating (Generate Data / Preview 3D), kept
 * on the terrain as treeSpeciesMix: the export reads it and downloads
 * nothing (null: no records here, or offline; the climate rule decides).
 */
export async function attachTreeSpecies(terrainData, { onProgress } = {}) {
  if (!terrainData?.bounds || terrainData.treeSpeciesMix !== undefined) return terrainData;
  onProgress?.('Reading which trees grow here (iNaturalist records)...');
  try {
    terrainData.treeSpeciesMix = await fetchTreeSpeciesMix(terrainData.bounds);
  } catch {
    terrainData.treeSpeciesMix = null;
  }
  return terrainData;
}
