// services/kron86.js: Poland's NMT, the finest grid each map sheet has
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBestNmtTiles } from '../services/kron86.js';

// (the index's records for one area in the Beskids, 2026-11: a 5 m grid in 2019 and 2023, 1 m lidar in 2021, 2022, 2024, 2025)
const c = (godlo, year, resolutionM, format = 'ARC/INFO ASCII GRID', heightErrorM = 0.5) => ({ godlo, year, resolutionM, format, heightErrorM, url: `https://example.invalid/${year}/${godlo}-${resolutionM}-${format.replace(/\W/g, '')}` });

test('the 1 m lidar sheet wins over a newer 5 m one', () => {
  const picked = pickBestNmtTiles([c('M-34-86-B-b-2-1', 2023, 5), c('M-34-86-B-b-2-1', 2022, 1, 'ARC/INFO ASCII GRID', 0.2), c('M-34-86-B-b-2-1', 2019, 5, 'ASCII NMT')]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].year, 2022); assert.equal(picked[0].resolutionM, 1);
});

test('among equal grids: a regular grid over point lists, then the newest, then the smaller error', () => {
  assert.equal(pickBestNmtTiles([c('A', 2019, 5, 'ASCII NMT'), c('A', 2019, 5, 'ARC/INFO ASCII GRID')])[0].format, 'ARC/INFO ASCII GRID');
  assert.equal(pickBestNmtTiles([c('A', 2021, 1), c('A', 2024, 1), c('A', 2022, 1)])[0].year, 2024);
  assert.equal(pickBestNmtTiles([c('A', 2021, 1, 'ARC/INFO ASCII GRID', 0.6), c('A', 2021, 1, 'ARC/INFO ASCII GRID', 0.15)])[0].heightErrorM, 0.15);
});

test('one download per sheet; a sheet only surveyed at 5 m stays 5 m; one with no spacing given comes last', () => {
  const picked = pickBestNmtTiles([c('A', 2025, 1), c('A', 2025, 5), c('B', 2019, 5), c('C', 2020, null), c('C', 2018, 5)]);
  assert.deepEqual(picked.map((p) => `${p.godlo}:${p.resolutionM}`).sort(), ['A:1', 'B:5', 'C:5']);
  assert.deepEqual(pickBestNmtTiles([]), []);
});
