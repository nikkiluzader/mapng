export const JOB_STATES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const TILE_STATES = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const round = (value, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const fnv1a = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const normalizeBatchConfig = (config) => {
  return {
    schemaVersion: 1,
    center: {
      lat: round(Number(config.center?.lat || 0), 6),
      lng: round(Number(config.center?.lng || 0), 6),
    },
    resolution: Number(config.resolution || 1024),
    gridCols: Number(config.gridCols || 1),
    gridRows: Number(config.gridRows || 1),
    includeOSM: !!config.includeOSM,
    elevationSource: config.elevationSource || 'default',
    gpxzApiKey: config.gpxzApiKey || '',
    glbMeshResolution: Number(config.glbMeshResolution || 256),
    performanceProfile: config.performanceProfile || 'balanced',
    exports: { ...(config.exports || {}) },
  };
};

export const computeDeterministicJobId = (config) => {
  const normalized = normalizeBatchConfig(config);
  const payload = JSON.stringify(normalized);
  return `batch_${fnv1a(payload)}`;
};

export const computeTileId = (jobId, tile) => {
  const bbox = tile.bounds || {};
  const center = tile.center || {};
  const key = [
    jobId,
    tile.row,
    tile.col,
    round(center.lat || 0, 6),
    round(center.lng || 0, 6),
    round(bbox.north || 0, 6),
    round(bbox.south || 0, 6),
    round(bbox.east || 0, 6),
    round(bbox.west || 0, 6),
  ].join('|');
  return `tile_${fnv1a(key)}`;
};

export const isValidJobState = (state) => Object.values(JOB_STATES).includes(state);
export const isValidTileState = (state) => Object.values(TILE_STATES).includes(state);

export const ensureJobAndTileStates = (state) => {
  if (!state || typeof state !== 'object') return;

  if (!isValidJobState(state.status)) {
    state.status = JOB_STATES.PENDING;
  }

  if (!Array.isArray(state.tiles)) {
    state.tiles = [];
    return;
  }

  if (!state.instrumentation || typeof state.instrumentation !== 'object') {
    state.instrumentation = {
      memory: {
        supported: false,
        samples: [],
        peakUsedBytes: 0,
        peakTotalBytes: 0,
        sampleLimit: 120,
        sampleIntervalMs: 1200,
        lastSampleAt: 0,
      },
    };
  } else if (!state.instrumentation.memory || typeof state.instrumentation.memory !== 'object') {
    state.instrumentation.memory = {
      supported: false,
      samples: [],
      peakUsedBytes: 0,
      peakTotalBytes: 0,
      sampleLimit: 120,
      sampleIntervalMs: 1200,
      lastSampleAt: 0,
    };
  }

  state.tiles.forEach((tile) => {
    if (!isValidTileState(tile.status)) {
      if (tile.status === 'completed') tile.status = TILE_STATES.DONE;
      else if (tile.status === 'pending') tile.status = TILE_STATES.QUEUED;
      else tile.status = TILE_STATES.QUEUED;
    }

    if (!tile.stageTimings) tile.stageTimings = {};
    if (!tile.errors) tile.errors = [];
    if (!Number.isFinite(tile.attempts)) tile.attempts = 0;
    if (!tile.memory || typeof tile.memory !== 'object') {
      tile.memory = {
        startUsedBytes: null,
        afterFetchUsedBytes: null,
        beforeZipUsedBytes: null,
        afterZipUsedBytes: null,
        endUsedBytes: null,
        peakUsedBytes: 0,
      };
    }
  });
};

export const summarizeStageTimings = (state) => {
  const stageSamples = new Map();
  let slowestTile = null;
  let slowestMs = -1;
  let totalWaitMs = 0;

  for (const tile of state.tiles || []) {
    const timings = tile.stageTimings || {};
    const tileTotal = Object.values(timings).reduce((a, b) => a + (Number(b) || 0), 0);
    if (tileTotal > slowestMs) {
      slowestMs = tileTotal;
      slowestTile = tile;
    }

    totalWaitMs += Number(timings.queue_wait_fetch || 0);
    totalWaitMs += Number(timings.queue_wait_compute || 0);
    totalWaitMs += Number(timings.queue_wait_encode || 0);

    Object.entries(timings).forEach(([stage, ms]) => {
      const value = Number(ms) || 0;
      if (!stageSamples.has(stage)) stageSamples.set(stage, []);
      stageSamples.get(stage).push(value);
    });
  }

  const byStage = {};
  for (const [stage, samples] of stageSamples.entries()) {
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    byStage[stage] = {
      count: sorted.length,
      avgMs: Math.round(avg),
      medianMs: Math.round(median),
      maxMs: Math.round(sorted[sorted.length - 1]),
    };
  }

  const memory = state.instrumentation?.memory || {};
  const memorySamples = Array.isArray(memory.samples) ? memory.samples : [];
  const peakSample = memorySamples.reduce((best, sample) => {
    if (!sample || !Number.isFinite(sample.usedBytes)) return best;
    if (!best || sample.usedBytes > best.usedBytes) return sample;
    return best;
  }, null);

  let peakTileMemory = null;
  for (const tile of state.tiles || []) {
    const peak = Number(tile?.memory?.peakUsedBytes || 0);
    if (!peak) continue;
    if (!peakTileMemory || peak > peakTileMemory.peakUsedBytes) {
      peakTileMemory = {
        tileId: tile.id,
        row: tile.row,
        col: tile.col,
        peakUsedBytes: peak,
      };
    }
  }

  return {
    byStage,
    totalWaitMs: Math.round(totalWaitMs),
    slowestTile: slowestTile ? {
      tileId: slowestTile.id,
      row: slowestTile.row,
      col: slowestTile.col,
      totalMs: Math.round(slowestMs),
    } : null,
    memory: {
      supported: !!memory.supported,
      sampleCount: memorySamples.length,
      peakUsedBytes: Number(memory.peakUsedBytes || 0),
      peakTotalBytes: Number(memory.peakTotalBytes || 0),
      lastUsedBytes: Number(memorySamples[memorySamples.length - 1]?.usedBytes || 0),
      peakSampleAt: peakSample?.at || null,
      peakTile: peakTileMemory,
    },
  };
};

export const buildBatchBenchmarkReport = (state) => {
  if (!state || typeof state !== 'object') return null;

  const summary = state.summary || summarizeStageTimings(state);
  const tiles = Array.isArray(state.tiles) ? state.tiles : [];
  const completedTiles = tiles.filter((tile) => tile.status === TILE_STATES.DONE || tile.status === 'completed');
  const failedTiles = tiles.filter((tile) => tile.status === TILE_STATES.FAILED || tile.status === 'failed');

  const startedAt = Number(state.startedAt || 0);
  const completedAt = Number(state.completedAt || 0);
  const totalDurationMs = startedAt && completedAt && completedAt > startedAt
    ? completedAt - startedAt
    : null;

  const memory = summary?.memory || {};
  const stageTotals = {};
  for (const tile of tiles) {
    const timings = tile.stageTimings || {};
    for (const [stage, ms] of Object.entries(timings)) {
      stageTotals[stage] = Math.round((stageTotals[stage] || 0) + (Number(ms) || 0));
    }
  }

  const tileSamples = tiles.map((tile) => ({
    id: tile.id,
    row: tile.row,
    col: tile.col,
    status: tile.status,
    lifecycle: tile.lifecycle || null,
    memory: tile.memory || null,
  }));

  const durationSec = totalDurationMs ? (totalDurationMs / 1000) : 0;
  const peakMemoryGiB = Number(memory.peakUsedBytes || 0) / (1024 ** 3);
  const failCount = failedTiles.length;
  const queueWaitSec = Number(summary?.totalWaitMs || 0) / 1000;

  const scoring = {
    weights: {
      durationSec: 1,
      peakMemoryGiB: 120,
      failureCount: 900,
      queueWaitSec: 0.25,
    },
  };

  const compositeScore = Math.round(
    (durationSec * scoring.weights.durationSec)
      + (peakMemoryGiB * scoring.weights.peakMemoryGiB)
      + (failCount * scoring.weights.failureCount)
      + (queueWaitSec * scoring.weights.queueWaitSec),
  );

  const recommendation = failCount > 0
    ? 'unstable'
    : peakMemoryGiB > 2.2
      ? 'memory_risk'
      : 'good';

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    job: {
      id: state.id,
      status: state.status,
      performanceProfile: state.performanceProfile || 'balanced',
      scheduler: state.scheduler || null,
      resolution: state.resolution,
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      tileCount: tiles.length,
      completedTiles: completedTiles.length,
      failedTiles: failedTiles.length,
      totalDurationMs,
      totalDurationSec: totalDurationMs ? Math.round(totalDurationMs / 1000) : null,
      startedAt: state.startedAt || null,
      completedAt: state.completedAt || null,
    },
    memory: {
      supported: !!memory.supported,
      sampleCount: Number(memory.sampleCount || 0),
      peakUsedBytes: Number(memory.peakUsedBytes || 0),
      peakTotalBytes: Number(memory.peakTotalBytes || 0),
      lastUsedBytes: Number(memory.lastUsedBytes || 0),
      peakSampleAt: memory.peakSampleAt || null,
      peakTile: memory.peakTile || null,
    },
    timings: {
      queueWaitMs: Number(summary?.totalWaitMs || 0),
      slowestTile: summary?.slowestTile || null,
      byStage: summary?.byStage || {},
      stageTotals,
    },
    exports: {
      ...(state.exports || {}),
    },
    comparison: {
      compositeScore,
      lowerIsBetter: true,
      recommendation,
      scoring,
      derived: {
        durationSec: Math.round(durationSec),
        peakMemoryGiB: Number(peakMemoryGiB.toFixed(3)),
        failureCount: failCount,
        queueWaitSec: Math.round(queueWaitSec),
      },
    },
    tileSamples,
  };
};
