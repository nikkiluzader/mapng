// The level's thumbnail card (the MapNG logo and the level's name: exportBeamNGLevel.js generatePreviewBlob) drawn
// in Node on a real canvas, for headless exports: the sweep's canvas stand-in (polyfill.mjs) draws nothing, so
// fixStubs.mjs puts this card in place of the stub. Uses the desktop app's @napi-rs/canvas and the app's own fonts.
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;

/** The card for a level titled `title`, as PNG bytes. */
export async function renderLevelCard(title) {
  const require = createRequire(path.join(REPO, 'desktop/package.json'));
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  for (const [file, family] of [['overpass-latin-wght-normal.woff2', 'Overpass Variable'], ['noto-sans-latin-wght-normal.woff2', 'Noto Sans Variable']]) {
    try { GlobalFonts.registerFromPath(path.join(REPO, 'public/fonts', file), family); } catch { /* a system font */ }
  }
  const saved = globalThis.document;
  globalThis.document = {
    createElement: () => {
      const c = createCanvas(300, 150);
      c.toBlob = (cb) => c.encode('png').then((b) => cb(new Blob([b], { type: 'image/png' })));
      return c;
    },
  };
  try {
    const { generatePreviewBlob } = await import('../../services/exportBeamNGLevel.js');
    const blob = await generatePreviewBlob(title);
    return Buffer.from(await blob.arrayBuffer());
  } finally {
    globalThis.document = saved;
  }
}
