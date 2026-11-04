#!/usr/bin/env node
// Stage what the packaged app carries outside its asar, for one platform:
//   build/runner/   the export runner bundled with the app's services
//                   (esbuild), plus the native canvas for that platform
//   build/node/     the Node runtime the runner runs in (nodejs.org, checked
//                   against its SHASUMS256)
// The page itself is the repo's dist/ (npm run build at the root).
//
//   node scripts/stage.mjs [--platform win32|linux] [--arch x64]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(DESKTOP, 'build');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const platform = arg('platform', process.platform);
const arch = arg('arch', 'x64');

// the Node release the export runs in: the latest LTS line (26, "Lithium"),
// pinned to a release at least two weeks old (26.12.0 is that line just
// before its LTS label; move to 26.13.x once one is). Against Node 22 a
// dense 2 km export ran 10% faster in a third less memory, and Node 22's V8
// now and then crashed compiling an 8 km one ("unreachable code").
const NODE_VERSION = 'v26.12.0';
const CANVAS_VERSION = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).devDependencies['@napi-rs/canvas'];
// (left out of the bundle: native or loaded at run time)
const RUNNER_EXTERNAL = ['@napi-rs/canvas', 'laz-perf'];
// (work handed to worker threads: each is loaded by its own file name)
// (the export's worker threads, and the page's heightmap resampler worker,
// which the runner starts as `new URL('./resamplerWorker.js', import.meta.url)`)
const WORKER_MODULES = ['sidewalkPanels.js', 'daeWorker.js', 'buildingWorker.js', 'resamplerWorker.js'];
const RUNNERS = ['exportJob.mjs', 'generateJob.mjs'];
const gitHash = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: DESKTOP }).toString().trim(); } catch { return 'unknown'; } })();
const BUILD_DEFINES = { __BUILD_HASH__: JSON.stringify(gitHash), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) };
const LAZ_PERF_VERSION = JSON.parse(fs.readFileSync(path.join(DESKTOP, '..', 'package.json'), 'utf8')).dependencies['laz-perf'].replace(/^[\^~]/, '');

async function stageRunner() {
  const out = path.join(BUILD, 'runner');
  fs.rmSync(out, { recursive: true, force: true });
  await build({
    // (each runner the app starts: an export, and Generate Data)
    entryPoints: RUNNERS.map((name) => path.join(DESKTOP, 'runner', name)),
    outdir: out,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26',
    external: RUNNER_EXTERNAL,
    // (bundled CommonJS calling require(): give the ESM bundle one)
    banner: { js: "import { createRequire as __mapngRequire } from 'node:module'; const require = __mapngRequire(import.meta.url);" },
    // (the build a level's mapng.json names, as the page's vite build does)
    define: BUILD_DEFINES,
    logLevel: 'warning',
  });
  // the modules worker threads load (services/parallel.js), beside the bundle
  // under the names the services ask for them by
  for (const name of WORKER_MODULES) {
    await build({
      entryPoints: [path.join(DESKTOP, '..', 'services', name)],
      outfile: path.join(out, name),
      bundle: true, platform: 'node', format: 'esm', target: 'node26', external: RUNNER_EXTERNAL,
      banner: { js: "import { createRequire as __mapngRequire } from 'node:module'; const require = __mapngRequire(import.meta.url);" },
      logLevel: 'warning',
    });
  }
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'mapng-export-runner', private: true, type: 'module' }, null, 1));
  // the native canvas for the target platform (npm picks its prebuilt binary by --os/--cpu)
  execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--omit=dev', `--os=${platform}`, `--cpu=${arch}`,
    `@napi-rs/canvas@${CANVAS_VERSION}`, `laz-perf@${LAZ_PERF_VERSION}`], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' });
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function stageNode() {
  const out = path.join(BUILD, 'node');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const name = platform === 'win32' ? `node-${NODE_VERSION}-win-${arch}.zip` : `node-${NODE_VERSION}-${platform}-${arch}.tar.xz`;
  const cache = path.join(BUILD, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, name);
  if (!fs.existsSync(archive)) fs.writeFileSync(archive, await download(`https://nodejs.org/dist/${NODE_VERSION}/${name}`));
  const sums = (await download(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).toString();
  const want = sums.split('\n').find((l) => l.endsWith(`  ${name}`))?.split(/\s+/)[0];
  const got = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (!want || want !== got) { fs.rmSync(archive); throw new Error(`${name}: checksum mismatch`); }
  const base = name.replace(/\.(zip|tar\.xz)$/, '');
  // (the runtime alone: npm and headers are not needed)
  if (name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(fs.readFileSync(archive));
    for (const f of ['node.exe', 'LICENSE']) fs.writeFileSync(path.join(out, f), await zip.file(`${base}/${f}`).async('nodebuffer'));
    return;
  }
  const tmp = fs.mkdtempSync(path.join(cache, 'x-'));
  execFileSync('tar', ['-xJf', archive, '-C', tmp]);
  const root = path.join(tmp, base);
  fs.mkdirSync(path.join(out, 'bin'));
  fs.copyFileSync(path.join(root, 'bin', 'node'), path.join(out, 'bin', 'node'));
  fs.chmodSync(path.join(out, 'bin', 'node'), 0o755);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
  fs.rmSync(tmp, { recursive: true, force: true });
}

await stageRunner();
await stageNode();
console.log(`staged ${platform}-${arch}: build/runner, build/node (${NODE_VERSION})`);
