// Tiles in step 1 for the app: the store's layout (in tiles) at the current tile size, its grid (services/tileLayout.js)
// and the actions. resolution: the tile's side in pixels (a ref or getter); mpp: metres per pixel (a ref or getter).
import { computed, unref } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { layoutGrid, nextTileSpot, placeTile, MAX_TILES } from '../services/tileLayout.js';

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
  /** No more than MAX_TILES: a share code and a saved level carry that many (more were cut off there, silently). */
  const full = computed(() => store.tiles.length >= MAX_TILES);
  function addTile() {
    if (full.value) return;
    store.setTiles([...store.tiles, ...toTiles([nextTileSpot(tilesPx.value, R.value)])]);
  }
  /**
   * Together or free. Turned on, every tile is put on the grid (its nearest free spot, in order), so tiles placed
   * freely, off the grid and over each other, do not stay that way under a setting that says they are together.
   */
  function setTogether(on) {
    store.setTilesTogether(!!on);
    if (!on || store.tiles.length < 2) return;
    const placed = [{ dx: 0, dy: 0 }];
    for (let i = 1; i < tilesPx.value.length; i++) {
      const list = [...placed, tilesPx.value[i]];
      placed.push(placeTile(list, i, tilesPx.value[i], R.value, { together: true, snap: false }));
    }
    store.setTiles(toTiles(placed));
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
  return { R, tilesPx, tileOffsetsM, multi, grid, full, addTile, removeTile, clearTiles, moveTile, setTogether };
}
