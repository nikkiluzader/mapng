#!/usr/bin/env node
// The next desktop test build: bumps desktop/package.json (and its lock) to X.Y.Z-dev.N and says what to run.
//   node scripts/release/devRelease.mjs            what the next version would be (changes nothing)
//   node scripts/release/devRelease.mjs --write    write the version into desktop/package.json and its lock
// From a release (0.3.0) the next test build is 0.3.1-dev.1; from a test build (0.3.1-dev.3) it is 0.3.1-dev.4.
// Pushing the tag is what publishes: .github/workflows/desktop-release.yml builds it and makes it a pre-release.
import fs from 'node:fs';

/** '0.3.0' -> '0.3.1-dev.1'; '0.3.1-dev.3' -> '0.3.1-dev.4'. */
export function nextDevVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(String(v).trim());
  if (!m) throw new Error(`not a version this script knows: ${v}`);
  return m[4] === undefined ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}-dev.1` : `${m[1]}.${m[2]}.${m[3]}-dev.${Number(m[4]) + 1}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pkgPath = new URL('../../desktop/package.json', import.meta.url); const lockPath = new URL('../../desktop/package-lock.json', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); const next = nextDevVersion(pkg.version);
  if (!process.argv.includes('--write')) { console.log(`${pkg.version} -> ${next} (run with --write to set it)`); process.exit(0); }
  // (the version line alone is rewritten: the files keep their formatting)
  const swap = (path, count) => { let text = fs.readFileSync(path, 'utf8'); let n = 0; text = text.replace(new RegExp(`("version": ")${pkg.version.replace(/[.]/g, '\\.')}(")`, 'g'), (all, a, b) => (n++ < count ? `${a}${next}${b}` : all)); fs.writeFileSync(path, text); return n; };
  swap(pkgPath, 1);
  if (fs.existsSync(lockPath)) swap(lockPath, 2);
  console.log(`desktop version ${pkg.version} -> ${next}\nnext:\n  git commit -am "Desktop test build ${next}"\n  git tag v${next}\n  git push origin dev v${next}     (this publishes it to testers)`);
}
