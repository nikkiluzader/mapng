// Google Street View for the in-game tools (streetCompare.mjs, driveTest.mjs):
// signed requests, the newest Google-car panorama near a spot, an image at a
// heading, and the level's world <-> lat/lng mapping (mapng_probes.json geo).
//
// Google's terms: images are fetched to look at only. They stay in the
// tools' output folders (the system temp dir by default), are never
// committed and are never used to derive map data.
import crypto from 'node:crypto';

export const H_FOV = 90;          // Google's horizontal field of view (BeamNG's setFOV is VERTICAL)
export const EYE_GOOGLE_M = 2.5;  // Google's camera over the road
export const PITCH = -3;

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
// vertical field of view for a horizontal one at an aspect (width / height)
export const vFovFor = (hFov, aspect) => deg(2 * Math.atan(Math.tan(rad(hFov) / 2) / aspect));
// compass bearing (degrees clockwise from north) of a world direction
export const bearing = (dx, dy) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

/** world (x, y) <-> lat/lng for a level's probes geo { bounds, worldSize }. */
export function levelGeo(geo) {
  const { bounds: b, worldSize: W } = geo;
  return {
    toLatLng: (x, y) => [b.north - (0.5 - y / W) * (b.north - b.south), b.west + (x / W + 0.5) * (b.east - b.west)],
    toWorld: (lat, lng) => [((lng - b.west) / (b.east - b.west) - 0.5) * W, (0.5 - (b.north - lat) / (b.north - b.south)) * W],
  };
}

// Google's metadata (free) returns the default panorama nearest a point,
// not always the newest; positions a little along and across the road often
// find newer drives. The newest street-level panorama among them wins.
const SAMPLES = [[0, 0], [10, 0], [-10, 0], [20, 0], [-20, 0], [0, 6], [0, -6], [10, 6], [-10, -6]];

/** Street View with a key (and its URL signing secret); null without a key. */
export function streetView({ key, secret }) {
  if (!key) return null;
  const sign = (pathQuery) => {
    if (!secret) return pathQuery;
    const k = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const sig = crypto.createHmac('sha1', k).update(pathQuery).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return `${pathQuery}&signature=${sig}`;
  };
  // Google's car panoramas only: Google's copyright (user panoramas are
  // indoor rooms, boats, drones)
  const meta = async (lat, lng, radius) => {
    const m = await (await fetch(`https://maps.googleapis.com${sign(`/maps/api/streetview/metadata?location=${lat.toFixed(7)},${lng.toFixed(7)}&radius=${radius}&source=outdoor&key=${key}`)}`)).json();
    return m.status === 'OK' && /google/i.test(m.copyright || '') ? m : null;
  };
  /**
   * The newest Google-car panorama within searchM of world (x, y), sampled
   * along roadHeading and across it. onRoad(x, y): standing on a drivable
   * carriageway (not the pedestrian Trekker's sidewalks). Returns
   * { d, x, y, h (facing the spot, or along the road on it), pano, date,
   * lat, lng, candidates, oldest } or null.
   */
  const newestNear = async (x, y, roadHeading, { geo, onRoad = null, searchM = 45, minYear = 0 }) => {
    const a = rad(Number.isFinite(roadHeading) ? roadHeading : 0);
    const ux = Math.sin(a); const uy = Math.cos(a);
    const seen = new Map();
    for (const [along, across] of SAMPLES) {
      const sx = x + ux * along + uy * across; const sy = y + uy * along - ux * across;
      const [lat, lng] = geo.toLatLng(sx, sy);
      const m = await meta(lat, lng, along || across ? 12 : searchM);
      if (!m || seen.has(m.pano_id)) continue;
      const [px, py] = geo.toWorld(m.location.lat, m.location.lng);
      if (onRoad && !onRoad(px, py)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d > searchM) continue;
      seen.set(m.pano_id, { m, px, py, d });
    }
    const list = [...seen.values()].filter((c) => !minYear || Number(String(c.m.date || '0').slice(0, 4)) >= minYear);
    if (!list.length) return null;
    // newest first (dates are YYYY-MM), then nearest
    list.sort((p, q) => String(q.m.date || '').localeCompare(String(p.m.date || '')) || p.d - q.d);
    const { m, px, py, d } = list[0];
    const h = d > 6 ? bearing(x - px, y - py) : (roadHeading ?? 0);
    return { d, x: px, y: py, h, pano: m.pano_id, date: m.date || '', lat: m.location.lat, lng: m.location.lng, candidates: seen.size, oldest: list[list.length - 1].m.date || '' };
  };
  /** The panorama's view at compass heading h, framed like the game screen (aspect w / h). */
  const image = async (pano, h, aspect, pitch = PITCH) => {
    const w = 640; const hgt = Math.min(640, Math.round(w / aspect));
    const q = `/maps/api/streetview?size=${w}x${hgt}&pano=${pano}&heading=${h.toFixed(1)}&pitch=${pitch}&fov=${H_FOV}&source=outdoor&key=${key}`;
    const res = await fetch(`https://maps.googleapis.com${sign(q)}`);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  };
  return { sign, meta, newestNear, image };
}
