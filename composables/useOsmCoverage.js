import { ref, watch } from 'vue';
import { getOsmTileManifest } from '../services/osmTiles.js';

// "Show MapNG OSM coverage": the outlines of the OSM archives MapNG hosts
// (R2, scripts/publish-osm-tiles.py). Shared by the control panel toggle and
// the 2D map; the choice is remembered.
const STORAGE_KEY = 'mapng_show_osm_coverage';
const readStored = () => { try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; } };

const show = ref(readStored());
const areas = ref([]);          // [{ region, builtAt, rings: [[[lat, lng], ...]] }]
const status = ref('idle');     // idle | loading | ready | unavailable
let started = false;

const load = async () => {
  if (status.value === 'loading' || status.value === 'ready') return;
  status.value = 'loading';
  const manifest = await getOsmTileManifest();
  if (!manifest) { status.value = 'unavailable'; return; }
  areas.value = manifest.archives.map((archive) => {
    const [w, s, e, n] = Array.isArray(archive.bounds) ? archive.bounds : [];
    const rings = Array.isArray(archive.coverage) && archive.coverage.length
      ? archive.coverage.map((ring) => ring.map(([lon, lat]) => [lat, lon]))
      : (Number.isFinite(w) ? [[[s, w], [s, e], [n, e], [n, w]]] : []);
    return { region: String(archive.region || archive.key || ''), builtAt: String(archive.built_at || ''), rings };
  }).filter((area) => area.rings.length);
  status.value = 'ready';
};

export const useOsmCoverage = () => {
  if (!started) {
    started = true;
    watch(show, (on) => {
      try { localStorage.setItem(STORAGE_KEY, String(on)); } catch { /* private mode */ }
      if (on) load();
    }, { immediate: true });
  }
  return { show, areas, status };
};
