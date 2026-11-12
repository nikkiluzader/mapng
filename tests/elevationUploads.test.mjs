// Custom elevation uploads: the pass of 2026-11-11 (ASC grids with no
// location, units, bounds, no-data in a fitted file, the export's square crop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAscText, placeAscAtCenter, ascNeedsPlacing, ascGroundSize, applyAscCoordinateSystem } from '../services/ascLoader.js';
import { detectUnitFromText, computeGeoMetadata, UNIT_FEET, UNIT_METERS, UNIT_UNKNOWN, UNIT_US_SURVEY_FEET } from '../services/uploadGeoMetadata.js';
import { squareCropNotice } from '../services/squareCrop.js';

const asc = ({ ncols, nrows, x = 0, y = 0, cell, nodata = -9999, value = (i) => i % 7 }) => {
  const rows = [];
  for (let r = 0; r < nrows; r++) rows.push(Array.from({ length: ncols }, (_, c) => value(r * ncols + c)).join(' '));
  return `ncols ${ncols}\nnrows ${nrows}\nxllcorner ${x}\nyllcorner ${y}\ncellsize ${cell}\nNODATA_value ${nodata}\n${rows.join('\n')}\n`;
};

test('a small grid of metre cells from 0,0 is not read as degrees', async () => {
  // 60 x 60 cells of 1 m: 0..60 fits inside ±90 and was taken for 60° a side
  const meta = await parseAscText(asc({ ncols: 60, nrows: 60, cell: 1 }));
  assert.equal(meta.bounds, null);
  assert.equal(meta.isGeoReferenced, false);
  assert.equal(ascNeedsPlacing(meta), true);
  // a real grid in degrees (1 arc-second cells) still is
  const geo = await parseAscText(asc({ ncols: 40, nrows: 30, x: 6.9, y: 45.4, cell: 1 / 3600 }));
  assert.ok(geo.bounds && Math.abs(geo.bounds.west - 6.9) < 1e-9 && Math.abs(geo.bounds.north - (45.4 + 30 / 3600)) < 1e-9);
  assert.equal(ascNeedsPlacing(geo), false);
});

test('an ASC grid with no location is placed at its real size on the map centre', async () => {
  // (the shape of the file a tester sent: a square grid from 0,0, cells just under 1 m)
  const meta = await parseAscText(asc({ ncols: 128, nrows: 64, cell: 0.9765625 }));
  const size = ascGroundSize(meta);
  assert.ok(Math.abs(size.width - 125) < 1e-9 && Math.abs(size.height - 62.5) < 1e-9);
  const center = { lat: 45.0, lng: 7.0 };
  const placed = placeAscAtCenter(meta, center);
  assert.equal(placed.placedAtCenter, true);
  const mLat = 111320; const mLng = 111320 * Math.cos((45 * Math.PI) / 180);
  assert.ok(Math.abs((placed.bounds.east - placed.bounds.west) * mLng - 125) < 0.01);
  assert.ok(Math.abs((placed.bounds.north - placed.bounds.south) * mLat - 62.5) < 0.01);
  assert.ok(Math.abs((placed.bounds.east + placed.bounds.west) / 2 - 7) < 1e-9);
  assert.ok(Math.abs((placed.bounds.north + placed.bounds.south) / 2 - 45) < 1e-9);
  assert.equal(placed.nativeWidth, 125);
  assert.equal(placed.nativeHeight, 63);
  const [tile] = placed.gridTiles;
  assert.equal(tile.epsgCode, 4326);
  assert.equal(tile.width, 128);
  assert.ok(tile.resX > 0 && tile.resY < 0);
  assert.ok(Math.abs(tile.originX + tile.resX * 128 - placed.bounds.east) < 1e-12);
  assert.equal(tile.raster, meta.raster);
  // a file with a location, or with a coordinate system chosen, is left alone
  const geo = await parseAscText(asc({ ncols: 40, nrows: 30, x: 6.9, y: 45.4, cell: 1 / 3600 }));
  assert.equal(placeAscAtCenter(geo, center), geo);
  const projected = await applyAscCoordinateSystem(await parseAscText(asc({ ncols: 50, nrows: 50, x: 500000, y: 300000, cell: 5 })), 2180);
  assert.ok(projected.bounds);
  assert.equal(placeAscAtCenter(projected, center), projected);
  // no centre, or a size that cannot be metres on the ground: unchanged
  assert.equal(placeAscAtCenter(meta, null), meta);
  const tiny = await parseAscText(asc({ ncols: 4, nrows: 4, cell: 0.5 }));
  assert.equal(ascGroundSize(tiny), null);
  assert.equal(placeAscAtCenter(tiny, center), tiny);
});

test('several ASC files with no location keep their places beside each other', async () => {
  const { parseAscFiles } = await import('../services/ascLoader.js');
  const file = (name, text) => ({ name, size: text.length, text: async () => text });
  const meta = await parseAscFiles([
    file('a.asc', asc({ ncols: 100, nrows: 100, x: 1000, y: 2000, cell: 2 })),
    file('b.asc', asc({ ncols: 100, nrows: 100, x: 1200, y: 2000, cell: 2 })),
  ]);
  assert.equal(meta.bounds, null);
  const placed = placeAscAtCenter(meta, { lat: 0, lng: 10 });
  assert.equal(placed.gridTiles.length, 2);
  assert.equal(placed.nativeWidth, 400);
  assert.equal(placed.nativeHeight, 200);
  const [a, b] = placed.gridTiles;
  assert.ok(Math.abs(a.bounds.east - b.bounds.west) < 1e-12);      // side by side, no gap
  assert.ok(Math.abs(a.bounds.east - 10) < 1e-9);                   // the seam on the centre
});

test('units are read from whole words only', () => {
  assert.equal(detectUnitFromText('Processed with terrain software, datum shift applied'), UNIT_UNKNOWN);
  assert.equal(detectUnitFromText('Luftbild 2019'), UNIT_UNKNOWN);
  assert.equal(detectUnitFromText('NAD83 / Texas Central (ftUS)'), UNIT_US_SURVEY_FEET);
  assert.equal(detectUnitFromText('unit: US survey foot'), UNIT_US_SURVEY_FEET);
  assert.equal(detectUnitFromText('US_survey_foot'), UNIT_US_SURVEY_FEET);
  assert.equal(detectUnitFromText('heights in ft'), UNIT_FEET);
  assert.equal(detectUnitFromText('International Foot'), UNIT_FEET);
  assert.equal(detectUnitFromText('SWEREF99 TM|RH2000 height|metre'), UNIT_METERS);
  assert.equal(detectUnitFromText('meters'), UNIT_METERS);
  assert.equal(detectUnitFromText('ETRS89 / UTM zone 33N'), UNIT_UNKNOWN);
});

test('a projected grid\'s bounds hold all four of its corners', async () => {
  // Poland's EPSG:2180 far from its central meridian (19°E): the grid is turned against the meridians
  const g = await computeGeoMetadata({ epsgCode: 2180, sourceWidth: 4000, sourceHeight: 4000, originX: 180000, originY: 700000, resX: 5, resY: -5 });
  const proj4 = (await import('proj4')).default;
  const to = (x, y) => proj4('EPSG:2180', 'EPSG:4326').forward([x, y]);
  for (const [x, y] of [[180000, 700000], [200000, 700000], [180000, 680000], [200000, 680000]]) {
    const [lng, lat] = to(x, y);
    assert.ok(lng >= g.bounds.west - 1e-9 && lng <= g.bounds.east + 1e-9 && lat >= g.bounds.south - 1e-9 && lat <= g.bounds.north + 1e-9, `${x},${y}`);
  }
});

test('the export says beforehand what a terrain that is not a power-of-two square is cut to', () => {
  assert.equal(squareCropNotice(2048, 2048, 1), null);
  const n = squareCropNotice(2000, 2000, 1);
  assert.equal(n.size, 1024);
  assert.ok(Math.abs(n.keptShare - (1024 * 1024) / 4e6) < 1e-12);
  assert.equal(n.suggestSize, 2048);
  assert.equal(n.suggestMpp, 0.976);
  assert.ok((2000 * 1) / n.suggestMpp >= 2048);        // at that pixel size the short edge reaches 2048
  const wide = squareCropNotice(3000, 1800, 2);
  assert.equal(wide.size, 1024);
  assert.equal(wide.keptMeters, 2048);
  assert.equal(wide.suggestMpp, 1.757);
  // exactly a power of two on the short edge, but not square: cut, nothing finer to suggest
  const strip = squareCropNotice(4096, 2048, 1);
  assert.equal(strip.size, 2048);
  assert.equal(strip.suggestMpp, null);
  assert.equal(squareCropNotice(0, 0), null);
  assert.equal(squareCropNotice(20000, 20000, 1).suggestMpp, null);   // (already at the largest level)
});

test('holes in a file fitted to the map take the nearest height; none stay as ground 10 km down', async () => {
  const { fillFittedNoData } = await import('../services/terrain.js');
  const N = -99999;
  // 5 x 4: a hole block in the middle, a NaN, one corner
  const h = new Float32Array([
    10, 10, 10, 20, 20,
    10, N, N, 20, 20,
    10, N, N, NaN, 20,
    N, 30, 30, 30, 20,
  ]);
  assert.equal(fillFittedNoData(h, 5, 4), 6);
  assert.ok([...h].every((v) => Number.isFinite(v) && v >= 10 && v <= 30), [...h].join(','));
  assert.equal(h[6], 10);
  assert.equal(h[15], 10);
  const whole = new Float32Array([1, 2, 3, 4]);
  assert.equal(fillFittedNoData(whole, 2, 2), 0);
  assert.deepEqual([...whole], [1, 2, 3, 4]);
  const empty = new Float32Array(4).fill(N);
  fillFittedNoData(empty, 2, 2);
  assert.deepEqual([...empty], [0, 0, 0, 0]);
});

test('GML tiles in the Japanese survey\'s format: a late start, an early end and "no data" cells are all holes', async () => {
  const { parseGmlText } = await import('../services/gmlLoader.js');
  const W = 12; const H = 8; const startX = 3; const startY = 1; const cut = 5;
  const want = (c, r) => 10 + c * 0.1 + r * 0.5;
  const hole = (c, r) => c >= 6 && c < 8 && r === 4;
  const tuples = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (i < startY * W + startX || i >= W * H - cut) continue;
    tuples.push(hole(c, r) ? 'データなし,-9999.' : `地表面,${want(c, r).toFixed(2)}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Dataset xmlns="http://fgd.gsi.go.jp/spec/2008/FGD_GMLSchema" xmlns:gml="http://www.opengis.net/gml/3.2" gml:id="Dataset1">
<DEM gml:id="DEM001"><type>5mメッシュ（標高）</type><mesh>53394611</mesh>
<coverage gml:id="DEM001-3">
<gml:boundedBy><gml:Envelope srsName="fguuid:jgd2011.bl"><gml:lowerCorner>35.675 139.7625</gml:lowerCorner><gml:upperCorner>35.683333333 139.775</gml:upperCorner></gml:Envelope></gml:boundedBy>
<gml:gridDomain><gml:Grid gml:id="DEM001-4" dimension="2"><gml:limits><gml:GridEnvelope><gml:low>0 0</gml:low><gml:high>${W - 1} ${H - 1}</gml:high></gml:GridEnvelope></gml:limits><gml:axisLabels>x y</gml:axisLabels></gml:Grid></gml:gridDomain>
<gml:rangeSet><gml:DataBlock><gml:rangeParameters><gml:QuantityList uom="DEM構成点"/></gml:rangeParameters>
<gml:tupleList>
${tuples.join('\n')}
</gml:tupleList></gml:DataBlock></gml:rangeSet>
<gml:coverageFunction><gml:GridFunction><gml:sequenceRule order="+x-y">Linear</gml:sequenceRule><gml:startPoint>${startX} ${startY}</gml:startPoint></gml:GridFunction></gml:coverageFunction>
</coverage></DEM></Dataset>`;
  const m = await parseGmlText(xml);
  assert.equal(m.sourceWidth, W);
  assert.equal(m.sourceHeight, H);
  assert.deepEqual(m.bounds, { north: 35.683333333, south: 35.675, east: 139.775, west: 139.7625 });
  const nd = m.noData;
  let holes = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c; const v = m.raster[i];
    const missing = i < startY * W + startX || i >= W * H - cut || hole(c, r);
    if (missing) { assert.equal(v, nd, `cell ${c},${r} should be a hole, reads ${v}`); holes++; }
    else assert.ok(Math.abs(v - want(c, r)) < 0.011, `cell ${c},${r}: ${v}`);
  }
  assert.equal(holes, startY * W + startX + cut + 2);
  // (the tile's own no-data value is what the resampler masks)
  assert.equal(m.gridTiles[0].noData, nd);
});
