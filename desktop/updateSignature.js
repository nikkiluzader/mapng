// Is an update really MapNG's? (desktop/updater.js asks before it downloads one.)
//
// The updater's own check is that the installer matches the checksum in the
// release's latest.yml (and, on Windows, that its publisher is the same), and
// both files sit on the same GitHub release: whoever could replace one could
// replace the other. So every release's latest*.yml is signed when it is built
// (.github/workflows/desktop-release.yml, desktop/scripts/signManifest.mjs)
// with a key that is not in the repository, and the app refuses an update
// whose latest.yml does not carry a good signature or does not name the very
// file the updater is about to fetch.
//
// No Electron here, so tests can load it.
import crypto from 'node:crypto';

// Ed25519 public keys (SPKI, base64) an update may be signed with. A second
// one can be added before the first is retired: an install trusts only the
// keys it shipped with.
export const UPDATE_KEYS = [
  'MCowBQYDK2VwAyEAmU7HPDByOnQ8L2VbRTKzU5GMmcfY/Ek/B2oQTX57ozo=',
];

/** True when `signatureB64` is a good signature of `bytes` by one of `keys`. */
export function signedByMapng(bytes, signatureB64, keys = UPDATE_KEYS) {
  let signature;
  try { signature = Buffer.from(String(signatureB64 || '').trim(), 'base64'); } catch { return false; }
  if (signature.length !== 64) return false;
  for (const key of keys) {
    try {
      const publicKey = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
      if (crypto.verify(null, Buffer.from(bytes), publicKey, signature)) return true;
    } catch { /* not a key: the next one */ }
  }
  return false;
}

/**
 * True when the signed latest.yml is about this very update: the same version, and every file
 * the updater was told of is in it with the same checksum (the updater checks the download
 * against that checksum itself).
 */
export function manifestNames(ymlText, info) {
  const text = String(ymlText || '');
  const version = /^version:\s*['"]?([^\s'"]+)['"]?\s*$/m.exec(text)?.[1];
  if (!version || version !== String(info?.version || '')) return false;
  const files = Array.isArray(info?.files) ? info.files : [];
  if (!files.length) return false;
  const sums = new Set([...text.matchAll(/sha512:\s*['"]?([A-Za-z0-9+/=]{80,})['"]?/g)].map((m) => m[1]));
  return files.every((f) => typeof f?.sha512 === 'string' && sums.has(f.sha512));
}

/** The release file the updater reads on this system. */
export const manifestName = (platform = process.platform) => (platform === 'linux' ? 'latest-linux.yml' : platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml');

/**
 * Fetch the release's latest.yml and its signature and check them against `info` (what the
 * updater found): { ok: true } or { ok: false, why }. fetchImpl: (url) => Response.
 */
export async function verifyUpdate(info, fetchImpl, { platform = process.platform, keys = UPDATE_KEYS, repo = 'nikkiluzader/mapng', allowTestBuilds = true } = {}) {
  try {
    const version = String(info?.version || '');
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) return { ok: false, why: 'version' };
    // (one key signs releases and test builds alike: a test build marked as the latest release on GitHub is
    // still a test build, and goes only to an install with Help > Get Test Builds on)
    if (version.includes('-') && !allowTestBuilds) return { ok: false, why: 'a test build, and test builds are off' };
    const base = `https://github.com/${repo}/releases/download/v${version}/${manifestName(platform)}`;
    const [yml, sig] = await Promise.all([fetchImpl(base), fetchImpl(`${base}.sig`)]);
    if (!yml.ok) return { ok: false, why: `manifest ${yml.status}` };
    if (!sig.ok) return { ok: false, why: `signature ${sig.status}` };
    const bytes = Buffer.from(await yml.arrayBuffer());
    if (!signedByMapng(bytes, await sig.text(), keys)) return { ok: false, why: 'signature does not match' };
    if (!manifestNames(bytes.toString('utf8'), info)) return { ok: false, why: 'manifest is of another build' };
    return { ok: true };
  } catch (error) {
    return { ok: false, why: String(error?.message || error).slice(0, 120) };
  }
}
