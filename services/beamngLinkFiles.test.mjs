import test from 'node:test';
import assert from 'node:assert/strict';

import { createBeamNGLinkFileRegistry } from '../services/beamngLinkFiles.js';

test('rewrites external level paths and emits deterministic link files', () => {
  const links = createBeamNGLinkFileRegistry('mapng_demo');

  const rewritten = links.rewriteAssetPath('/levels/west_coast_usa/art/shapes/objects/guardrail1.dae');
  assert.equal(
    rewritten,
    '/levels/mapng_demo/linked/levels/west_coast_usa/art/shapes/objects/guardrail1.dae',
  );

  const linkFiles = links.getLinkFiles();
  assert.equal(linkFiles.length, 1);
  assert.equal(
    linkFiles[0].path,
    'levels/mapng_demo/linked/levels/west_coast_usa/art/shapes/objects/guardrail1.dae.link',
  );

  const content = JSON.parse(linkFiles[0].contents);
  assert.deepEqual(content, {
    path: '/levels/west_coast_usa/art/shapes/objects/guardrail1.dae',
  });
});

test('does not rewrite local level paths', () => {
  const links = createBeamNGLinkFileRegistry('mapng_demo');
  const unchanged = links.rewriteAssetPath('levels/mapng_demo/art/terrains/terrain.png');

  assert.equal(unchanged, 'levels/mapng_demo/art/terrains/terrain.png');
  assert.equal(links.getLinkCount(), 0);
});

test('rewrites nested object path values deeply', () => {
  const links = createBeamNGLinkFileRegistry('mapng_demo');
  const rewritten = links.rewriteObjectPathsDeep({
    shapeFile: 'levels/italy/art/shapes/trees/trees_italy/cypress_tree.dae',
    Stages: [{
      colorMap: '/levels/italy/art/shapes/groundcover/Grass_Middle_d.dds',
    }],
  });

  assert.equal(
    rewritten.shapeFile,
    'levels/mapng_demo/linked/levels/italy/art/shapes/trees/trees_italy/cypress_tree.dae',
  );
  assert.equal(
    rewritten.Stages[0].colorMap,
    '/levels/italy/art/shapes/groundcover/Grass_Middle_d.dds',
  );
  assert.equal(links.getLinkCount(), 1);
});

test('does not rewrite texture-like level paths', () => {
  const links = createBeamNGLinkFileRegistry('mapng_demo');

  assert.equal(
    links.rewriteAssetPath('/levels/east_coast_usa/art/shapes/trees/trees_beech/t_beech_leaves_b.color'),
    '/levels/east_coast_usa/art/shapes/trees/trees_beech/t_beech_leaves_b.color',
  );
  assert.equal(
    links.rewriteAssetPath('/levels/east_coast_usa/art/shapes/trees/trees_aspen/t_birch_bark_b.color.png'),
    '/levels/east_coast_usa/art/shapes/trees/trees_aspen/t_birch_bark_b.color.png',
  );
  assert.equal(links.getLinkCount(), 0);
});
