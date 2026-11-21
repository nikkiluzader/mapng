// Tiles in step 1 for the app: the store's layout (in tiles) at the current tile size, its grid (services/tileLayout.js)
// and the actions. resolution: the tile's side in pixels (a ref or getter); mpp: metres per pixel (a ref or getter).
import { computed, unref } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { layoutGrid, nextTileSpot, placeTile } from '../services/tileLayout.js';

const val = (v) => (typeof v === 'function' ? v() : unref(v));

export function useTiles(resolution, mpp) {
  const store = useMainStore();
  const R = computed(() => Math.max(1, Math.round(Number(val(resolution)) || 1024)));
  const M = computed(() => Number(val(mpp)) > 0 ? Number(val(mpp)) : 1);
  /** The tiles in pixels (whole pixels), tile 0 at the centre. */
  const tilesPx = computed(() => store.tiles.map((t) => ({ dx: Math.round(t.dx * R.value), dy: Math.round(t.dy * R.value) })));
  const multi = computed(() => store.tiles.length > 1);
  const grid = computed(() => layoutGrid(tilesPx.value, R.value));
  const toTiles = (list) => list.map((t) => ({ dx: t.dx / R.value, dy: t.dy / R.value }));
  function addTile() {
    store.setTiles([...store.tiles, ...toTiles([nextTileSpot(tilesPx.value, R.value)])]);
  }
  function removeTile(i) {
    if (i <= 0) return;
    store.setTiles(store.tiles.filter((_, k) => k !== i));
  }
  function clearTiles() { store.setTiles([{ dx: 0, dy: 0 }]); }
  /** A tile dragged to an offset in metres from the centre (x east, y north): placed by the mode's rule. */
  function moveTile(i, metres) {
    if (i <= 0) return;
    const want = { dx: metres.x / M.value, dy: metres.y / M.value };
    const at = placeTile(tilesPx.value, i, want, R.value, { together: store.tilesTogether, snap: store.tilesSnap });
    const next = store.tiles.slice(); next[i] = { dx: at.dx / R.value, dy: at.dy / R.value };
    store.setTiles(next);
  }
  /** Each tile's centre offset in metres from the map's centre (x east, y north), for drawing. */
  const tileOffsetsM = computed(() => tilesPx.value.map((t) => ({ x: t.dx * M.value, y: t.dy * M.value })));
  return { R, tilesPx, tileOffsetsM, multi, grid, addTile, removeTile, clearTiles, moveTile };
}
