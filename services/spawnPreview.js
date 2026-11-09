// The preview photo of each spawn and quicktravel point (services/spawnPoints.js):
// the export's own base texture (terrain.png: satellite, game texture ...)
// around the point, turned so its heading points up, with an arrow on it.
// 800×600 JPEG, as every official level's spawn previews are.
//
// 2D canvas only, so it runs in the browser and in the desktop app's export
// runner (desktop/runner/browserShims.mjs: a real canvas, no WebGL), and it
// downloads nothing. Any failure gives no image: the point then shows the
// level's preview.png instead.

export const PREVIEW_W = 800;
export const PREVIEW_H = 600;
// metres across the photo (and down it: 120 m)
const PREVIEW_ACROSS_M = 160;
const BACKGROUND = '#2a2d33';

/**
 * Render the crops. texture: the base texture as a Blob (north up, covering
 * the whole terrain square, worldSize metres a side). previews: [{ file, x,
 * y, heading }] in level coordinates (x east, y north from the centre).
 * roads: optional carriageways ({ nodes, half }) drawn over a plain texture
 * (baseTexture 'none'), where the texture alone would show nothing.
 * Returns [{ file, blob }] for those that worked.
 */
export async function renderSpawnPreviews(texture, previews, { worldSize, roads = null, quality = 0.85 } = {}) {
  if (!previews?.length || !(worldSize > 0) || typeof document === 'undefined') return [];
  let bmp = null;
  try {
    bmp = texture ? await createImageBitmap(texture) : null;
  } catch { bmp = null; }
  const out = [];
  try {
    for (const p of previews) {
      try {
        const blob = await renderOne(bmp, p, { worldSize, roads, quality });
        if (blob && (blob.size ?? blob.byteLength ?? 0) > 100) out.push({ file: p.file, blob });
      } catch (error) {
        console.warn('[Spawn points] preview failed:', p.file, error?.message || error);
      }
    }
  } finally {
    bmp?.close?.();
  }
  return out;
}

async function renderOne(bmp, p, { worldSize, roads, quality }) {
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.rotate !== 'function' || typeof ctx.setTransform !== 'function') return null;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  const pxPerM = PREVIEW_W / PREVIEW_ACROSS_M;
  const heading = (Number(p.heading) || 0) * Math.PI / 180;
  // the photo's centre on the point, the heading up: the map turned the other way
  ctx.save();
  ctx.translate(PREVIEW_W / 2, PREVIEW_H / 2);
  ctx.rotate(-heading);
  if (bmp) {
    const texPerM = bmp.width / worldSize;
    // (the texture's pixel under the point; only the square round it that the
    // turned photo can show is drawn: the half diagonal, 100 m)
    const u = (p.x / worldSize + 0.5) * bmp.width;
    const v = (0.5 - p.y / worldSize) * bmp.height;
    const r = Math.hypot(PREVIEW_W, PREVIEW_H) / 2 / pxPerM * texPerM + 2;
    const sx = Math.max(0, Math.floor(u - r)); const sy = Math.max(0, Math.floor(v - r));
    const ex = Math.min(bmp.width, Math.ceil(u + r)); const ey = Math.min(bmp.height, Math.ceil(v + r));
    if (ex > sx && ey > sy) {
      const k = pxPerM / texPerM;
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, sx, sy, ex - sx, ey - sy, (sx - u) * k, (sy - v) * k, (ex - sx) * k, (ey - sy) * k);
    }
  }
  if (roads?.length) {
    // level y runs north, canvas y down
    ctx.strokeStyle = 'rgba(70, 72, 78, 0.95)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const reach = PREVIEW_ACROSS_M;
    for (const cw of roads) {
      const n = cw?.nodes;
      if (!Array.isArray(n) || n.length < 2) continue;
      if (!n.some((q) => Math.abs(q[0] - p.x) < reach && Math.abs(q[1] - p.y) < reach)) continue;
      ctx.lineWidth = Math.max(2, 2 * (Number(cw.half) || 3) * pxPerM);
      ctx.beginPath();
      n.forEach((q, i) => {
        const cx = (q[0] - p.x) * pxPerM; const cy = -(q[1] - p.y) * pxPerM;
        if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
  drawArrow(ctx);
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b || null), 'image/jpeg', quality); } catch { resolve(null); }
  });
}

// the car's place and heading: an orange arrow pointing up from the centre
function drawArrow(ctx) {
  const cx = PREVIEW_W / 2; const cy = PREVIEW_H / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.lineTo(20, 14);
  ctx.lineTo(0, 4);
  ctx.lineTo(-20, 14);
  ctx.closePath();
  ctx.fillStyle = '#FF6600';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
