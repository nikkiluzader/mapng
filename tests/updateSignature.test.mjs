// desktop/updateSignature.js: an update is taken only with MapNG's signature on the very files it names.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { UPDATE_KEYS, manifestName, manifestNames, signedByMapng, verifyUpdate } from '../desktop/updateSignature.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keys = [publicKey.export({ type: 'spki', format: 'der' }).toString('base64')];
const sign = (bytes, key = privateKey) => crypto.sign(null, Buffer.from(bytes), key).toString('base64');
const SUM = 'q'.repeat(86) + '==';
const OTHER = 'z'.repeat(86) + '==';
const yml = (version = '0.3.2', sum = SUM) => `version: ${version}\nfiles:\n  - url: MapNG-Setup-${version}.exe\n    sha512: ${sum}\n    size: 123\npath: MapNG-Setup-${version}.exe\nsha512: ${sum}\nreleaseDate: '2026-11-15T00:00:00.000Z'\n`;
const info = (version = '0.3.2', sum = SUM) => ({ version, files: [{ url: `MapNG-Setup-${version}.exe`, sha512: sum }] });
const release = (files) => async (url) => {
  const name = url.split('/').pop();
  return name in files ? new Response(files[name], { status: 200 }) : new Response('', { status: 404 });
};

test('a signature is good only from a trusted key over these very bytes', () => {
  const text = yml();
  assert.equal(signedByMapng(text, sign(text), keys), true);
  assert.equal(signedByMapng(text + ' ', sign(text), keys), false);
  assert.equal(signedByMapng(text, sign(text, crypto.generateKeyPairSync('ed25519').privateKey), keys), false);
  assert.equal(signedByMapng(text, '', keys), false);
  assert.equal(signedByMapng(text, 'not base64 at all !!', keys), false);
  assert.equal(signedByMapng(text, sign(text), ['garbage', ...keys]), true);
  assert.equal(signedByMapng(text, sign(text), []), false);
});

test('the signed list must be of this version and name every file with its checksum', () => {
  assert.equal(manifestNames(yml(), info()), true);
  assert.equal(manifestNames(yml('0.3.1'), info('0.3.2')), false);          // an old, validly signed list offered again
  assert.equal(manifestNames(yml('0.3.2', OTHER), info('0.3.2', SUM)), false);   // another file under the same version
  assert.equal(manifestNames(yml(), { version: '0.3.2', files: [] }), false);
  assert.equal(manifestNames('', info()), false);
});

test('an update is taken with a good signature, and refused in every other case', async () => {
  const text = yml();
  const good = { 'latest.yml': text, 'latest.yml.sig': sign(text) };
  assert.deepEqual(await verifyUpdate(info(), release(good), { platform: 'win32', keys }), { ok: true });
  const asked = [];
  await verifyUpdate(info(), async (url) => { asked.push(url); return new Response('', { status: 404 }); }, { platform: 'linux', keys });
  assert.deepEqual(asked, ['https://github.com/nikkiluzader/mapng/releases/download/v0.3.2/latest-linux.yml', 'https://github.com/nikkiluzader/mapng/releases/download/v0.3.2/latest-linux.yml.sig']);
  const refused = async (files, i = info()) => (await verifyUpdate(i, release(files), { platform: 'win32', keys })).ok;
  assert.equal(await refused({ 'latest.yml': text }), false);                                        // no signature
  assert.equal(await refused({ 'latest.yml': yml('0.3.2', OTHER), 'latest.yml.sig': sign(text) }), false);   // files swapped after signing
  assert.equal(await refused(good, info('0.3.2', OTHER)), false);                                    // the updater was told of another file
  assert.equal(await refused(good, info('../../evil')), false);
  assert.equal((await verifyUpdate(info(), async () => { throw new Error('offline'); }, { keys })).ok, false);
  assert.equal(manifestName('win32'), 'latest.yml');
});

test('the app ships with a key, and everything the main process imports is packaged', () => {
  assert.ok(UPDATE_KEYS.length >= 1 && UPDATE_KEYS.every((k) => crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType === 'ed25519'));
  const dir = new URL('../desktop/', import.meta.url);
  const packaged = new Set([...fs.readFileSync(new URL('electron-builder.yml', dir), 'utf8').matchAll(/^  - ([\w.-]+\.(?:js|cjs))$/gm)].map((m) => m[1]));
  const seen = new Set(['main.js']); const queue = ['main.js'];
  while (queue.length) {
    const src = fs.readFileSync(new URL(queue.pop(), dir), 'utf8');
    for (const m of src.matchAll(/from '\.\/([\w.-]+\.js)'/g)) if (!seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
  }
  for (const f of seen) assert.ok(packaged.has(f), `${f} is imported by the main process but not in electron-builder.yml files: the packaged app would not start`);
});
