// Sign a release's latest*.yml files (see desktop/updateSignature.js): for each file given, writes
// <file>.sig, the base64 Ed25519 signature of its bytes. The key is the UPDATE_SIGNING_KEY secret
// (PKCS#8, base64), never in the repository. Each signature is checked against the keys the app
// ships with before it is written: a release signed with a key the app does not trust would
// leave every install unable to update.
//   node desktop/scripts/signManifest.mjs desktop/release/latest.yml [...]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { signedByMapng } from '../updateSignature.js';

const secret = (process.env.UPDATE_SIGNING_KEY || '').trim();
if (!secret) { console.error('UPDATE_SIGNING_KEY is not set: the release cannot be signed, and installs would refuse it.'); process.exit(1); }
const key = crypto.createPrivateKey({ key: Buffer.from(secret, 'base64'), format: 'der', type: 'pkcs8' });
const files = process.argv.slice(2);
if (!files.length) { console.error('no files to sign'); process.exit(1); }
for (const file of files) {
  const bytes = fs.readFileSync(file);
  const signature = crypto.sign(null, bytes, key).toString('base64');
  if (!signedByMapng(bytes, signature)) { console.error(`${file}: signed, but not with a key the app trusts (desktop/updateSignature.js UPDATE_KEYS)`); process.exit(1); }
  fs.writeFileSync(`${file}.sig`, signature);
  console.log(`signed ${file}`);
}
