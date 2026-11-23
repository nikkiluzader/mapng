// Road mode for the app (refs/output/road-mode-plan.md): pick a road on the map, follow it, set the stretch's ends and
// the width either side; the corridor's grid for Generate (services/roadCorridor.js). mpp: metres per pixel (a ref or
// getter).
import { computed, ref, unref } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { fetchRoadFeatures } from '../services/osm.js';
import { heavyJobRunning } from '../services/heavyJob.js';
import { metresPerDegree } from '../services/mapFrame.js';
import { boxAround, PICK_RADIUS_M, PICK_CLASSES, drivableRoads, nearestRoad, followRoad, cumulative, stretchBetween, distanceAlong, distanceToLine, routeAlongRoads, metresBetween, ROUTE_MAX_M } from '../services/roadPick.js';
import { WEB_MAX_SIDE } from '../services/tileLayout.js';
import { corridorGrid } from '../services/roadCorridor.js';

const val = (v) => (typeof v === 'function' ? v() : unref(v));
const MIN_STRETCH_M = 20;          // the two handles are never closer than this along the road
const DEFAULT_STRETCH_M = 1000;   // the stretch at first: this far either way from the click, within the road
// (the roads read in this session, for picking; not saved, and started again past KNOWN_MAX so a long session's
// clicks do not pile up every road it has seen)
const known = ref([]);
const KNOWN_MAX = 40000;
const readBoxes = [];   // the boxes read this session (their roads are in `known`)
const busy = ref(false);
const error = ref('');
// The corridor's grid, worked out once for the road as it is: the panel, the Generate summary and the map each ask
// for it, and the width slider moves it on every step. Kept for the last (road, ends, width, resolution) asked.
let gridMemo = null;
const gridFor = (road, halfWidthM, m) => {
  if (gridMemo && gridMemo.road === road && gridMemo.startM === road.startM && gridMemo.endM === road.endM && gridMemo.half === halfWidthM && gridMemo.m === m) return gridMemo;
  const stretch = stretchBetween(road.pts, road.startM, road.endM);
  const g = stretch.length >= 2 ? corridorGrid(stretch, halfWidthM, m) : null;
  gridMemo = { road, startM: road.startM, endM: road.endM, half: halfWidthM, m, stretch, g };
  return gridMemo;
};

export function useRoadMode(mpp) {
  const store = useMainStore();
  const M = computed(() => (Number(val(mpp)) > 0 ? Number(val(mpp)) : 1));
  const total = computed(() => (store.road ? cumulative(store.road.pts).at(-1) : 0));
  /** The chosen stretch of the road (between the handles). */
  const stretch = computed(() => (store.road ? gridFor(store.road, store.roadHalfWidthM, M.value).stretch : null));
  const stretchM = computed(() => (store.road ? Math.abs(store.road.endM - store.road.startM) : 0));
  /** The corridor as Generate's grid: { center, width, height, runs, areaPx, squareSide, webOk }. */
  const grid = computed(() => {
    const g = store.road ? gridFor(store.road, store.roadHalfWidthM, M.value).g : null;
    if (!g) return null;
    let side = 1; while (side < Math.max(g.width, g.height)) side *= 2;
    // (past one grid's square the level is built in chunks, refs/output/chunked-pipeline-plan.md; the website's cap
    // is the corridor's own area; the desktop app has none, only a warning past it)
    return { ...g, squareSide: side, chunked: side > WEB_MAX_SIDE, webOk: g.areaPx <= WEB_MAX_SIDE * WEB_MAX_SIDE };
  });
  // (a way read in an earlier, smaller box comes back cut at that box's edge: the longer copy of each way is kept, or
  // the road broke where the first box ended and no route crossed it)
  const merge = (roads) => {
    const byId = new Map(known.value.map((r) => [r.id, r]));
    for (const r of roads) { const old = byId.get(r.id); if (!old || cumulative(r.pts).at(-1) > cumulative(old.pts).at(-1) + 0.5) byId.set(r.id, r); }
    known.value = [...byId.values()];
  };
  // (the roads alone: not Generate's whole read of the area, with its buildings and land use and, on the public
  // servers, a full query per click)
  // An area already read is not read again: a box inside one read earlier is answered from the roads kept (every
  // way that touches the earlier box is whole in it, so everything inside the smaller box is there). Dropping a
  // handle a second time in the same neighbourhood then costs no read at all.
  const inside = (a, b) => a.north <= b.north && a.south >= b.south && a.east <= b.east && a.west >= b.west;
  const touches = (r, box) => { for (const q of r.pts) if (q.lat <= box.north && q.lat >= box.south && q.lng <= box.east && q.lng >= box.west) return true; return false; };
  async function read(box) {
    const t0 = performance.now();
    if (readBoxes.some((b) => inside(box, b))) {
      const roads = known.value.filter((r) => touches(r, box));
      console.log(`[Road mode] roads here already read: ${roads.length} road(s) from this session's ${known.value.length}, no new read (${Math.round(performance.now() - t0)} ms).`);
      return { box, roads };
    }
    const features = await fetchRoadFeatures(box, { classes: PICK_CLASSES });
    const roads = drivableRoads(features);
    if (known.value.length + roads.length > KNOWN_MAX) { known.value = []; readBoxes.length = 0; }
    merge(roads); readBoxes.push(box); if (readBoxes.length > 40) readBoxes.shift();
    console.log(`[Road mode] read the roads of ${(metresBetween({ lat: box.north, lng: box.west }, { lat: box.north, lng: box.east }) / 1000).toFixed(1)} x ${(metresBetween({ lat: box.north, lng: box.west }, { lat: box.south, lng: box.west }) / 1000).toFixed(1)} km: ${roads.length} road(s) in ${Math.round(performance.now() - t0)} ms.`);
    return { box, roads };
  }
  // (no picking while a Generate or an export runs: the map on its way is of the road as it was)
  const blocked = () => busy.value || heavyJobRunning.value;
  /** Pick the road nearest p ({ lat, lng }) and follow it. */
  async function pickAt(p) {
    if (blocked()) return;
    busy.value = true; error.value = '';
    try {
      const { box } = await read(boxAround(p, PICK_RADIUS_M));
      const start = nearestRoad(known.value, p);
      if (!start) { error.value = 'none'; return; }
      const f = followRoad(known.value, start);
      const along = distanceAlong(f.pts, p); const len = cumulative(f.pts).at(-1);
      store.setRoad({
        pts: f.pts, ids: f.ids, highway: f.highway, names: f.names, refs: f.refs,
        startM: Math.max(0, along - DEFAULT_STRETCH_M), endM: Math.min(len, along + DEFAULT_STRETCH_M),
      });
    } catch (e) {
      console.warn('[Road mode] the roads could not be read:', e?.message || e);
      error.value = 'read';
    } finally { busy.value = false; }
  }
  /**
   * A handle dropped at p. On or near the line (`nearM`: what "on the line" is at the map's zoom, never under
   * SLIDE_M): its end slides to the nearest point of the line, forwards or backwards, so a stretch that went the wrong
   * way is pulled back by dragging its handle back along it. Farther off: the drop is reached along the road network
   * from where the handle WAS (services/roadPick.js routeAlongRoads: keeping to the picked road); what lay beyond
   * the handle is dropped, the stretch grows along the route and the handle lands there. OSM splits roads into many
   * ways, so this, not following by name, is how a stretch is made longer.
   * (Until 2026-11-23 the route started at the far end of the whole followed road, not at the handle: a drop beside
   * the handle came back as a line out to the road's end and back again, and could not be undone by dragging back.)
   */
  const SLIDE_M = 40;
  const ROUTE_PAD_M = 700;
  async function setHandle(which, p, nearM = SLIDE_M) {
    const r = store.road; if (!r || heavyJobRunning.value) return;
    if (distanceToLine(r.pts, p) <= Math.max(SLIDE_M, Number(nearM) || 0)) {
      // (the nearest point of the line on the handle's own side of the other handle, so the two never swap)
      const along = distanceAlong(r.pts, p);
      const next = which === 'start' ? Math.min(along, r.endM - MIN_STRETCH_M) : Math.max(along, r.startM + MIN_STRETCH_M);
      error.value = '';
      store.setRoad({ ...r, [which === 'start' ? 'startM' : 'endM']: Math.max(0, Math.min(cumulative(r.pts).at(-1), next)) });
      return;
    }
    // the line up to the handle: the part beyond it goes
    const len = cumulative(r.pts).at(-1);
    const kept = which === 'end' ? stretchBetween(r.pts, 0, r.endM) : stretchBetween(r.pts, r.startM, len);
    const from = which === 'end' ? kept[kept.length - 1] : kept[0];
    if (metresBetween(from, p) > ROUTE_MAX_M) { error.value = 'tooFar'; return; }
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
      // the roads between the handle and the drop, with room round them
      // (the room in metres, the same on the ground at any latitude: 0.006 degrees of longitude is 230 m at 70 north)
      const k = metresPerDegree((from.lat + p.lat) / 2); const padLat = ROUTE_PAD_M / k.lat; const padLng = ROUTE_PAD_M / k.lng;
      const { roads } = await read({ north: Math.max(from.lat, p.lat) + padLat, south: Math.min(from.lat, p.lat) - padLat, east: Math.max(from.lng, p.lng) + padLng, west: Math.min(from.lng, p.lng) - padLng });
      // (the road was cleared, replaced or its other end moved while the roads were read: this answer is for a road
      // that is no longer the one on the map)
      if (store.road !== r) return;
      const t0 = performance.now();
      const path = routeAlongRoads(roads, from, p, { name: r.names?.[0] || '', ref: r.refs?.[0] || '', highway: r.highway || 'road' });
      console.log(`[Road mode] route from the ${which} handle to the drop (${(metresBetween(from, p) / 1000).toFixed(2)} km away) over ${roads.length} road(s): ${path ? `${path.length} points` : 'none'} in ${Math.round(performance.now() - t0)} ms.`);
      if (!path || path.length < 2) { error.value = 'noRoute'; return; }
      if (which === 'end') {
        const pts = kept.concat(path.slice(1));
        store.setRoad({ ...r, pts, endM: cumulative(pts).at(-1) });
      } else {
        const pts = path.slice().reverse().concat(kept.slice(1));
        const added = cumulative(pts).at(-1) - cumulative(kept).at(-1);
        store.setRoad({ ...r, pts, startM: 0, endM: (r.endM - r.startM) + added });
      }
    } catch (e) {
      console.warn('[Road mode] the roads could not be read:', e?.message || e);
      error.value = 'read';
    } finally { busy.value = false; }
  }
  function clearRoad() { if (busy.value) return; store.setRoad(null); error.value = ''; }
  return { total, stretch, stretchM, grid, busy, error, pickAt, setHandle, clearRoad };
}
