// worker/admin.js: the Cloudflare Access token check in front of the developer's dashboard
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminIdentity, CF_SECTIONS, cleanState, cloudflareStats, verifyAccessToken } from '../worker/admin.js';

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'aud-of-the-admin-app';
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (o) => b64url(Buffer.from(JSON.stringify(o)));

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { pair, jwk };
}
async function sign(key, kid, payload, header = {}) {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT', ...header }); const body = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
const soon = () => Math.floor(Date.now() / 1000) + 600;
const payloadOf = (more = {}) => ({ aud: [AUD], iss: `https://${TEAM}`, exp: soon(), email: 'dev@example.com', ...more });

test('a valid Access token is accepted; anything else is not', async () => {
  const k = await makeKey('k1'); const other = await makeKey('k1');
  const opts = { teamDomain: TEAM, aud: AUD, keys: [k.jwk] };
  assert.equal((await verifyAccessToken(await sign(k, 'k1', payloadOf()), opts)).email, 'dev@example.com');
  // signed by another key with the same id
  assert.equal(await verifyAccessToken(await sign(other, 'k1', payloadOf()), opts), null);
  // for another application, from another team, expired, not yet valid
  assert.equal(await verifyAccessToken(await sign(k, 'k1', payloadOf({ aud: ['something-else'] })), opts), null);
  assert.equal(await verifyAccessToken(await sign(k, 'k1', payloadOf({ iss: 'https://evil.cloudflareaccess.com' })), opts), null);
  assert.equal(await verifyAccessToken(await sign(k, 'k1', payloadOf({ exp: Math.floor(Date.now() / 1000) - 3600 })), opts), null);
  assert.equal(await verifyAccessToken(await sign(k, 'k1', payloadOf({ nbf: Math.floor(Date.now() / 1000) + 3600 })), opts), null);
  // an unknown key id, no algorithm ("none"), a changed payload, rubbish
  assert.equal(await verifyAccessToken(await sign(k, 'k2', payloadOf()), opts), null);
  const none = `${enc({ alg: 'none', kid: 'k1' })}.${enc(payloadOf())}.`;
  assert.equal(await verifyAccessToken(none, opts), null);
  const good = await sign(k, 'k1', payloadOf());
  const [h, , s] = good.split('.');
  assert.equal(await verifyAccessToken(`${h}.${enc(payloadOf({ email: 'someone@else.com' }))}.${s}`, opts), null);
  for (const junk of ['', 'a.b', 'a.b.c', null, undefined]) assert.equal(await verifyAccessToken(junk, opts), null);
});

test('only the developer\'s own address gets in, and nothing is open until it is set up', async () => {
  const k = await makeKey('k9');
  const fetchKeys = async () => new Response(JSON.stringify({ keys: [k.jwk] }), { status: 200 });
  const req = (token) => new Request('https://mapng.com/api/admin/me', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });
  const env = { ACCESS_TEAM_DOMAIN: 'team9.cloudflareaccess.com', ACCESS_AUD: AUD, CRASH_MAIL_TO: 'Dev@Example.com' };
  const tok = (more) => sign(k, 'k9', payloadOf({ iss: 'https://team9.cloudflareaccess.com', ...more }));
  assert.deepEqual(await adminIdentity(req(await tok()), env, fetchKeys), { email: 'dev@example.com', reason: '' });
  assert.equal((await adminIdentity(req(await tok({ email: 'visitor@example.com' })), env, fetchKeys)).reason, 'not-owner');
  assert.equal((await adminIdentity(req(await tok({ email: '' })), env, fetchKeys)).reason, 'not-owner');
  assert.equal((await adminIdentity(req(null), env, fetchKeys)).reason, 'no-token');
  assert.equal((await adminIdentity(req('x.y.z'), env, fetchKeys)).reason, 'bad-token');
  for (const missing of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'CRASH_MAIL_TO']) {
    const e = { ...env }; delete e[missing];
    assert.deepEqual(await adminIdentity(req(await tok()), e, fetchKeys), { email: null, reason: 'not-set-up' });
  }
});

test('a report\'s admin state is a flag and a short note, nothing else', () => {
  assert.deepEqual(cleanState({ handled: true, note: 'fixed in cab1f87', extra: 1 }), { handled: true, note: 'fixed in cab1f87' });
  assert.deepEqual(cleanState({ note: 'x'.repeat(5000) }).note.length, 2000);
  assert.equal(cleanState({ handled: 'yes' }), null);
  assert.equal(cleanState(null), null);
});

test('Cloudflare stats: each section stands alone, and nothing is asked without a token', async () => {
  let calls = 0;
  assert.deepEqual(await cloudflareStats({}, async () => { calls++; }), { error: 'not-set-up' });
  assert.equal(calls, 0);
  const seen = [];
  const fetchFn = async (url, init) => {
    if (String(url).includes('/rulesets/')) return new Response(JSON.stringify({ success: true, result: { rules: [{ description: 'Dev machine pass', action: 'skip', enabled: true, expression: '(http.request.headers["x-secret"][0] eq "VALUE")' }] } }));
    const body = JSON.parse(init.body); seen.push({ url, auth: init.headers.Authorization, vars: body.variables });
    if (body.query.includes('userAgent')) return new Response(JSON.stringify({ data: null, errors: [{ message: 'unknown field userAgent' }] }));
    return new Response(JSON.stringify({ data: { viewer: { zones: [{ rows: [{ count: 3 }] }] } } }));
  };
  const out = await cloudflareStats({ CF_ANALYTICS_TOKEN: 'tok', CF_ZONE_ID: 'zone1' }, fetchFn, Date.UTC(2026, 10, 12, 12));
  assert.equal(seen.length, Object.keys(CF_SECTIONS).length);
  assert.ok(seen.every((c) => c.url === 'https://api.cloudflare.com/client/v4/graphql' && c.auth === 'Bearer tok' && c.vars.z === 'zone1'));
  assert.deepEqual(out.sections.traffic, { rows: [{ count: 3 }] });
  // the rules by name and switch only: an expression can hold a private value
  assert.deepEqual(out.rules, { rows: [{ name: 'Dev machine pass', action: 'skip', enabled: true }] });
  assert.ok(!JSON.stringify(out).includes('VALUE'));
  assert.deepEqual(out.sections.securityByAgent, { error: 'unknown field userAgent' });
  // the windows asked for: 14 days and the last 24 hours
  assert.deepEqual(seen.find((c) => c.vars.d0).vars, { z: 'zone1', d0: '2026-10-30', d1: '2026-11-12' });
  assert.deepEqual(seen.find((c) => c.vars.t0).vars, { z: 'zone1', t0: '2026-11-11T12:00:00Z', t1: '2026-11-12T12:00:00Z' });
});
