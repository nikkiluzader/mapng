import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAscCoordinateSystem, parseAscText } from '../services/ascLoader.js';

test('parseAscText parses corner-registered geographic ASC grids', async () => {
  const asc = [
    'ncols 2',
    'nrows 2',
    'xllcorner -120.0',
    'yllcorner 39.99',
    'cellsize 0.01',
    'nodata_value -9999',
    '1 2',
    '3 4',
  ].join('\n');

  const parsed = await parseAscText(asc, { fileName: 'tiny.asc', fileSize: asc.length });

  assert.equal(parsed.sourceType, 'grid');
  assert.equal(parsed.sourceFormat, 'asc');
  assert.equal(parsed.formatLabel, 'ASC Grid');
  assert.equal(parsed.sourceWidth, 2);
  assert.equal(parsed.sourceHeight, 2);
  assert.equal(parsed.noData, -9999);
  assert.equal(parsed.isGeoReferenced, true);
  assert.ok(Math.abs(parsed.bounds.north - 40.01) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.south - 39.99) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.east - (-119.98)) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.west - (-120.0)) < 1e-9);
  assert.ok(Math.abs(parsed.center.lat - 40.0) < 1e-9);
  assert.ok(Math.abs(parsed.center.lng - (-119.99)) < 1e-9);
  assert.deepEqual(Array.from(parsed.raster), [1, 2, 3, 4]);
  assert.equal(parsed.gridTiles.length, 1);
});

test('parseAscText keeps projected ASC grids as user-positioned sources', async () => {
  const asc = [
    'ncols 3',
    'nrows 2',
    'xllcenter 323543',
    'yllcenter 318612',
    'cellsize 1',
    '10 11 12',
    '13 -9999 15',
  ].join('\n');

  const parsed = await parseAscText(asc, { fileName: 'projected.asc', fileSize: asc.length });

  assert.equal(parsed.isGeoReferenced, false);
  assert.equal(parsed.bounds, null);
  assert.equal(parsed.center, null);
  assert.equal(parsed.noData, -9999);
  assert.deepEqual(Array.from(parsed.raster), [10, 11, 12, 13, -9999, 15]);
  assert.equal(parsed.gridTiles.length, 0);
});

test('parseAscText detects geographic grids with 0..360 longitudes', async () => {
  const asc = [
    'ncols 2',
    'nrows 2',
    'xllcorner 200.0',
    'yllcorner 9.0',
    'cellsize 1.0',
    'nodata_value -9999',
    '1 2',
    '3 4',
  ].join('\n');

  const parsed = await parseAscText(asc, { fileName: 'unsigned-lon.asc', fileSize: asc.length });

  assert.equal(parsed.isGeoReferenced, true);
  assert.ok(parsed.bounds);
  assert.ok(Math.abs(parsed.bounds.west - (-160)) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.east - (-158)) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.south - 9) < 1e-9);
  assert.ok(Math.abs(parsed.bounds.north - 11) < 1e-9);
});

test('applyAscCoordinateSystem maps PL-1992 ASC to WGS84 bounds/center', async () => {
  const asc = [
    'ncols 2',
    'nrows 2',
    'xllcenter 323543',
    'yllcenter 318612',
    'cellsize 1',
    'nodata_value -9999',
    '1 2',
    '3 4',
  ].join('\n');

  const parsed = await parseAscText(asc, { fileName: 'pl1992.asc', fileSize: asc.length });
  assert.equal(parsed.isGeoReferenced, false);

  const withCrs = await applyAscCoordinateSystem(parsed, 2180);

  assert.equal(withCrs.isGeoReferenced, true);
  assert.equal(withCrs.epsgCode, 2180);
  assert.ok(withCrs.bounds);
  assert.ok(withCrs.center);
  assert.ok(withCrs.center.lat >= 49 && withCrs.center.lat <= 55);
  assert.ok(withCrs.center.lng >= 14 && withCrs.center.lng <= 24);
  assert.equal(withCrs.gridTiles.length, 1);
  assert.ok(Number.isFinite(withCrs.gridTiles[0].originX));
  assert.ok(Number.isFinite(withCrs.gridTiles[0].originY));
  assert.ok(Number.isFinite(withCrs.gridTiles[0].resX));
  assert.ok(Number.isFinite(withCrs.gridTiles[0].resY));
});

test('parseAscText emits worker-ready affine tile metadata for geographic ASC', async () => {
  const asc = [
    'ncols 2',
    'nrows 2',
    'xllcorner -120.0',
    'yllcorner 39.99',
    'cellsize 0.01',
    '1 2',
    '3 4',
  ].join('\n');

  const parsed = await parseAscText(asc, { fileName: 'geo.asc', fileSize: asc.length });
  assert.equal(parsed.gridTiles.length, 1);
  const tile = parsed.gridTiles[0];
  assert.equal(tile.epsgCode, 4326);
  assert.ok(Math.abs(tile.originX - (-120)) < 1e-9);
  assert.ok(Math.abs(tile.originY - 40.010000000000005) < 1e-9);
  assert.ok(Math.abs(tile.resX - 0.01) < 1e-9);
  assert.ok(Math.abs(tile.resY - (-0.01)) < 1e-9);
});
