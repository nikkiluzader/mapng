// The planet archives as the app reads them, without the site: by byte range from the R2 bucket
// (keys in ~/.config/mapng/mapng.env), or from local files. For the comparison and sweep tools.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { planetManifest } from './planetManifest.mjs';

export const env = Object.fromEntries(fs.readFileSync(path.join(process.env.HOME, '.config/mapng/mapng.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
export const stats = { requests: 0, bytes: 0 };

/** { manifest, sourceFor }: pass both to services/osmTiles.js setOsmTileManifest. localDir: read files there instead of the bucket. */
export function planetSource({ localDir = null, snapshot = process.env.SNAPSHOT || '2026-11-02' } = {}) {
  const realFetch = globalThis.fetch;
  const host = new URL(env.R2_ENDPOINT).host; const bucket = env.R2_BUCKET || 'mapng-osm';
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest(); const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
  async function s3Range(key, offset, length) {
    const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''); const day = now.slice(0, 8); const pathname = `/${bucket}/${key}`;
    const range = `bytes=${offset}-${offset + length - 1}`;
    const canonical = ['GET', pathname, '', `host:${host}\nrange:${range}\nx-amz-content-sha256:${sha('')}\nx-amz-date:${now}\n`, 'host;range;x-amz-content-sha256;x-amz-date', sha('')].join('\n');
    const scope = `${day}/auto/s3/aws4_request`;
    const key4 = hmac(hmac(hmac(hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, day), 'auto'), 's3'), 'aws4_request');
    const sig = crypto.createHmac('sha256', key4).update(['AWS4-HMAC-SHA256', now, scope, sha(canonical)].join('\n')).digest('hex');
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await realFetch(`https://${host}${pathname}`, { headers: { Range: range, 'x-amz-date': now, 'x-amz-content-sha256': sha(''), Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${sig}` } });
        if (r.status !== 206 && r.status !== 200) throw new Error(`${key}: ${r.status}`);
        return await r.arrayBuffer();
      } catch (e) { if (attempt >= 3) throw e; await new Promise((res) => setTimeout(res, 500 * attempt)); }
    }
  }
  const sourceFor = (key) => ({
    getKey: () => key,
    getBytes: async (offset, length) => {
      stats.requests++; stats.bytes += length;
      if (localDir) { const fd = fs.openSync(path.join(localDir, path.basename(key)), 'r'); const buf = Buffer.alloc(length); const n = fs.readSync(fd, buf, 0, length, offset); fs.closeSync(fd); return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }; }
      return { data: await s3Range(key, offset, length) };
    },
  });
  const names = localDir ? fs.readdirSync(localDir) : JSON.parse(fs.readFileSync(new URL('./planet-archives.json', import.meta.url), 'utf8')).names;
  return { manifest: planetManifest(names, { snapshot }), sourceFor };
}
