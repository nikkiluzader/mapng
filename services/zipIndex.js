// A zip's table of contents read from its end (the central directory), not
// the whole file: "Check level" looks a finished level over in a moment
// whatever its size. read(offset, length) → Promise<Uint8Array> (a Blob's
// slice in the page, a file descriptor's read on the desktop). ZIP64 too
// (the export writes it for big levels). Returns [{ name, size }], or null
// when it isn't a readable zip.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

export async function zipIndex(read, fileSize) {
  if (!(fileSize >= 22)) return null;
  const tailLen = Math.min(fileSize, 65557);
  const tail = await read(fileSize - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  let count = u16(tail, e + 10);
  let cdSize = u32(tail, e + 12);
  let cdOffset = u32(tail, e + 16);
  // (ZIP64: the locator just before the end record points at the 64-bit one)
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && e >= 20 && u32(tail, e - 20) === 0x07064b50) {
    const at = u64(tail, e - 20 + 8);
    const rec = await read(at, 56);
    if (u32(rec, 0) !== 0x06064b50) return null;
    count = u64(rec, 32); cdSize = u64(rec, 40); cdOffset = u64(rec, 48);
  }
  if (cdOffset + cdSize > fileSize) return null;
  const cd = await read(cdOffset, cdSize);
  const out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (u32(cd, p) !== 0x02014b50) return null;
    const nameLen = u16(cd, p + 28); const extraLen = u16(cd, p + 30); const commentLen = u16(cd, p + 32);
    let size = u32(cd, p + 24);
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    if (size === 0xffffffff) {
      for (let q = 0; q + 4 <= extra.length;) {
        const id = u16(extra, q); const len = u16(extra, q + 2);
        if (id === 0x0001 && len >= 8) { size = u64(extra, q + 4); break; }
        q += 4 + len;
      }
    }
    out.push({ name: new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen)), size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The index of a Blob (a level zip in the page). */
export const zipIndexOfBlob = (blob) => zipIndex(async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()), blob.size);

/**
 * What a finished level zip must hold: problems found (empty: fine). entries:
 * zipIndex's list; levelName: the level's folder.
 */
export function levelZipProblems(entries, levelName = null) {
  if (!entries) return ['the file is not a readable zip'];
  const names = new Set(entries.map((e) => e.name));
  // (the level's folder: the one given, else the zip's only one)
  if (!levelName) {
    const found = [...names].map((n) => n.match(/^levels\/([^/]+)\/info\.json$/)?.[1]).filter(Boolean);
    if (found.length !== 1) return [found.length ? 'the zip holds more than one level' : 'no level in the zip'];
    levelName = found[0];
  }
  const base = `levels/${levelName}`;
  const problems = [];
  for (const need of ['info.json', 'main/MissionGroup/items.level.json', 'art/terrains/terrain.ter', 'mapng.json']) {
    if (!names.has(`${base}/${need}`)) problems.push(`${base}/${need} is missing`);
  }
  const ter = entries.find((e) => e.name === `${base}/art/terrains/terrain.ter`);
  if (ter && !(ter.size > 5)) problems.push('the terrain file is empty');
  return problems;
}
