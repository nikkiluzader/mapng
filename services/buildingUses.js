// What a building is used for, from its own tags or a point mapped inside it
// (OSM often maps a restaurant, pub or hotel as a node within the outline):
// the building generator gives hotels, pubs, bars, restaurants, cafés and
// historic buildings their own looks (beamngBuildings.js planBuilding).

const LODGING = { hotel: 'hotel', motel: 'motel', guest_house: 'guest', hostel: 'guest', apartment: 'guest' };
const FOOD = { restaurant: 'restaurant', cafe: 'cafe', fast_food: 'fast_food', ice_cream: 'cafe', bar: 'bar', pub: 'pub', biergarten: 'pub', nightclub: 'bar' };
// when a building holds several, the one that shapes its look
const RANK = ['hotel', 'motel', 'pub', 'bar', 'restaurant', 'cafe', 'fast_food', 'guest'];

/** 'hotel' | 'motel' | 'guest' | 'pub' | 'bar' | 'restaurant' | 'cafe' | 'fast_food' | null */
export function buildingUse(tags = {}) {
  const b = String(tags.building || '').toLowerCase();
  if (b === 'hotel') return tags.tourism === 'motel' ? 'motel' : 'hotel';
  if (LODGING[tags.tourism]) return LODGING[tags.tourism];
  if (tags.leisure === 'resort') return 'hotel';
  if (FOOD[tags.amenity]) return FOOD[tags.amenity];
  return null;
}

/** A building kept for its history: historic=*, heritage=*, listed. */
export function isHistoricBuilding(tags = {}) {
  const h = String(tags.historic || '').toLowerCase();
  if (h && !['no', 'memorial', 'monument', 'castle', 'fort', 'ruins', 'archaeological_site', 'wayside_cross', 'wayside_shrine'].includes(h)) return true;
  if (tags.heritage && tags.heritage !== 'no') return true;
  return tags.listed_status === 'Grade I' || tags.listed_status === 'Grade II*' || tags.listed_status === 'Grade II';
}

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Buildings holding a business point (type 'business': a restaurant, bar or
 * hotel node) take its use when they have none of their own: a Map of
 * building feature -> tags to plan it with (the building's own tags, the
 * point's amenity/tourism/cuisine/name added). project(lat, lng) -> [x, y].
 */
export function businessTagsByBuilding(features, project) {
  const points = [];
  for (const f of features || []) {
    if (f?.type !== 'business' || f.geometry?.length !== 1) continue;
    const use = buildingUse(f.tags);
    if (!use) continue;
    const [x, y] = project(f.geometry[0].lat, f.geometry[0].lng);
    points.push({ x, y, tags: f.tags, use });
  }
  const out = new Map();
  if (!points.length) return out;
  const CELL = 64;
  const grid = new Map();
  for (const p of points) {
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  for (const f of features) {
    if (f?.type !== 'building' || !(f.geometry?.length >= 3) || buildingUse(f.tags)) continue;
    const ring = f.geometry.map((q) => project(q.lat, q.lng));
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    let best = null;
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        for (const p of grid.get(`${gx},${gy}`) || []) {
          if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 || !inRing(p.x, p.y, ring)) continue;
          if (!best || RANK.indexOf(p.use) < RANK.indexOf(best.use)) best = p;
        }
      }
    }
    if (!best) continue;
    const add = {};
    for (const k of ['amenity', 'tourism', 'cuisine', 'name', 'stars']) if (best.tags[k] !== undefined && f.tags?.[k] === undefined) add[k] = best.tags[k];
    out.set(f, { ...f.tags, ...add });
  }
  return out;
}
