#!/usr/bin/env node
// Sign in to OpenStreetMap for the maintenance scripts (OAuth 2, PKCE, out-of-band code).
//
//   node scripts/osm/login.mjs [--dev]            1. prints the sign-in link
//   node scripts/osm/login.mjs [--dev] --code X   2. trades the code OSM showed for a token
//
// The token goes to ~/.config/mapng/mapng.env (OSM_ACCESS_TOKEN / OSM_DEV_ACCESS_TOKEN, mode 0600);
// it is never printed. Scopes: read_prefs (to say who is signed in) and write_api.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverOf, readEnv, writeEnv, REDIRECT, SCOPES, UA, api, SERVERS } from './common.mjs';

const argv = process.argv.slice(2);
const server = serverOf(argv);
const which = server === SERVERS.dev ? 'dev' : 'live';
const stateFile = path.join(os.homedir(), `.config/mapng/osm_login_${which}.json`);
const clientId = readEnv(server.id); const secret = readEnv(server.secret);
if (!clientId) { console.error(`no ${server.id} in ~/.config/mapng/mapng.env`); process.exit(2); }
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const ci = argv.indexOf('--code');
if (ci < 0) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  fs.writeFileSync(stateFile, JSON.stringify({ verifier, state }), { mode: 0o600 });
  const u = new URL(`${server.web}/oauth2/authorize`);
  u.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  console.log(`Open this link, sign in as the account the edits should be made by, and approve:\n\n${u}\n`);
  console.log(`OSM then shows a code. Run:\n  node scripts/osm/login.mjs${which === 'dev' ? ' --dev' : ''} --code <the code>`);
} else {
  const code = argv[ci + 1];
  if (!code) { console.error('--code needs the code OSM showed'); process.exit(2); }
  const { verifier } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, ...(secret ? { client_secret: secret } : {}) });
  const r = await fetch(`${server.web}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { console.error(`token exchange failed: HTTP ${r.status} ${d.error || ''} ${d.error_description || ''}`); process.exit(1); }
  writeEnv(server.token, d.access_token);
  fs.rmSync(stateFile, { force: true });
  const me = await api(server, 'GET', '/user/details.json');
  console.log(`Signed in to the ${which} server as ${me.user?.display_name} (id ${me.user?.id}); token saved to ~/.config/mapng/mapng.env (${server.token}).`);
}
