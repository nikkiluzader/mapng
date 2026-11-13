// USGS 1 m without whole tiles (services/usgsWindow.js): the pieces a map is asked for in, the catalogue's
// tiles over a box, the window of a tile under a box, and older surveys only filling what the newest left empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { imagePieces, usgsItemsOver, usgsUtmDef, windowUnder, readUsgsWindows, IMAGE_PIECES_MAX } from '../services/usgsWindow.js';

const box = (lat, lng, sideM) => { const dLat = sideM / 2 / 111320; const dLng = dLat / Math.cos((lat * Math.PI) / 180); return { north: lat + dLat, south: lat - dLat, west: lng - dLng, east: lng + dLng }; };

test('a map is asked for in pieces of at most 2000 pixels that overlap and cover it', () => {
  const b = box(40.6, -111.7, 8192); const step = 1 / 111320;
  const pieces = imagePieces(b, step);
  assert.ok(pieces.length > 1 && pieces.length <= IMAGE_PIECES_MAX, `${pieces.length} pieces`);
  for (const p of pieces) assert.ok(p.w <= 2000 && p.h <= 2000 && p.w > 0 && p.h > 0, `${p.w}x${p.h}`);
  assert.ok(Math.min(...pieces.map((p) => p.west)) <= b.west && Math.max(...pieces.map((p) => p.east)) >= b.east);
  assert.ok(Math.max(...pieces.map((p) => p.north)) >= b.north && Math.min(...pieces.map((p) => p.south)) <= b.south);
  // neighbours overlap
  const row = pieces.filter((p) => p.north === pieces[0].north).sort((p, q) => p.west - q.west);
  for (let i = 1; i < row.length; i++) assert.ok(row[i].west < row[i - 1].east, 'pieces overlap');
  // a small square is one piece; a 2 m map asks for a quarter of the pixels
  assert.equal(imagePieces(box(29.9, -81.3, 512), step).length, 1);
  const px = (list) => list.reduce((a, p) => a + p.w * p.h, 0);
  assert.ok(px(imagePieces(b, 2 * step)) < px(pieces) / 3.5);
});

test('the catalogue: only tiles over the box, the newest survey first, none twice', () => {
  const b = box(40.5974, -111.70675, 512);
  const tile = (title, minX, maxX, date) => ({ title, downloadURL: `https://x/${title}.tif`, publicationDate: date, boundingBox: { minX, maxX, minY: 40.5, maxY: 40.7 } });
  const items = [tile('next-door A', -111.83, -111.708, '2024-01-01'), tile('here old', -111.708, -111.59, '2020-05-01'), tile('here new', -111.708, -111.59, '2023-09-01'), tile('here new', -111.708, -111.59, '2023-09-01')];
  // (the box's west edge is at -111.7097: the next-door tile ends at -111.708 and does touch it)
  assert.deepEqual(usgsItemsOver(items, b).map((i) => i.title), ['next-door A', 'here new', 'here old']);
  assert.deepEqual(usgsItemsOver([tile('far', -112.5, -112.4, '2024')], b), []);
});

test('the window of a tile under a box, and the UTM zone of its grid', () => {
  assert.match(usgsUtmDef(26912, -111), /zone=12 /); assert.match(usgsUtmDef(6346, -81), /zone=17 /); assert.match(usgsUtmDef(undefined, -81.3), /zone=17 /);
  const b = box(29.8925, -81.3135, 512); const to = proj4('EPSG:4326', usgsUtmDef(26917, -81.3));
  const [cx, cy] = to.forward([-81.3135, 29.8925]);
  // a 10 km tile, 1 m pixels, with the box well inside it
  const tileBox = [cx - 4000, cy - 3000, cx + 6000, cy + 7000];
  const [c0, r0, c1, r1] = windowUnder(tileBox, 10000, 10000, to, b);
  assert.ok(c1 - c0 >= 512 && c1 - c0 < 560 && r1 - r0 >= 512 && r1 - r0 < 560, `${c1 - c0} x ${r1 - r0}`);
  assert.ok(Math.abs((c0 + c1) / 2 - 4000) < 3 && Math.abs((r0 + r1) / 2 - 7000) < 3);
  assert.equal(windowUnder([cx + 5000, cy, cx + 15000, cy + 10000], 10000, 10000, to, b), null, 'a tile that misses the box');
});

test('files read in place: the newest survey first, an older one only where it adds ground, an empty one dropped', async () => {
  const b = box(29.8925, -81.3135, 512); const to = proj4('EPSG:4326', usgsUtmDef(26917, -81.3));
  const [cx, cy] = to.forward([-81.3135, 29.8925]);
  const fake = (fill) => ({
    getImage: async () => ({
      getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 26917 }), getBoundingBox: () => [cx - 1000, cy - 1000, cx + 1000, cy + 1000], getWidth: () => 2000, getHeight: () => 2000,
      getOrigin: () => [cx - 1000, cy + 1000, 0], getResolution: () => [1, -1, 0], getGDALNoData: () => -999999,
      readRasters: async ({ window: [c0, r0, c1, r1] }) => { const w = c1 - c0; const h = r1 - r0; const a = new Float32Array(w * h); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) a[r * w + c] = fill(c0 + c, r0 + r); return [a]; },
    }),
  });
  const files = {
    'new-west': fake((c) => (c < 1000 ? 5 : -999999)),       // the newest survey has the west half only
    'empty': fake(() => -999999),
    'old-all': fake(() => 7),
    'older-all': fake(() => 9),                               // nothing left for it to add: never kept
  };
  const opened = [];
  const got = await readUsgsWindows(b, {
    catalogue: async () => [{ title: 'older-all', downloadURL: 'older-all', publicationDate: '2015' }, { title: 'old-all', downloadURL: 'old-all', publicationDate: '2019' }, { title: 'empty', downloadURL: 'empty', publicationDate: '2022' }, { title: 'new-west', downloadURL: 'new-west', publicationDate: '2024' }],
    open: async (url) => { opened.push(url); return files[url]; },
  });
  assert.deepEqual(got.map((g) => [g.title, g.layerIndex]), [['new-west', 0], ['old-all', 1]]);
  assert.deepEqual(opened, ['new-west', 'empty', 'old-all'], 'the oldest is not even opened: the box is covered');
  const w = got[0].image.getWidth(); const h = got[0].image.getHeight();
  assert.ok(w < 560 && h < 560 && got[0].raster.length === w * h, `${w}x${h}`);
  // the window's own origin: its first pixel is where the tile's pixel (c0, r0) was
  const [ox, oy] = got[0].image.getOrigin(); assert.ok(Math.abs(ox - (cx - 256)) < 12 && Math.abs(oy - (cy + 256)) < 12, `${ox - cx}, ${oy - cy}`);
  assert.equal(await readUsgsWindows(b, { catalogue: async () => null }), null, 'the catalogue did not answer');
  assert.deepEqual(await readUsgsWindows(b, { catalogue: async () => [] }), []);
});
