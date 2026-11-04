import { ref } from 'vue';

// The ground texture choice, shared by the 3D preview's texture buttons and
// the export panel's Base Texture: what you look at in the preview is what
// the level gets. (They were two separate choices: a user viewed Game
// Texture in the preview and exported with the export panel's OSM.)
// 'satellite' | 'osm' | 'hybrid' | 'game' | 'none' | 'painted' (the export's
// touched-up texture; the preview shows hybrid for it).
const STORAGE_KEY = 'mapng_beamNGBaseTexture';
const read = () => { try { return localStorage.getItem(STORAGE_KEY) || 'osm'; } catch { return 'osm'; } };

const baseTexture = ref(read());

export function setBaseTexture(value) {
  if (!value || value === baseTexture.value) return;
  baseTexture.value = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ }
}

export const useBaseTexture = () => ({ baseTexture, setBaseTexture });
