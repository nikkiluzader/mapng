// The terrain heights the exporter and its worker threads look up: a
// geographic point to level coordinates on the ground, and the ground as
// the game draws it. Pure functions of terrainData { bounds, width, height,
// heightMap, minHeight } (the heightmap may be a SharedArrayBuffer's view).

export function getTerrainHeightWorld(lat, lng, terrainData) {
  const { bounds, width, height, heightMap, minHeight } = terrainData;
  const sanitizeHeight = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));
  const fx = u * (width - 1);
  const fy = v * (height - 1);
  const c0 = Math.min(width - 1, Math.floor(fx));
  const c1 = Math.min(width - 1, c0 + 1);
  const r0 = Math.min(height - 1, Math.floor(fy));
  const r1 = Math.min(height - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const h00 = sanitizeHeight(heightMap[r0 * width + c0]);
  const h10 = sanitizeHeight(heightMap[r0 * width + c1]);
  const h01 = sanitizeHeight(heightMap[r1 * width + c0]);
  const h11 = sanitizeHeight(heightMap[r1 * width + c1]);
  return (h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty) - minHeight;
}

/**
 * The ground as the game draws it at world (x, y): the heightmap sampled on
 * the terrain's own grid (samples squareSize apart from minus half its
 * extent, rows from the south). The (W - 1)-span lookups drift up to a
 * square from it across the map, centimetres of height on a slope: the
 * fields and pool decks that lie on the ground use this one.
 */
export function terrainGroundAt(terrainData, squareSize) {
  const { width, height, heightMap, minHeight } = terrainData;
  const ok = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  return (x, y) => {
    const fx = Math.max(0, Math.min(width - 1.001, x / squareSize + width / 2));
    const fj = Math.max(0, Math.min(height - 1.001, y / squareSize + height / 2));
    const fy = height - 1 - fj;
    const c0 = Math.floor(fx); const r0 = Math.floor(fy); const c1 = Math.min(width - 1, c0 + 1); const r1 = Math.min(height - 1, r0 + 1);
    const tx = fx - c0; const ty = fy - r0;
    return ok(heightMap[r0 * width + c0]) * (1 - tx) * (1 - ty) + ok(heightMap[r0 * width + c1]) * tx * (1 - ty)
      + ok(heightMap[r1 * width + c0]) * (1 - tx) * ty + ok(heightMap[r1 * width + c1]) * tx * ty - minHeight;
  };
}

/**
 * The drawn terrain's height at world (x, y), at or just over it: the higher
 * of the two triangles a terrain square may be split into (both agree on its
 * edges). A mesh draped on this, cut along the terrain's squares, lies on the
 * ground however the engine splits them. Also returns the grid: { sq, ox, oy }
 * (sample i at ox + i * sq).
 */
export function terrainDrape(terrainData, squareSize) {
  const { width, height, heightMap, minHeight } = terrainData;
  const ok = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  const at = (c, r) => ok(heightMap[Math.max(0, Math.min(height - 1, r)) * width + Math.max(0, Math.min(width - 1, c))]) - minHeight;
  const drapeAt = (x, y) => {
    const fx = Math.max(0, Math.min(width - 1.0001, x / squareSize + width / 2));
    const fj = Math.max(0, Math.min(height - 1.0001, y / squareSize + height / 2));
    const i = Math.floor(fx); const j = Math.floor(fj); const u = fx - i; const v = fj - j;
    // corners by (i, j) from the south-west; heightmap rows from the north
    const h00 = at(i, height - 1 - j); const h10 = at(i + 1, height - 1 - j); const h01 = at(i, height - 2 - j); const h11 = at(i + 1, height - 2 - j);
    const a = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    const b = u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
    return Math.max(a, b);
  };
  return { drapeAt, grid: { sq: squareSize, ox: -(width / 2) * squareSize, oy: -(height / 2) * squareSize } };
}

export function geoToWorldPoint(lat, lng, terrainData, squareSize, zOffset = 0) {
  const { bounds, width } = terrainData;
  const worldSize = width * squareSize;
  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));
  return [
    (u - 0.5) * worldSize,
    (0.5 - v) * worldSize,
    getTerrainHeightWorld(lat, lng, terrainData) + zOffset,
  ];
}
