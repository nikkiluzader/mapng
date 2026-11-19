import test from 'node:test';
import assert from 'node:assert/strict';
import { guessCoordinateSystems } from '../services/crsCatalog.js';
import { getBuiltInProj4 } from '../services/uploadGeoMetadata.js';
import { parseLazFile } from '../services/lazLoader.js';

const guess = (x, y, near) => guessCoordinateSystems({ minX: x, maxX: x + 1000, minY: y, maxY: y + 1000 }, { near, defOf: getBuiltInProj4 });
const FLAGSTAFF = { lat: 35.2, lng: -111.6 };

// A file that names no coordinate system: its numbers fit a national grid's area of use (strong evidence) or a UTM
// zone (weak: any easting fits some zone). The map's view breaks ties; left far away, the most central fit wins.
test('coordinate system guesses: national grids by their area of use, the map view as the tiebreaker', () => {
  const cases = [
    [496000, 6086000, FLAGSTAFF, 3346, 54.92, 23.95],   // the Lithuanian tile from Discord, the map left at Flagstaff
    [496000, 6086000, null, 3346, 54.92, 23.95],
    [530000, 180000, { lat: 51.5, lng: -0.1 }, 27700, 51.51, -0.12],
    [149000, 170000, { lat: 50.85, lng: 4.35 }, 31370, 50.84, 4.36],
    [625000, 484000, { lat: 48.2, lng: 16.37 }, 31287, 48.22, 16.37],
    [506000, 313000, { lat: 56.95, lng: 24.1 }, 3059, 56.97, 24.11],
    [652000, 6862000, FLAGSTAFF, 2154, 48.86, 2.35],
    [2600000, 1200000, null, 2056, 46.96, 7.45],
    [691000, 5334000, { lat: 48.14, lng: 11.58 }, 32632, 48.13, 11.57],   // a UTM zone, the map near it
    [440000, 3895000, FLAGSTAFF, 32612, 35.20, -111.65],
  ];
  for (const [x, y, near, epsg, lat, lng] of cases) {
    const top = guess(x, y, near)[0];
    assert.equal(top?.epsg, epsg, `${x}, ${y}: ${top?.name}`);
    assert.ok(Math.abs(top.center.lat - lat) < 0.02 && Math.abs(top.center.lng - lng) < 0.02, `${top.name} at ${top.center.lat}, ${top.center.lng}`);
  }
  // the others stay on offer
  assert.ok(guess(496000, 6086000, FLAGSTAFF).length > 1);
});

// A LAS file with no GeoKeys or WKT (LAStools las2las output): placed by the guess, reported as one.
test('a LAS file naming no coordinate system is placed by the best guess, and a picked one is used instead', async () => {
  const buf = new ArrayBuffer(227); const v = new DataView(buf); const b = new Uint8Array(buf);
  b.set([76, 65, 83, 70], 0);                      // LASF
  v.setUint8(24, 1); v.setUint8(25, 2);            // version 1.2
  v.setUint16(94, 227, true); v.setUint32(96, 227, true); v.setUint32(100, 0, true);
  v.setUint8(104, 3); v.setUint16(105, 34, true); v.setUint32(107, 0, true);
  [0.01, 0.01, 0.01, 0, 0, 0].forEach((d, i) => v.setFloat64(131 + i * 8, d, true));
  [497000, 496000, 6087000, 6086000, 158, 29].forEach((d, i) => v.setFloat64(179 + i * 8, d, true));
  const file = { name: 'tile.las', size: buf.byteLength, arrayBuffer: async () => buf };
  const meta = await parseLazFile(file, { near: FLAGSTAFF });
  assert.equal(meta.epsgCode, 3346);
  assert.equal(meta.crsGuess.name, 'LKS-94');
  assert.equal(meta.crsGuess.picked, false);
  assert.ok(Math.abs(meta.center.lat - 54.92) < 0.02 && Math.abs(meta.center.lng - 23.95) < 0.02);
  const picked = await parseLazFile(file, { forceEpsg: 32634 });
  assert.equal(picked.epsgCode, 32634);
  assert.equal(picked.crsGuess.picked, true);
  assert.ok(Math.abs(picked.center.lng - 20.95) < 0.02);
});
