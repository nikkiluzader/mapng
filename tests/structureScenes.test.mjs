// The synthetic structure scenes through today's passes: no scene may get
// worse than its recorded baseline (tests/fixtures/structureBaseline.json).
// When a change improves a scene, re-record with
//   node scratch/structprobe/scenes.mjs  (and copy the JSON it prints)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/structureBaseline.json', import.meta.url), 'utf8'));
const COUNTS = ['steps', 'steepStructure', 'steepGround', 'shortCrossings', 'groundGaps', 'throughDeck', 'spikes'];

for (const scene of STRUCTURE_SCENES) {
  test(`structure scene: ${scene.name}`, async () => {
    const log = console.log; console.log = () => {};
    let summary;
    try { ({ summary } = await runStructureScene(scene)); } finally { console.log = log; }
    const base = baseline[scene.name];
    assert.ok(base, `no baseline for "${scene.name}"`);
    for (const k of COUNTS) assert.ok(summary[k] <= base[k], `${k}: ${summary[k]} (baseline ${base[k]})`);
    if (!scene.future) assert.ok(summary.decks + summary.tunnels > 0, 'a structure was built');
  });
}
