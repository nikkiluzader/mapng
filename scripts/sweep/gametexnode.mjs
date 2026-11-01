// The app's generateGameTexture run in Node (no browser): a real canvas
// (@napi-rs/canvas, NAPI_CANVAS = its path) behind document/Image, on a
// levelprobe area: node scripts/sweep/gametexnode.mjs <area> <out.png>
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { AREAS_DIR, REPO } from './env.mjs';
const { createCanvas, Image, loadImage } = await import(process.env.NAPI_CANVAS || '@napi-rs/canvas');

globalThis.document = { createElement: (tag) => { if (tag !== 'canvas') throw new Error(tag); const c = createCanvas(1, 1); return c; } };
globalThis.Image = Image;
// (canvas.toBlob as the browser's)
const proto = Object.getPrototypeOf(createCanvas(1, 1));
if (!proto.toBlob) proto.toBlob = function (cb, type = 'image/png') { cb(new Blob([this.toBuffer(type)], { type })); };

const { generateGameTexture } = await import('../../services/osmTexture.js');
const { roundRoadCorners } = await import('../../services/roadCurves.js');
const [area, pngOut] = process.argv.slice(2);
const dir = `${AREAS_DIR}/${area}/`;
const meta = JSON.parse(fs.readFileSync(dir + 'meta.json'));
const osm = JSON.parse(fs.readFileSync(dir + 'osm.json'));
const satPng = `${os.tmpdir()}/gametex_${area}_sat.png`;
if (!fs.existsSync(satPng)) execFileSync('node', [`${REPO}/scripts/sweep/satellite.mjs`, '-', area, satPng], { stdio: 'inherit' });
const img = await loadImage(fs.readFileSync(satPng));
const satelliteCanvas = createCanvas(img.width, img.height);
satelliteCanvas.getContext('2d').drawImage(img, 0, 0);
const terrainData = { width: meta.size, height: meta.size, bounds: meta.bounds, osmFeatures: roundRoadCorners(osm).features, processingMetersPerPixel: meta.mpp };
const { blob } = await generateGameTexture(terrainData, { Roads: true, satelliteCanvas });
fs.writeFileSync(pngOut, Buffer.from(await blob.arrayBuffer()));
console.log(`game texture ${fs.statSync(pngOut).size} bytes -> ${pngOut}`);
