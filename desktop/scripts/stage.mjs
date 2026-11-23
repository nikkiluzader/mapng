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
// pinned to a release at least two weeks old, or the newest security release
// of the line when that is younger (26.13.1, 2026-11-10, is one). Against
// Node 22 a dense 2 km export ran 10% faster in a third less memory, and
// Node 22's V8 now and then crashed compiling an 8 km one ("unreachable code").
const NODE_VERSION = 'v26.13.1';
// The archives' SHA-256, written down here from nodejs.org's SHASUMS256.txt when the version was chosen: the
// download is checked against these, not against a list fetched from the same server at build time. A new
// NODE_VERSION needs new lines (curl https://nodejs.org/dist/<version>/SHASUMS256.txt).
const NODE_SHA256 = {
  'node-v26.13.1-linux-x64.tar.xz': '5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864',
  'node-v26.13.1-win-x64.zip': 'e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7',
};
// The runner's packages as npm's registry published them (name@version: the tarball's checksum). They are
// installed without a lock file (one folder serves either platform), so what arrived is checked against this
// list afterwards: a package or a version not on it stops the build. A new version needs its line
// (npm view <name>@<version> dist.integrity).
const RUNNER_PACKAGES = {
  '@napi-rs/canvas@1.0.11': 'sha512-vt5tog1cr+QKadIddGe+3LrcX0EmjEd0izF717Uwf92mBmgYfq2XRmL2r4bZU40spB69exxhrBn9I91HYEr/7w==',
  '@napi-rs/canvas-win32-x64-msvc@1.0.11': 'sha512-DFYp/ZQRdKunI/LPc0UkRXG1vlNjJKOJf8O8Ctb8+wm2Nt2ELg9Eamc31D2VoakkfGo8L+z0Iejz6WtFbQwyGw==',
  '@napi-rs/canvas-linux-x64-gnu@1.0.11': 'sha512-iDapw7nFSE5tsmQxcH2+KotJhyfVPmHd6vUOQN/Em+8WNbkZJwJ/rDowlJMFnMl0SYSDSfgKCNUGi6Sn5++Smg==',
  '@napi-rs/canvas-linux-x64-musl@1.0.11': 'sha512-26q26AyITo3CGZX4HWFIMgBMA1lu3YN07gxzBm4tW6Hglq/OVyTP50kDrmWuKybCX6dh3m8Ly+c7YhI+sqCgCQ==',
  'laz-perf@0.0.7': 'sha512-2xRqm/f/2UqDS5qqkjOyDb6uVIjkVw6SGmQlMoTQliVWkZhPfIbUJTubUl3mTloaWqKcjlS/urmP1CYoxelsEg==',
};
const CANVAS_VERSION = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).devDependencies['@napi-rs/canvas'];
// (left out of the bundle: native or loaded at run time)
const RUNNER_EXTERNAL = ['@napi-rs/canvas', 'laz-perf'];
// (work handed to worker threads: each is loaded by its own file name)
// (the export's worker threads, and the page's heightmap resampler worker,
// which the runner starts as `new URL('./resamplerWorker.js', import.meta.url)`)
const WORKER_MODULES = ['sidewalkPanels.js', 'daeWorker.js', 'buildingWorker.js', 'resamplerWorker.js', 'satelliteDetailStrip.js', 'composeWorker.js', 'pavedWorker.js'];
const RUNNERS = ['exportJob.mjs', 'generateJob.mjs', 'prefetchJob.mjs'];
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
  // (what npm installed, by its own record of each tarball's checksum, against the list above)
  const installed = JSON.parse(fs.readFileSync(path.join(out, 'node_modules', '.package-lock.json'), 'utf8')).packages || {};
  const names = Object.keys(installed);
  if (!names.length) throw new Error('the runner\'s packages: npm recorded none');
  for (const at of names) {
    const id = `${at.replace(/^.*node_modules\//, '')}@${installed[at].version}`;
    if (!RUNNER_PACKAGES[id]) throw new Error(`the runner's packages: ${id} is not on the list in desktop/scripts/stage.mjs (RUNNER_PACKAGES)`);
    if (installed[at].integrity !== RUNNER_PACKAGES[id]) throw new Error(`the runner's packages: ${id} does not match its recorded checksum`);
  }
  console.log(`runner packages checked: ${names.length} match their recorded checksums`);
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
  const want = NODE_SHA256[name];
  if (!want) throw new Error(`${name}: no checksum recorded in desktop/scripts/stage.mjs (NODE_SHA256)`);
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
