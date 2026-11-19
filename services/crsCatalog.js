// Projected coordinate systems MapNG knows without fetching a definition, and a best guess at which one an
// upload's coordinates are in when the file does not say (a LAS/LAZ tile with no GeoKeys or WKT: the Lithuanian
// national lidar from LAStools' las2las carries none). Definitions are EPSG's own (as epsg.io serves them); each
// national grid's area of use is EPSG's bounding box, in degrees.
import proj4 from 'proj4';

export const NATIONAL_GRIDS = [
  { epsg: 3346, name: 'LKS-94', def: '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9998 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', area: [53.89, 56.45, 20.86, 26.84] },
  { epsg: 3059, name: 'LKS-92', def: '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=-6000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', area: [55.66, 58.09, 20.86, 28.24] },
  { epsg: 3301, name: 'L-EST97', def: '+proj=lcc +lat_0=57.5175539305556 +lon_0=24 +lat_1=59.3333333333333 +lat_2=58 +x_0=500000 +y_0=6375000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', area: [57.52, 59.75, 21.74, 28.21] },
  { epsg: 2180, name: 'PL-1992', def: '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs', area: [49.0, 55.93, 14.12, 24.15] },
  { epsg: 28992, name: 'RD New', def: null, area: [50.75, 53.7, 3.2, 7.22] },
  { epsg: 27700, name: 'British National Grid', def: null, area: [49.75, 61.01, -9.0, 2.01] },
  { epsg: 2056, name: 'CH1903+ / LV95', def: '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs', area: [45.82, 47.81, 5.96, 10.49] },
  { epsg: 2154, name: 'Lambert-93', def: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', area: [41.15, 51.56, -9.86, 10.38] },
  { epsg: 31370, name: 'Belgian Lambert 72', def: '+proj=lcc +lat_0=90 +lon_0=4.36748666666667 +lat_1=51.1666672333333 +lat_2=49.8333339 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs', area: [49.5, 51.51, 2.5, 6.4] },
  { epsg: 31287, name: 'MGI / Austria Lambert', def: '+proj=lcc +lat_0=47.5 +lon_0=13.3333333333333 +lat_1=49 +lat_2=46 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs', area: [46.4, 49.02, 9.53, 17.17] },
];

/** A national grid's proj4 definition, or null. */
export const nationalGridDef = (epsg) => NATIONAL_GRIDS.find((g) => g.epsg === epsg && g.def)?.def || null;

const UTM_PENALTY_KM = 300;
const UTM_NEAR_KM = 500;
const FAR_VIEW_KM = 800;      // a national fit this near the map's view: ranked by distance; otherwise by how central it lands      // ... and only a zone this near the map's view at all   // a UTM zone fits nearly any easting: a national grid that fits wins unless a zone is this much nearer
const haversineKm = (a, b) => {
  const R = 6371; const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR; const dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Candidate coordinate systems for a box of projected coordinates whose system is unknown, best first:
 * [{ epsg, name, center: {lat, lng}, utm }]. A system is a candidate where the box's centre converts to a place
 * inside its area of use. National grids rank before UTM zones (any easting fits some zone), and among either,
 * the one nearest `near` (the area selected on the map) first; a UTM zone beats a national grid only when it is
 * UTM_PENALTY_KM nearer. `defOf(epsg)` returns a proj4 definition for codes not in this catalogue.
 */
export function guessCoordinateSystems({ minX, maxX, minY, maxY }, { near = null, defOf = () => null, max = 8 } = {}) {
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return [];
  const out = [];
  const tryOne = (epsg, name, def, inArea, utm, area = null) => {
    if (!def) return;
    let ll;
    try { ll = proj4(def, 'EPSG:4326').forward([cx, cy]); } catch { return; }
    const [lng, lat] = ll;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inArea(lat, lng)) return;
    // (how central it lands in the system's area of use, 0 at an edge to 0.5 in the middle)
    const central = area ? Math.min((lat - area[0]) / (area[1] - area[0]), (area[1] - lat) / (area[1] - area[0]), (lng - area[2]) / (area[3] - area[2]), (area[3] - lng) / (area[3] - area[2])) : 0;
    out.push({ epsg, name, center: { lat, lng }, utm, central });
  };
  // (geographic degrees: a box that fits longitude and latitude)
  if (Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90) {
    out.push({ epsg: 4326, name: 'WGS 84 (degrees)', center: { lat: cy, lng: cx }, utm: false });
  }
  for (const g of NATIONAL_GRIDS) {
    const [s, n, w, e] = g.area;
    tryOne(g.epsg, g.name, g.def || defOf(g.epsg), (lat, lng) => lat >= s && lat <= n && lng >= w && lng <= e, false, g.area);
  }
  // UTM zones (WGS 84; ETRS89 and NAD83 zones are the same to within a metre or so): easting 100-900 km
  if (cx > 100000 && cx < 900000) {
    for (let z = 1; z <= 60; z++) {
      const w = -180 + 6 * (z - 1) - 3; const e = w + 12;
      if (cy > 0 && cy < 9400000) tryOne(32600 + z, `UTM ${z}N`, `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`, (lat, lng) => lat >= 0 && lat <= 84 && lng >= w && lng <= e, true);
      if (cy > 1000000 && cy < 10000000) tryOne(32700 + z, `UTM ${z}S`, `+proj=utm +zone=${z} +south +datum=WGS84 +units=m +no_defs`, (lat, lng) => lat >= -80 && lat <= 0 && lng >= w && lng <= e, true);
    }
  }
  // (a national grid that fits is strong evidence, a UTM zone that fits is not: any easting fits some zone. The
  // nationals go first unless a zone lies near the map's view and UTM_PENALTY_KM nearer than every national;
  // among either kind, the nearest to the view first)
  const hasNear = near && Number.isFinite(near.lat) && Number.isFinite(near.lng);
  const dist = (c) => (hasNear ? haversineKm(c.center, near) : 0);
  // (with the view far from every national fit (the map left elsewhere), the one that lands most centrally in its
  // area first: the Lithuanian tile's numbers land mid-Lithuania in LKS-94 and at the edge of France in Lambert-93)
  const nationals = out.filter((c) => !c.utm);
  const viewNear = hasNear && nationals.some((c) => dist(c) < FAR_VIEW_KM);
  nationals.sort((a, b) => (viewNear ? dist(a) - dist(b) : b.central - a.central));
  const utms = out.filter((c) => c.utm).sort((a, b) => dist(a) - dist(b));
  const nearestNational = nationals.length ? dist(nationals[0]) : Infinity;
  const utmFirst = utms.length && (!nationals.length || (hasNear && dist(utms[0]) < UTM_NEAR_KM && dist(utms[0]) + UTM_PENALTY_KM < nearestNational));
  if (utmFirst) return [...utms.slice(0, 1), ...nationals, ...utms.slice(1)].slice(0, max);
  // (a national grid first: the zones on offer after it are the ones round where it puts the file, not round the
  // map's view: a Lithuanian tile with the map left at Flagstaff offered UTM 12N, 11N, 13N)
  if (nationals.length) {
    const at = nationals[0].center;
    utms.sort((a, b) => haversineKm(a.center, at) - haversineKm(b.center, at));
  }
  return [...nationals, ...utms].slice(0, max);
}
