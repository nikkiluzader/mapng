/**
 * Regional tree choice for BeamNG exports.
 *
 * Every tree used to be the biome's single "default" model (a West Coast USA
 * export of Phoenix: 1,240 identical aspens). Trees now come from groups of
 * stock models with measured heights (services/beamngTreeLibrary.js, after
 * BeamNG.Earth, MIT) and the group follows the place, after BeamNG.Earth's
 * vegetation.regional():
 *
 *   - OSM says what it knows first: palms, conifers (leaf_type, genus,
 *     species), broadleaves; otherwise a regional conifer share decides;
 *   - the West Coast: radiata pines (redwoods only in Northern California)
 *     and coast oaks / eucalyptus for the smaller broadleaves;
 *   - the dry West: irrigated broadleaves in towns, junipers and desert
 *     bushes in open country, pines in its forests (Flagstaff's ponderosa);
 *   - hot desert towns (Phoenix, Tucson, Las Vegas): many palms;
 *   - warm coasts and the tropics: palms, tropical trees for tall broadleaves.
 *
 * A tree's OSM height picks the model nearest it and scales it to match;
 * without one a hash of the position picks the model and a small scale jitter,
 * so the same tree always comes out the same.
 *
 * The biome still shows: its own signature models (Italy's olives and
 * cypresses, the jungle's tropical trees) join the candidates.
 */
import { TREE_GROUPS, TREE_ITEMS } from './beamngTreeLibrary.js';

export const TREE_GROUP_NAMES = Object.keys(TREE_GROUPS);

const SCALE_MIN = 0.7;
const SCALE_MAX = 1.4;

export function hash01(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ── Coarse climate from the position (until a species / land-cover map) ─────

const northAmerica = (lat, lon) => lat > 24 && lon > -170 && lon < -50;

export function treeClimate(lat, lon) {
  const westCoast = lon < -114 && lat > 32 && lat < 49.5;
  const dryWest = lon < -102 && lat > 25 && lat < 46 && !(lon < -121 && lat > 37);
  const tropics = Math.abs(lat) < 23.5;
  const warmCoast = (lat < 30.5 && lon > -100 && lon < -79) || (lat < 34.6 && lon < -114 && lat > 20);
  // Low hot deserts inland (Phoenix, Tucson, Las Vegas, El Paso); the warm coast
  // (Los Angeles, Palm Springs) has its own, higher palm share.
  const hotDesert = dryWest && lat < 36.5 && !warmCoast;
  const norCal = westCoast && lat > 36.5;
  return { westCoast, dryWest, tropics, warmCoast, hotDesert, norCal };
}

/** Regional share of conifers among untagged trees (BeamNG.Earth _conifer_share). */
export function coniferShare(lat, lon) {
  const alat = Math.abs(lat);
  if (northAmerica(lat, lon)) {
    const share = lon < -100 ? 0.7 : 0.2;
    return alat > 45 ? Math.max(share, 0.6) : share;
  }
  if (lat > 30 && lat < 46 && lon > -10 && lon < 40) return 0.3;   // Mediterranean pines
  if (alat < 23.5) return 0.02;
  if (alat < 35) return 0.08;
  if (alat <= 45) return 0.2;
  return 0.6;
}

// ── What OSM says about a tree ───────────────────────────────────────────────

export function treeHintFromTags(tags = {}) {
  const species = `${tags.species || ''} ${tags['species:en'] || ''} ${tags.taxon || ''}`.toLowerCase();
  const genus = String(tags.genus || '').toLowerCase();
  const leafType = String(tags.leaf_type || '').toLowerCase();
  const wood = String(tags.wood || '').toLowerCase();
  if (species.includes('palm') || /phoenix|washingtonia|syagrus|cocos|roystonea|sabal|arecaceae/.test(genus) || leafType === 'palm') return 'palm';
  if (species.includes('olive') || genus.includes('olea')) return 'olive';
  if (species.includes('cypress') || genus.includes('cupress')) return 'cypress';
  if (leafType === 'needleleaved' || wood === 'coniferous'
    || /pine|fir|spruce|cedar|juniper|redwood|sequoia/.test(species)
    || /pinus|abies|picea|cedrus|juniperus|sequoia|pseudotsuga|thuja/.test(genus)) return 'conifer';
  if (leafType === 'broadleaved' || wood === 'deciduous') return 'deciduous';
  return null;
}

function parseHeight(tags = {}) {
  const raw = String(tags.height ?? tags.est_height ?? '').trim().toLowerCase();
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = /ft|'/.test(raw) ? n * 0.3048 : n;
  return m >= 0.5 && m <= 120 ? m : null;
}

// ── Group choice ─────────────────────────────────────────────────────────────

/**
 * The tree group for one tree / bush.
 * kind: 'tree' | 'shrub'; area: true inside a mapped wood / forest polygon.
 */
export function chooseTreeGroup({ kind = 'tree', tags = {}, lat, lon, urban = false, area = false, height = null, seed = '' }) {
  const c = treeClimate(lat, lon);
  const u = hash01(seed, 'group');
  if (kind === 'shrub') {
    return c.dryWest || (!northAmerica(lat, lon) && Math.abs(lat) < 42 && c.hotDesert) ? 'desert_shrub' : 'shrub';
  }
  const hint = treeHintFromTags(tags);
  let g;
  if (hint === 'palm') g = 'palm';
  else if (hint === 'conifer') g = 'conifer';
  else if (hint === 'deciduous') g = 'deciduous';
  else g = u < coniferShare(lat, lon) * (urban ? 0.5 : 1) ? 'conifer' : 'deciduous';

  if (g === 'palm') return g;
  // Towns of the dry West are irrigated broadleaves far more than conifers.
  if (c.dryWest && urban && g === 'conifer' && !hint && hash01(seed, 'dwt') < 0.8) g = 'deciduous';
  // The West Coast's pines and oaks.
  if (c.westCoast && g === 'conifer') g = 'pine_west';
  if (c.westCoast && g === 'deciduous' && (height == null || height < 11)) g = 'oak_west';
  // Dry open country: junipers; its forests: pines (ponderosa stand-in).
  if (c.dryWest && !urban && !area && (height == null || height < 9) && !hint) g = 'juniper';
  if (c.dryWest && g === 'conifer') g = 'pine_west';
  // Palms: hot desert towns, warm coasts and the tropics.
  const palmShare = c.hotDesert ? (urban ? 0.35 : 0.05) : (c.warmCoast || c.tropics) ? (urban ? 0.6 : 0.2) : 0;
  if (!hint && palmShare > 0 && hash01(seed, 'palm') < palmShare) return 'palm';
  if (c.tropics && g === 'deciduous' && (height == null || height >= 12) && !hint) g = 'tropical';
  return g;
}

// ── Model choice ─────────────────────────────────────────────────────────────

function candidates(group, { lat, lon, extra = [] }) {
  const c = treeClimate(lat, lon);
  let list = (TREE_GROUPS[group] || TREE_GROUPS.deciduous).map(([type, height]) => ({ type, height }));
  // Redwoods only where they grow (Northern California's coast); firs stay out
  // of hot desert towns (their pines: the radiata / scots pine models).
  if (!c.norCal) list = list.filter(({ type }) => !type.startsWith('redwood'));
  if (c.hotDesert && group === 'pine_west') list = list.filter(({ type }) => !type.includes('douglasfir'));
  return [...list, ...extra];
}

/**
 * { type, scale } for one tree: the model nearest its height when known,
 * else a hashed model with a small scale jitter.
 * extra: biome signature models [{ type, height }] joining the candidates.
 */
export function chooseTreeItem(group, { tags = {}, lat, lon, seed = '', extra = [] } = {}) {
  const list = candidates(group, { lat, lon, extra });
  if (list.length === 0) return null;
  const height = parseHeight(tags);
  if (height != null) {
    let best = list[0];
    for (const it of list) if (Math.abs(it.height - height) < Math.abs(best.height - height)) best = it;
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, height / best.height));
    return { type: best.type, scale };
  }
  const pick = list[Math.min(list.length - 1, Math.floor(hash01(seed, 'item') * list.length))];
  return { type: pick.type, scale: 0.85 + 0.3 * hash01(seed, 'scale') };
}

/** Height of a library item (m), or null. */
export const treeItemHeight = (type) => {
  for (const members of Object.values(TREE_GROUPS)) {
    for (const [name, h] of members) if (name === type) return h;
  }
  return null;
};

export const isTreeLibraryItem = (type) => Object.prototype.hasOwnProperty.call(TREE_ITEMS, type);
