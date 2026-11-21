// Road mode for the app (refs/output/road-mode-plan.md): pick a road on the map, follow it, set the stretch's ends and
// the width either side; the corridor's grid for Generate (services/roadCorridor.js). mpp: metres per pixel (a ref or
// getter).
import { computed, ref, unref } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { fetchOSMData } from '../services/osm.js';
import { boxAround, PICK_RADIUS_M, drivableRoads, nearestRoad, followRoad, cumulative, stretchBetween, distanceAlong, distanceToLine, routeAlongRoads, metresBetween, ROUTE_MAX_M } from '../services/roadPick.js';
import { corridorGrid } from '../services/roadCorridor.js';

const val = (v) => (typeof v === 'function' ? v() : unref(v));
const DEFAULT_STRETCH_M = 1000;   // the stretch at first: this far either way from the click, within the road
// (the roads read in this session, for Extend; not saved)
const known = ref([]);
const busy = ref(false);
const error = ref('');

export function useRoadMode(mpp) {
  const store = useMainStore();
  const M = computed(() => (Number(val(mpp)) > 0 ? Number(val(mpp)) : 1));
  const total = computed(() => (store.road ? cumulative(store.road.pts).at(-1) : 0));
  /** The chosen stretch of the road (between the handles). */
  const stretch = computed(() => (store.road ? stretchBetween(store.road.pts, store.road.startM, store.road.endM) : null));
  const stretchM = computed(() => (store.road ? Math.abs(store.road.endM - store.road.startM) : 0));
  /** The corridor as Generate's grid: { center, width, height, runs, areaPx, squareSide, webOk }. */
  const grid = computed(() => {
    if (!stretch.value || stretch.value.length < 2) return null;
    const g = corridorGrid(stretch.value, store.roadHalfWidthM, M.value);
    let side = 1; while (side < Math.max(g.width, g.height)) side *= 2;
    return { ...g, squareSide: side, webOk: side <= 16384 };
  });
  // (a way read in an earlier, smaller box comes back cut at that box's edge: the longer copy of each way is kept, or
  // the road broke where the first box ended and no route crossed it)
  const merge = (roads) => {
    const byId = new Map(known.value.map((r) => [r.id, r]));
    for (const r of roads) { const old = byId.get(r.id); if (!old || cumulative(r.pts).at(-1) > cumulative(old.pts).at(-1) + 0.5) byId.set(r.id, r); }
    known.value = [...byId.values()];
  };
  async function read(box) {
    const features = await fetchOSMData(box, {});
    const roads = drivableRoads(features);
    merge(roads);
    return { box, roads };
  }
  /** Pick the road nearest p ({ lat, lng }) and follow it. */
  async function pickAt(p) {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
      const { box } = await read(boxAround(p, PICK_RADIUS_M));
      const start = nearestRoad(known.value, p);
      if (!start) { error.value = 'none'; return; }
      const f = followRoad(known.value, start, box);
      const along = distanceAlong(f.pts, p); const len = cumulative(f.pts).at(-1);
      store.setRoad({
        pts: f.pts, ids: f.ids, highway: f.highway, names: f.names, refs: f.refs, moreAtStart: f.moreAtStart, moreAtEnd: f.moreAtEnd,
        startM: Math.max(0, along - DEFAULT_STRETCH_M), endM: Math.min(len, along + DEFAULT_STRETCH_M),
      });
    } catch (e) {
      console.warn('[Road mode] the roads could not be read:', e?.message || e);
      error.value = 'read';
    } finally { busy.value = false; }
  }
  /** Read more road round one end ('start' or 'end') and follow on. */
  async function extend(which) {
    const r = store.road; if (!r || busy.value) return;
    busy.value = true; error.value = '';
    try {
      const endPt = which === 'start' ? r.pts[0] : r.pts[r.pts.length - 1];
      const { box } = await read(boxAround(endPt, PICK_RADIUS_M));
      const cur = { id: '__picked', name: r.names?.[0] || '', ref: r.refs?.[0] || '', highway: r.highway || 'road', pts: r.pts };
      const f = followRoad(known.value.filter((k) => !(r.ids || []).includes(k.id)), cur, box);
      // (the old start moves by what was added in front of it)
      const added = cumulative(f.pts).at(-1) - cumulative(r.pts).at(-1);
      const shift = which === 'start' ? Math.max(0, distanceAlong(f.pts, r.pts[0])) : 0;
      const len = cumulative(f.pts).at(-1);
      store.setRoad({
        ...r, pts: f.pts, ids: [...new Set([...(r.ids || []), ...f.ids.filter((i) => i !== '__picked')])], names: [...new Set([...(r.names || []), ...f.names])], refs: [...new Set([...(r.refs || []), ...f.refs])],
        moreAtStart: f.moreAtStart, moreAtEnd: f.moreAtEnd,
        startM: which === 'start' && r.startM < 1 ? 0 : r.startM + shift,
        endM: which === 'end' && Math.abs(r.endM - cumulative(r.pts).at(-1)) < 1 ? len : r.endM + shift,
      });
      if (added < 1) error.value = 'noMore';
    } catch (e) {
      console.warn('[Road mode] the roads could not be read:', e?.message || e);
      error.value = 'read';
    } finally { busy.value = false; }
  }
  /**
   * A handle dropped at p. Near the road (SLIDE_M): its end slides to the nearest point on it. Farther: the road is
   * reached along the road network from that end (services/roadPick.js routeAlongRoads: keeping to the picked road),
   * the stretch grows to it and the handle lands there. OSM splits roads into many ways, so this, not following by name,
   * is how a stretch is made longer.
   */
  const SLIDE_M = 40;
  async function setHandle(which, p) {
    const r = store.road; if (!r) return;
    if (distanceToLine(r.pts, p) <= SLIDE_M) {
      store.setRoad({ ...r, [which === 'start' ? 'startM' : 'endM']: distanceAlong(r.pts, p) });
      return;
    }
    const endPt = which === 'start' ? r.pts[0] : r.pts[r.pts.length - 1];
    if (metresBetween(endPt, p) > ROUTE_MAX_M) { error.value = 'tooFar'; return; }
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
      // the roads between the road's end and the drop, with room round them
      // (routed on this read alone: the map data comes clipped to the box asked for, so the road's end from an earlier,
      // smaller read is a cut point on that box's edge, joined to nothing; this read covers both ends whole)
      const PAD = 0.006;
      const { roads } = await read({ north: Math.max(endPt.lat, p.lat) + PAD, south: Math.min(endPt.lat, p.lat) - PAD, east: Math.max(endPt.lng, p.lng) + PAD, west: Math.min(endPt.lng, p.lng) - PAD });
      const path = routeAlongRoads(roads, endPt, p, { name: r.names?.[0] || '', ref: r.refs?.[0] || '', highway: r.highway || 'road' });
      if (!path || path.length < 2) { error.value = 'noRoute'; return; }
      const before = cumulative(r.pts).at(-1);
      const pts = which === 'end' ? r.pts.concat(path.slice(1)) : path.slice().reverse().concat(r.pts.slice(1));
      const added = cumulative(pts).at(-1) - before;
      store.setRoad({
        ...r, pts,
        startM: which === 'start' ? 0 : r.startM,
        endM: which === 'end' ? cumulative(pts).at(-1) : r.endM + added,
      });
    } catch (e) {
      console.warn('[Road mode] the roads could not be read:', e?.message || e);
      error.value = 'read';
    } finally { busy.value = false; }
  }
  function clearRoad() { store.setRoad(null); error.value = ''; }
  return { total, stretch, stretchM, grid, busy, error, pickAt, extend, setHandle, clearRoad };
}
