// The settings an export runs with, grouped for the progress window's "Settings used" section
// (components/ui/StageLoader.vue). Pure: the export's options in, groups of rows out; labels and
// values are i18n keys under exportSettings.* (a value may also be plain text: a name, a size).

const SOURCE_KEYS = {
  mapterhorn: 'srcMapterhorn', gpxz: 'srcGpxz', usgs: 'srcUsgs', usgs1m: 'srcUsgs', kron86: 'srcKron86', none: 'srcNone',
};
const TEXTURE_KEYS = { painted: 'texPainted', game: 'texGame', satellite: 'texSatellite', hybrid: 'texHybrid', osm: 'texOsm', none: 'texNone' };
const SHAPING_KEYS = ['shapeTerrain', 'shapeRoads', 'shapeBridges', 'shapeOverpasses', 'shapeTunnels', 'shapeExtras', 'shapeDetail'];

const onOff = (v) => ({ t: v ? 'on' : 'off', off: !v });

/**
 * opts: the export's level options (ExportPanel levelOptions). ctx: { terrainMode ('ready' | 'custom' |
 * 'untouched'), advanced, width, metersPerPixel }. Returns [{ key, rows: [{ key, value: { t } | { text }, off }] }].
 */
export function summarizeExportSettings(opts = {}, ctx = {}) {
  const mpp = Number(opts.requestedProcessingMetersPerPixel ?? ctx.metersPerPixel) || 1;
  const px = Number(ctx.width) || Number(opts.requestedResolution) || 0;
  const km = px ? (px * mpp) / 1000 : 0;
  const mode = ctx.advanced === false ? 'ready' : (ctx.terrainMode || 'ready');
  const shaping = mode === 'custom'
    ? { text: SHAPING_KEYS.filter((k) => opts[k]).length + ' / ' + SHAPING_KEYS.length, t: 'modeCustomCount' }
    : { t: mode === 'untouched' ? 'modeUntouched' : 'modeReady' };
  const row = (key, value, off = false) => ({ key, value, off });
  const toggle = (key, v) => { const o = onOff(v); return row(key, { t: o.t }, o.off); };

  const terrain = [
    row('source', { t: SOURCE_KEYS[opts.elevationSource] || 'srcStandard' }),
    row('size', { text: px ? `${px} px · ${mpp} m/px · ${km.toFixed(km < 10 ? 1 : 0)} km` : '—' }),
    row('shaping', shaping),
  ];
  if (Number(opts.seaLevelOffset)) terrain.push(row('seaLevel', { text: `${Number(opts.seaLevelOffset)} m` }));
  if (Number(ctx.backgroundPct) > 0) terrain.push(row('background', { t: 'backgroundPct', text: String(ctx.backgroundPct) }));

  const roads = [
    row('roads', { t: opts.roadType === 'none' ? 'off' : 'roadsDecal' }, opts.roadType === 'none'),
    row('bridges', { t: opts.includeBridges === false ? 'off' : (opts.lidarDecks ? 'bridgesLidar' : 'on') }, opts.includeBridges === false),
    toggle('tunnels', opts.includeTunnels !== false),
    toggle('safeCaps', !!opts.safeCaps),
    // (only when switched off: town streets without the assumed parking lanes)
    ...(opts.assumeParking === false ? [toggle('assumeParking', false)] : []),
  ];

  const objects = [
    toggle('buildings', !!opts.includeBuildings),
    toggle('trees', !!opts.includeTrees),
    ...(opts.includeTrees && opts.forestDensity && opts.forestDensity !== 'normal'
      ? [row('forestDensity', { t: `forest_${opts.forestDensity}` })] : []),
    // (tree kinds left out in Fine-tuning, by their ids: the page names them)
    ...(opts.includeTrees && Array.isArray(opts.treeKindsOff) && opts.treeKindsOff.length ? [row('treeKindsOff', { text: opts.treeKindsOff.join(', '), kinds: [...opts.treeKindsOff] })] : []),
    ...(opts.includeTrees && Array.isArray(opts.treeSwaps) && opts.treeSwaps.length ? [row('treeSwaps', { text: opts.treeSwaps.map((s) => String(s).replace('>', ' → ')).join(', ') })] : []),
    ...(opts.includeTrees && Array.isArray(opts.treeModelsOff) && opts.treeModelsOff.length ? [row('treeModelsOff', { text: String(opts.treeModelsOff.length) })] : []),
    toggle('rocks', !!opts.includeRocks),
    toggle('water', !!opts.includeWater),
    row('backdrop', opts.includeBackdrop ? { t: SOURCE_KEYS[opts.backdropElevationSource] || 'on' } : { t: 'off' }, !opts.includeBackdrop),
  ];

  const output = [
    row('baseTexture', { t: TEXTURE_KEYS[opts.baseTexture] || 'texGame' }),
    toggle('materials', opts.pbrSource === 'osm'),
  ];
  if (opts.levelName) output.push(row('levelName', { text: String(opts.levelName) }));
  // (the view distance only when one was chosen; Auto follows the map: services/viewDistance.js)
  if (Number(opts.viewDistance) > 0) output.push(row('viewDistance', { text: `${Number(opts.viewDistance) / 1000} km` }));
  // (the spawn and quicktravel points from step 1: services/spawnPoints.js)
  if (Array.isArray(opts.points) && opts.points.length) {
    const def = opts.points.find((p) => p?.isDefault);
    output.push(row('points', def ? { t: 'pointsWithDefault', text: `${opts.points.length} · ${def.name || '★'}` } : { text: String(opts.points.length) }));
  }

  return [
    { key: 'groupTerrain', rows: terrain },
    { key: 'groupRoads', rows: roads },
    { key: 'groupObjects', rows: objects },
    { key: 'groupOutput', rows: output },
  ];
}

/** The groups with their words: [{ title, rows: [{ label, value, off }] }] for the progress window. */
export function translateExportSettings(groups, t) {
  return groups.map((g) => ({
    title: t(`exportSettings.${g.key}`),
    rows: g.rows.map((r) => ({
      label: t(`exportSettings.${r.key}`),
      value: r.value.t && r.value.text ? t(`exportSettings.${r.value.t}`, { value: r.value.text })
        : r.value.t ? t(`exportSettings.${r.value.t}`) : r.value.text,
      off: !!r.off,
    })),
  }));
}
