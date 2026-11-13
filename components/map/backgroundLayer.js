// Background areas on the 2D map (Leaflet, imperative): the shading as a canvas over the
// export square, the drawn lines (open ones dashed red with an X), the kept roads, and the
// mouse tools. Rules and raster: services/backgroundMask.js; state:
// composables/useBackgroundEditor.js; tools: components/controls/BackgroundAreas.vue.
import L from 'leaflet';
import { rasterizeMask, rasterizeRaw, makeProjector, snapLineEnds, openLines, roadLines, closesOnlySliver, MIN_AREA_CELLS_ACROSS } from '../../services/backgroundMask.js';

const N = 512;          // editor raster (cells across the square)
const SNAP_PX = 14;     // line ends this close (screen px) to an edge or a line snap shut
const ERASE_PX = 10;

// A canvas stretched over a lat/lng box, redrawn by the caller.
const CanvasBox = L.Layer.extend({
  initialize(bounds) { this._bounds = bounds; },
  onAdd(map) {
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide mapng-bg-canvas');
    this._canvas.width = this._canvas.height = N;
    Object.assign(this._canvas.style, { position: 'absolute', pointerEvents: 'none' });
    map.getPane('mapngBackground').appendChild(this._canvas);
    map.on('zoomend viewreset moveend resize', this._reset, this);
    this._reset();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('zoomend viewreset moveend resize', this._reset, this);
  },
  setBounds(b) { this._bounds = b; if (this._map) this._reset(); },
  _reset() {
    const b = this._bounds; if (!b || !this._map) return;
    const nw = this._map.latLngToLayerPoint([b.north, b.west]);
    const se = this._map.latLngToLayerPoint([b.south, b.east]);
    L.DomUtil.setPosition(this._canvas, nw);
    this._canvas.style.width = `${se.x - nw.x}px`;
    this._canvas.style.height = `${se.y - nw.y}px`;
  },
  context() { return this._canvas.getContext('2d'); },
});

export function attachBackgroundLayer(map, opts) {
  const { getMask, getTool, getSelectionBounds, getMetersAcross, getRoadChoices, getUnmask, isActive, edit, setHint, t } = opts;
  if (!map.getPane('mapngBackground')) {
    map.createPane('mapngBackground').style.zIndex = '380';
    map.getPane('mapngBackground').style.pointerEvents = 'none';
  }
  const canvas = new CanvasBox(null);
  const lines = L.layerGroup();
  const roads = L.layerGroup();
  let drawingLine = null, drawingPts = null;
  let raster = null, rawRaster = null, hoverRegion = -1, shown = false, space = false;
  let draft = null;         // the Unmask stroke being drawn: { shape, keep, pts, layer }
  let brushRing = null;     // the brush's outline under the mouse

  const bounds = () => getMask()?.bounds || getSelectionBounds();
  const proj = () => { const b = bounds(); return b ? makeProjector(b, N) : null; };
  const boxPx = () => {
    const b = bounds(); if (!b) return 1;
    return Math.max(1, map.latLngToContainerPoint([b.north, b.east]).x - map.latLngToContainerPoint([b.north, b.west]).x);
  };

  function paint() {
    if (!raster || !shown) return;
    const ctx = canvas.context();
    const img = ctx.createImageData(N, N), d = img.data;
    const closable = raster.count > 1 && getTool() === 'bucket';
    for (let i = 0; i < N * N; i++) {
      const o = i * 4;
      if (raster.bg[i]) {
        const x = i % N, y = (i / N) | 0, stripe = (x + y) % 9 < 2;
        d[o] = stripe ? 150 : 17; d[o + 1] = stripe ? 155 : 20; d[o + 2] = stripe ? 170 : 28; d[o + 3] = stripe ? 110 : 150;
      } else if (rawRaster?.[i]) {
        // No smoothing: violet, striped the other way
        const x = i % N, y = (i / N) | 0, stripe = (x - y + N * 9) % 9 < 2;
        d[o] = 168; d[o + 1] = 85; d[o + 2] = 247; d[o + 3] = stripe ? 120 : 55;
      } else if (closable && raster.labels[i] >= 0) {
        const hv = raster.labels[i] === hoverRegion;
        d[o] = 59; d[o + 1] = 130; d[o + 2] = 246; d[o + 3] = hv ? 90 : 28;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawLines() {
    lines.clearLayers();
    const m = getMask(); if (!m) return;
    (m.lines || []).forEach((pts, i) => {
      const open = raster?.open?.[i];
      L.polyline(pts, { pane: 'mapngBackground', color: open ? '#f87171' : '#ff6600', weight: 3, dashArray: open ? '6 6' : null, interactive: false }).addTo(lines);
      if (open) {
        const mid = pts[(pts.length / 2) | 0];
        L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'mapng-bg-x', html: '<span>✕</span>', iconSize: [18, 18] }) }).addTo(lines);
      }
    });
  }

  function drawRoads() {
    roads.clearLayers();
    const m = getMask(); if (!m) return;
    const kept = new Set((m.roads || []).map((r) => r.id));
    if (getTool() === 'road') {
      for (const r of getRoadChoices() || []) {
        if (kept.has(r.id)) continue;
        const pl = L.polyline(roadLines(r), { color: '#fde68a', weight: 5, opacity: 0.55, bubblingMouseEvents: false });
        pl.on('mouseover', () => { pl.setStyle({ opacity: 1, weight: 7 }); setHint(t('backgroundAreas.hintKeep', { name: r.name })); });
        pl.on('mouseout', () => pl.setStyle({ opacity: 0.55, weight: 5 }));
        pl.on('click', (e) => { L.DomEvent.stop(e); toggleRoad(r); });
        pl.addTo(roads);
      }
    }
    for (const r of m.roads || []) {
      const pl = L.polyline(roadLines(r), { color: '#facc15', weight: 6, opacity: 0.95, interactive: getTool() === 'road', bubblingMouseEvents: false });
      if (getTool() === 'road') {
        pl.on('mouseover', () => setHint(t('backgroundAreas.hintUnkeep', { name: r.name })));
        pl.on('click', (e) => { L.DomEvent.stop(e); toggleRoad(r); });
      }
      pl.addTo(roads);
    }
  }

  function toggleRoad(r) {
    const has = (getMask()?.roads || []).some((k) => k.id === r.id);
    edit((m) => {
      m.roads = has ? m.roads.filter((k) => k.id !== r.id) : [...(m.roads || []), { id: r.id, name: r.name, lines: roadLines(r) }];
      return m;
    }, { bounds: bounds() });
    setHint(has ? t('backgroundAreas.hintRoadOff', { name: r.name }) : t('backgroundAreas.hintRoadOn', { name: r.name, width: getMask()?.widthM || 300 }));
  }

  function update() {
    const active = isActive();
    if (active !== shown) {
      shown = active;
      if (active) { canvas.addTo(map); lines.addTo(map); roads.addTo(map); } else { canvas.remove(); lines.remove(); roads.remove(); brushRing?.remove(); brushRing = null; }
    }
    if (!active) { applyTool(); return; }
    const m = getMask();
    const b = bounds();
    canvas.setBounds(b);
    raster = m?.bounds ? rasterizeMask(m, N, { metersAcross: getMetersAcross() }) : null;
    rawRaster = m?.bounds && m.raw?.length ? rasterizeRaw(m, N, { metersAcross: getMetersAcross() }) : null;
    if (!raster) { const ctx = canvas.context(); ctx.clearRect(0, 0, N, N); }
    paint(); drawLines(); drawRoads(); applyTool();
  }

  // --- the mouse ---
  const toCell = (latlng) => proj()?.toCell([latlng.lat, latlng.lng]);
  function applyTool() {
    const tool = shown ? getTool() : 'pan';
    const drawingTool = tool !== 'pan' && !space;
    if (drawingTool) map.dragging.disable(); else map.dragging.enable();
    // (Shift paints background with Unmask: not Leaflet's shift-drag box zoom)
    const painting = tool === 'unmask' || tool === 'raw';
    if (painting) map.boxZoom.disable(); else map.boxZoom.enable();
    map.getContainer().style.cursor = drawingTool ? (tool === 'erase' ? 'pointer' : 'crosshair') : '';
    if (!painting || space || getUnmask().shape !== 'brush') { brushRing?.remove(); brushRing = null; }
  }

  // --- Unmask: brush strokes and shapes, kept (green) or background (dark) ---
  const pxPerM = () => boxPx() / Math.max(1, getMetersAcross() || ((bounds()?.north - bounds()?.south) * 111320) || 1);
  // (No smoothing strokes: violet, or grey for "smooth again")
  const strokeStyle = (keep, raw) => {
    const c = raw ? (keep ? '#a855f7' : '#94a3b8') : (keep ? '#22c55e' : '#1e293b');
    return { pane: 'mapngBackground', color: c, fillColor: c, interactive: false };
  };
  function startDraft(e) {
    const u = getUnmask();
    const raw = getTool() === 'raw';
    const keep = raw ? !(u.smoothAgain || e.originalEvent.shiftKey) : !(u.background || e.originalEvent.shiftKey);
    const st = strokeStyle(keep, raw);
    let layer;
    if (u.shape === 'brush') layer = L.polyline([e.latlng], { ...st, weight: Math.max(2, 2 * u.brushM * pxPerM()), opacity: 0.45, lineCap: 'round', lineJoin: 'round' });
    else if (u.shape === 'rect') layer = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { ...st, weight: 2, fillOpacity: 0.3 });
    else layer = L.polygon([e.latlng], { ...st, weight: 2, fillOpacity: 0.3 });
    draft = { shape: u.shape, keep, raw, r: u.brushM, pts: [e.latlng], start: e.latlng, layer: layer.addTo(map) };
    window.addEventListener('mouseup', commitDraft, { once: true });
  }
  function moveDraft(e) {
    if (draft.shape === 'rect') { draft.layer.setBounds(L.latLngBounds(draft.start, e.latlng)); draft.end = e.latlng; return; }
    const last = map.latLngToContainerPoint(draft.pts[draft.pts.length - 1]);
    if (last.distanceTo(e.containerPoint) > 3) { draft.pts.push(e.latlng); draft.layer.setLatLngs(draft.pts); }
  }
  function commitDraft() {
    if (!draft) return;
    const d = draft; draft = null;
    d.layer.remove();
    const r7 = (ll) => [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))];
    let op = null;
    if (d.shape === 'brush') op = { keep: d.keep, kind: 'brush', r: d.r, pts: d.pts.map(r7) };
    else if (d.shape === 'rect') {
      if (!d.end || map.latLngToContainerPoint(d.start).distanceTo(map.latLngToContainerPoint(d.end)) < 6) { setHint(t('backgroundAreas.hintRectDrag'), true); return; }
      const a = d.start, b = d.end;
      op = { keep: d.keep, kind: 'poly', pts: [r7(a), r7(L.latLng(a.lat, b.lng)), r7(b), r7(L.latLng(b.lat, a.lng))] };
    } else {
      if (d.pts.length < 3) { setHint(t('backgroundAreas.hintLassoDrag'), true); return; }
      op = { keep: d.keep, kind: 'poly', pts: d.pts.map(r7) };
    }
    if (d.raw) {
      const { keep, ...rest } = op;
      edit((m) => { m.raw = [...(m.raw || []), { on: keep, ...rest }]; return m; }, { bounds: bounds() });
      setHint(keep ? t('backgroundAreas.hintRawOn') : t('backgroundAreas.hintRawOff'));
      return;
    }
    edit((m) => { m.paint = [...(m.paint || []), op]; return m; }, { bounds: bounds() });
    setHint(d.keep ? t('backgroundAreas.hintUnmasked') : t('backgroundAreas.hintMasked'));
  }
  function moveRing(e) {
    const u = getUnmask();
    if ((getTool() !== 'unmask' && getTool() !== 'raw') || space || u.shape !== 'brush') return;
    if (!brushRing) brushRing = L.circle(e.latlng, { radius: u.brushM, pane: 'mapngBackground', color: '#ffffff', weight: 1.5, fill: false, dashArray: '4 4', interactive: false }).addTo(map);
    else { brushRing.setLatLng(e.latlng); brushRing.setRadius(u.brushM); }
  }
  // the topmost Unmask (or No smoothing: list 'raw') stroke under a click (erase), or -1
  function strokeAt(e, list = 'paint') {
    const paint = getMask()?.[list] || [];
    const p = e.containerPoint;
    for (let i = paint.length - 1; i >= 0; i--) {
      const op = paint[i];
      const pts = op.pts.map((q) => map.latLngToContainerPoint(q));
      if (op.kind === 'poly') {
        let inside = false;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          if ((pts[a].y > p.y) !== (pts[b].y > p.y) && p.x < pts[a].x + ((p.y - pts[a].y) / (pts[b].y - pts[a].y)) * (pts[b].x - pts[a].x)) inside = !inside;
        }
        if (inside) return i;
      } else {
        const rpx = Math.max(ERASE_PX, op.r * pxPerM());
        if (pts.some((q) => q.distanceTo(p) <= rpx)) return i;
      }
    }
    return -1;
  }
  function onDown(e) {
    // (no native drag of a label or tile image: it would swallow the mouseup)
    if (shown && !space && (getTool() === 'unmask' || getTool() === 'raw') && e.originalEvent.button === 0) { e.originalEvent.preventDefault(); startDraft(e); return; }
    if (!shown || space || getTool() !== 'line' || e.originalEvent.button !== 0) return;
    e.originalEvent.preventDefault();
    drawingPts = [e.latlng];
    drawingLine = L.polyline(drawingPts, { pane: 'mapngBackground', color: '#ff8955', weight: 3, interactive: false }).addTo(map);
    window.addEventListener('mouseup', onUp, { once: true });
  }
  function onMove(e) {
    if (shown) moveRing(e);
    if (draft) { moveDraft(e); return; }
    if (drawingPts) {
      const last = map.latLngToContainerPoint(drawingPts[drawingPts.length - 1]);
      if (last.distanceTo(e.containerPoint) > 3) { drawingPts.push(e.latlng); drawingLine.setLatLngs(drawingPts); }
      return;
    }
    if (!shown || !raster) return;
    const tool = getTool();
    if (tool === 'bucket') {
      const c = toCell(e.latlng); const xi = Math.floor(c[0]), yi = Math.floor(c[1]);
      const inside = xi >= 0 && yi >= 0 && xi < N && yi < N;
      const l = inside ? raster.labels[yi * N + xi] : -1;
      if (l !== hoverRegion) { hoverRegion = l; paint(); }
      if (inside) {
        const bg = raster.bg[yi * N + xi];
        setHint(bg ? t('backgroundAreas.hintUnshade') : raster.count > 1 ? t('backgroundAreas.hintShade') : t('backgroundAreas.hintNoAreas'), !bg && raster.count < 2);
      }
    }
  }
  function onUp() {
    if (!drawingPts) return;
    const pts = drawingPts; drawingPts = null;
    drawingLine.remove(); drawingLine = null;
    const P = proj(); if (!P || pts.length < 2) return;
    let cells = pts.map((p) => P.toCell([p.lat, p.lng]).map((v) => Math.max(-1, Math.min(N + 1, v))));
    const others = (getMask()?.bounds ? getMask().lines : []).map((l) => l.map(P.toCell));
    cells = snapLineEnds(cells, others, N, Math.max(2, (SNAP_PX * N) / boxPx()));
    const latlngs = cells.map((c) => P.toLatLng(c).map((v) => Number(v.toFixed(7))));
    const open = openLines([...others, cells], N).pop();
    edit((m) => { m.lines = [...(m.lines || []), latlngs]; return m; }, { bounds: bounds() });
    // (closed, but round an area too small for this map's size: said as that)
    if (open && closesOnlySliver([...others, cells], N)) {
      const b = bounds();
      const sideM = b ? Math.abs(b.north - b.south) * 111320 : 0;
      const metres = Math.max(10, Math.round((MIN_AREA_CELLS_ACROSS * sideM) / N / 10) * 10);
      setHint(t('backgroundAreas.hintTooSmall', { metres }), true);
      return;
    }
    setHint(open ? t('backgroundAreas.hintOpen') : t('backgroundAreas.hintClosed'), open);
  }
  function onClick(e) {
    if (!shown) return;
    const tool = getTool();
    if (tool === 'erase') {
      const m = getMask(); if (!m) return;
      let best = -1, bd = ERASE_PX;
      (m.lines || []).forEach((pts, i) => pts.forEach((p) => { const d = map.latLngToContainerPoint(p).distanceTo(e.containerPoint); if (d < bd) { bd = d; best = i; } }));
      if (best >= 0) { edit((mm) => { mm.lines.splice(best, 1); return mm; }); setHint(t('backgroundAreas.hintErased')); return; }
      const r = strokeAt(e, 'raw');
      if (r >= 0) { edit((mm) => { mm.raw.splice(r, 1); return mm; }); setHint(t('backgroundAreas.hintStrokeErased')); return; }
      const s = strokeAt(e);
      if (s >= 0) { edit((mm) => { mm.paint.splice(s, 1); return mm; }); setHint(t('backgroundAreas.hintStrokeErased')); }
      return;
    }
    if (tool !== 'bucket') return;
    const P = proj(); if (!P) return;
    const c = P.toCell([e.latlng.lat, e.latlng.lng]); const xi = Math.floor(c[0]), yi = Math.floor(c[1]);
    if (xi < 0 || yi < 0 || xi >= N || yi >= N) return;
    if (!raster) raster = rasterizeMask({ ...getMask(), bounds: bounds() }, N, { metersAcross: getMetersAcross() });
    const l = raster.labels[yi * N + xi]; if (l < 0) return;
    const at = [Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))];
    const regionOf = (s) => { const q = P.toCell(s); const x = Math.floor(q[0]), y = Math.floor(q[1]); return x >= 0 && y >= 0 && x < N && y < N ? raster.labels[y * N + x] : -1; };
    if (raster.bg[yi * N + xi]) {
      edit((m) => {
        const before = m.shade.length;
        m.shade = m.shade.filter((s) => regionOf(s) !== l);
        if (m.shade.length === before && m.roads?.length) m.unshade = [...(m.unshade || []), at];
        return m;
      });
      setHint(t('backgroundAreas.hintDrivable'));
      return;
    }
    let walls = 0; for (let i = 0; i < raster.walls.length; i++) walls += raster.walls[i];
    if (raster.count < 2 || raster.areas[l] >= N * N - walls - 12) { setHint(t('backgroundAreas.hintWhole'), true); return; }
    edit((m) => { m.unshade = (m.unshade || []).filter((s) => regionOf(s) !== l); m.shade = [...(m.shade || []), at]; return m; }, { bounds: bounds() });
    setHint(t('backgroundAreas.hintShaded'));
  }
  const typing = (e) => /input|textarea|select/i.test(e.target?.tagName || '') || e.target?.isContentEditable;
  function onKey(e) {
    if (e.code !== 'Space' || typing(e) || !shown || getTool() === 'pan') return;
    const down = e.type === 'keydown';
    if (down) e.preventDefault();
    if (space !== down) { space = down; applyTool(); }
  }

  map.on('mousedown', onDown);
  map.on('mousemove', onMove);
  map.on('click', onClick);
  map.on('zoomend', () => { if (shown) drawLines(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  return {
    update,
    destroy() {
      map.off('mousedown', onDown); map.off('mousemove', onMove); map.off('click', onClick);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      canvas.remove(); lines.remove(); roads.remove(); brushRing?.remove(); draft?.layer.remove();
    },
  };
}
