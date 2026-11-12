import { ref, watch } from 'vue';
import { OSM_TILES_FIRST_STORAGE_KEY } from '../services/osm.js';

// Which comes first for map data, shared by the setting (Map data) and the note in the view bar:
// MapNG's own copy of OpenStreetMap (true, the default) or the live OpenStreetMap servers.
const read = () => { try { return localStorage.getItem(OSM_TILES_FIRST_STORAGE_KEY) !== 'false'; } catch { return true; } };
const tilesFirst = ref(read());
watch(tilesFirst, (on) => {
  try { if (on) localStorage.removeItem(OSM_TILES_FIRST_STORAGE_KEY); else localStorage.setItem(OSM_TILES_FIRST_STORAGE_KEY, 'false'); } catch { /* not kept */ }
});

export const useOsmSource = () => ({ tilesFirst });
