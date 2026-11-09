// The export's step cache on disk (services/stepCache.js), for the desktop
// app's export runner: each export runs in a new process, so a step's result
// kept for the next export is written under dir/<key>/ (value.json, its Blobs
// and byte arrays as files beside it). The app trims the folder by last use
// (desktop/main.js trimStepCache).
import fs from 'node:fs';
import path from 'node:path';

export function diskStepCache(dir) {
  const safe = (key) => /^[\w-]{1,80}$/.test(key);
  return {
    async get(key) {
      if (!safe(key)) return null;
      const at = path.join(dir, key);
      const file = path.join(at, 'value.json');
      if (!fs.existsSync(file)) return null;
      const revive = (v) => {
        if (Array.isArray(v)) return v.map(revive);
        if (v && typeof v === 'object') {
          if (v.$blob) return new Blob([fs.readFileSync(path.join(at, v.$blob))], { type: v.type || '' });
          if (v.$bytes) { const b = fs.readFileSync(path.join(at, v.$bytes)); const C = globalThis[v.kind] || Uint8Array; return new C(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
        }
        return v;
      };
      const value = revive(JSON.parse(fs.readFileSync(file, 'utf8')));
      // (recently used: the app trims by this)
      try { const now = new Date(); fs.utimesSync(at, now, now); } catch { /* read-only */ }
      return value;
    },
    async set(key, value) {
      if (!safe(key)) return;
      const at = path.join(dir, key);
      const tmp = `${at}.partial-${process.pid}`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      let n = 0;
      const pack = async (v) => {
        if (typeof Blob !== 'undefined' && v instanceof Blob) { const name = `f${++n}.bin`; fs.writeFileSync(path.join(tmp, name), Buffer.from(await v.arrayBuffer())); return { $blob: name, type: v.type }; }
        if (ArrayBuffer.isView(v)) { const name = `f${++n}.bin`; fs.writeFileSync(path.join(tmp, name), Buffer.from(v.buffer, v.byteOffset, v.byteLength)); return { $bytes: name, kind: v.constructor.name }; }
        if (v instanceof ArrayBuffer) { const name = `f${++n}.bin`; fs.writeFileSync(path.join(tmp, name), Buffer.from(v)); return { $bytes: name, kind: 'Uint8Array' }; }
        if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await pack(x)); return out; }
        if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) { if (typeof x !== 'function') out[k] = await pack(x); } return out; }
        return v;
      };
      fs.writeFileSync(path.join(tmp, 'value.json'), JSON.stringify(await pack(value)));
      fs.rmSync(at, { recursive: true, force: true });
      fs.renameSync(tmp, at);
    },
  };
}
