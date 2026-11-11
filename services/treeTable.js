// Which trees an area gets: the kinds the export will plant here and the
// models that stand for each, shown in Fine-tuning before exporting (asked
// for as the first step towards choosing tree models: MR, Fizz_Mechanic).
//
// Nothing is decided here: a few thousand trees are drawn with the export's
// own rules (beamngTrees.chooseTreeGroup / chooseTreeItem) for an untagged
// tree in a wood, at heights sampled from the terrain, and counted. So the
// table follows the local records (treeSpecies.js), the climate rule where
// there are none, and the mountains' conifer line, as the export does.
// Not counted: trees whose species OSM names, a biome's own signature models
// that join a group at export, and the forest floor (ferns, bushes).
import { chooseTreeGroup, chooseTreeItem } from './beamngTrees.js';

const DEFAULT_SAMPLES = 2000;
const MIN_SHARE = 0.005;          // kinds under half a percent are left out of the table

/** A model's name as shown: 'mapng_tree_tree_oak_large_b' → 'oak large b'. */
export const treeModelLabel = (type) => String(type || '').replace(/^mapng_tree_/, '').replace(/^tree_/, '').replace(/_/g, ' ').trim();

/** Up to `count` ground heights (m above the sea) spread evenly over a terrain's height map. */
export function sampleElevations(heightMap, count = 256) {
  const n = heightMap?.length || 0;
  if (!n) return [];
  const out = [];
  const step = Math.max(1, Math.floor(n / count));
  // (an odd stride, so samples don't fall down one column of a power-of-two grid)
  for (let i = Math.floor(step / 2); i < n && out.length < count; i += step | 1) {
    const v = heightMap[i];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * @param {object} p
 * @param {number} p.lat, p.lon      the area's centre
 * @param {object|null} p.mix        terrainData.treeSpeciesMix ({ shares, records }) or null
 * @param {number[]} [p.elevations]  ground heights to draw the trees at (none: the lowland rule)
 * @returns {{ source: 'records'|'climate', records: number,
 *            rows: { group: string, share: number, models: { type: string, share: number }[] }[] }}
 */
export function treeTable({ lat, lon, mix = null, elevations = [], samples = DEFAULT_SAMPLES } = {}) {
  const usable = mix && mix.shares && Object.keys(mix.shares).length ? mix : null;
  const groups = new Map();
  let total = 0;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    for (let i = 0; i < samples; i++) {
      const seed = `table:${i}`;
      const elevation = elevations.length ? elevations[i % elevations.length] : null;
      const group = chooseTreeGroup({ kind: 'tree', lat, lon, area: true, seed, mix: usable, elevation });
      const item = chooseTreeItem(group, { lat, lon, seed });
      if (!item) continue;
      if (!groups.has(group)) groups.set(group, { n: 0, models: new Map() });
      const g = groups.get(group);
      g.n++;
      g.models.set(item.type, (g.models.get(item.type) || 0) + 1);
      total++;
    }
  }
  const rows = [...groups.entries()]
    .map(([group, g]) => ({
      group,
      share: g.n / total,
      models: [...g.models.entries()].map(([type, n]) => ({ type, share: n / total })).sort((a, b) => b.share - a.share || a.type.localeCompare(b.type)),
    }))
    .filter((r) => r.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share || a.group.localeCompare(b.group));
  return { source: usable ? 'records' : 'climate', records: usable ? Number(usable.records) || 0 : 0, rows };
}
