/**
 * Road-name zones for city.sites.json.
 *
 * The stock minimap's label is the name of the highest-priority Sites zone
 * the camera is in (ui/apps/minimap/additionalInfo.lua: gameplay_city
 * .getHighestPrioZone), the level's title outside every zone. Official levels
 * (west_coast_usa: agave_trail_road, ...) outline their roads as zones, so the
 * label names the road being driven. Here every named road gets one: thin
 * strips along its carriageways, a few hundred metres each, each between a
 * floor and a ceiling round its own height, so on an overpass the deck's road
 * is named and under it the road below.
 */

const CHUNK_M = 150;            // strip length
const SIDE_M = 1.5;             // past the carriageway's edge
const FLOOR_M = 1.5;            // below the road's lowest point
const CEILING_M = 5;            // above its highest (the camera rides over the car)

/** The name a road is labelled with: its name, else its ref ("I 295 / US 1"). */
export function roadLabel(tags = {}) {
  const name = String(tags.name ?? '').trim();
  if (name) return name;
  const ref = String(tags.ref ?? '').trim();
  return ref ? ref.split(';').map((r) => r.trim()).filter(Boolean).join(' / ') : null;
}

// Split a polyline [[x, y, z]...] into pieces of about CHUNK_M (sharing ends).
function chunks(nodes) {
  const out = [];
  let piece = [nodes[0]];
  let len = 0;
  for (let i = 1; i < nodes.length; i++) {
    len += Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]);
    piece.push(nodes[i]);
    if (len >= CHUNK_M && i < nodes.length - 1) {
      out.push(piece);
      piece = [nodes[i]];
      len = 0;
    }
  }
  if (piece.length > 1) out.push(piece);
  return out;
}

// The strip round a piece: its left edge forward, its right edge back.
function outline(piece, half) {
  const left = [];
  const right = [];
  for (let i = 0; i < piece.length; i++) {
    const a = piece[Math.max(0, i - 1)];
    const b = piece[Math.min(piece.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const [x, y, z] = piece[i];
    left.push([x + nx * half, y + ny * half, z]);
    right.push([x - nx * half, y - ny * half, z]);
  }
  return [...left, ...right.reverse()];
}

const round = (v) => Math.round(v * 100) / 100;

/**
 * Zones for city.sites.json from the exported carriageways
 * ([{ nodes: [[x, y, z, w]...], half, tags, bridge }]). Bridges outrank the
 * ground (where a ceiling and a floor overlap, the deck's road is named).
 */
export function buildRoadNameZones(carriageways) {
  const zones = [];
  for (const cw of carriageways) {
    const label = roadLabel(cw.tags);
    if (!label || !Array.isArray(cw.nodes) || cw.nodes.length < 2) continue;
    for (const piece of chunks(cw.nodes)) {
      const zs = piece.map((n) => n[2]);
      const lo = Math.min(...zs);
      const hi = Math.max(...zs);
      const cx = piece.reduce((s, n) => s + n[0], 0) / piece.length;
      const cy = piece.reduce((s, n) => s + n[1], 0) / piece.length;
      const priority = cw.bridge ? 2 : 1;
      zones.push({
        name: label,
        oldId: zones.length + 1,
        color: [1, 1, 1],
        customFields: { names: ['priority'], types: { priority: 'number' }, values: { priority }, tags: [] },
        top: { active: true, normal: [0, 0, 1], pos: [round(cx), round(cy), round(hi + CEILING_M)] },
        bot: { active: true, normal: [0, 0, -1], pos: [round(cx), round(cy), round(lo - FLOOR_M)] },
        vertices: outline(piece, (cw.half ?? 3) + SIDE_M).map(([x, y, z]) => [round(x), round(y), round(z)]),
      });
    }
  }
  return zones;
}
