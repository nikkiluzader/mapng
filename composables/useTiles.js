// Tiles in step 1 for the app: the store's layout (in tiles) at the current tile size, its grid (services/tileLayout.js)
// and the actions. resolution: the tile's side in pixels (a ref or getter); mpp: metres per pixel (a ref or getter).
import { computed, unref } from 'vue';
import { useMainStore } from '../stores/mainStore';
import { layoutGrid, nextTileSpot, placeTile, tilesFrame, anchorOffsetPx, cleanTileAnchor, MAX_TILES } from '../services/tileLayout.js';

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
  const toPx = (list) => list.map((t) => ({ dx: Math.round(t.dx * R.value), dy: Math.round(t.dy * R.value) }));
  /**
   * A new layout and / or anchor, with the tiles left where they are on the map: the location (the store's centre)
   * moves to where the anchor now is. (With the anchor on tile 1, as it always was, nothing moves: tile 1 is the
   * location.) Tiles never jump when one is added, moved or removed, or when another anchor is picked.
   */
  function commit(nextTiles, nextAnchor = store.tileAnchor) {
    const anchor = cleanTileAnchor(nextAnchor, nextTiles.length);
    const from = anchorOffsetPx(tilesPx.value, R.value, store.tileAnchor);
    const to = anchorOffsetPx(toPx(nextTiles), R.value, anchor);
    const moved = Math.abs(to.x - from.x) > 1e-6 || Math.abs(to.y - from.y) > 1e-6;
    // (where the new anchor is today, read in the frame the tiles are drawn in now)
    const here = moved && store.center && !store.boxLocked ? tilesFrame(store.center, tilesPx.value, R.value, M.value, store.tileAnchor).pointAt({ x: to.x * M.value, y: to.y * M.value }) : null;
    store.setTiles(nextTiles);
    store.setTileAnchor(anchor);
    if (here) store.setCenter(here);
  }
  /** Another anchor, one click: a tile's index or 'center'. */
  function setAnchor(a) { if (!store.boxLocked) commit(store.tiles.slice(), a); }
  /** No more than MAX_TILES: a share code and a saved level carry that many (more were cut off there, silently). */
  const full = computed(() => store.tiles.length >= MAX_TILES);
  function addTile() {
    if (full.value) return;
    commit([...store.tiles, ...toTiles([nextTileSpot(tilesPx.value, R.value)])]);
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
    commit(toTiles(placed));
  }
  function removeTile(i) {
    if (i <= 0) return;
    // (the anchor keeps to its tile: the tiles after the removed one move up a place; the removed tile's goes to tile 1)
    const a = store.tileAnchor;
    commit(store.tiles.filter((_, k) => k !== i), Number.isInteger(a) ? (a === i ? 0 : a > i ? a - 1 : a) : a);
  }
  function clearTiles() { commit([{ dx: 0, dy: 0 }], 0); }
  /** A tile dragged to an offset in metres from the centre (x east, y north): placed by the mode's rule. */
  function moveTile(i, metres) {
    if (i <= 0) return;
    const want = { dx: metres.x / M.value, dy: metres.y / M.value };
    const at = placeTile(tilesPx.value, i, want, R.value, { together: store.tilesTogether, snap: store.tilesSnap });
    const next = store.tiles.slice(); next[i] = { dx: at.dx / R.value, dy: at.dy / R.value };
    commit(next);
  }
  /** Each tile's centre offset in metres from the map's centre (x east, y north), for drawing. */
  const tileOffsetsM = computed(() => tilesPx.value.map((t) => ({ x: t.dx * M.value, y: t.dy * M.value })));
  return { R, tilesPx, tileOffsetsM, multi, grid, full, addTile, removeTile, clearTiles, moveTile, setTogether, setAnchor };
}
