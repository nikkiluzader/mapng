import {
  computeDeterministicJobId,
  computeTileId,
  summarizeStageTimings,
  TILE_STATES,
} from './batchRuntime.js';
import { classifyError, computeBackoffMs } from './retryPolicy.js';

export function runBatchDebugHarness() {
  const cfg = {
    center: { lat: 35.1234567, lng: -111.7654321 },
    resolution: 1024,
    gridCols: 2,
    gridRows: 2,
    includeOSM: true,
    elevationSource: 'default',
    glbMeshResolution: 256,
    exports: { heightmap: true },
  };

  const idA = computeDeterministicJobId(cfg);
  const idB = computeDeterministicJobId({ ...cfg });

  const tile = {
    row: 0,
    col: 1,
    center: { lat: 35.1234567, lng: -111.7654321 },
    bounds: { north: 1, south: 0, east: 1, west: 0 },
  };

  const tileA = computeTileId(idA, tile);
  const tileB = computeTileId(idA, { ...tile });

  const summary = summarizeStageTimings({
    tiles: [
      {
        id: 't1', row: 0, col: 0,
        status: TILE_STATES.DONE,
        stageTimings: { fetch_total: 1100, queue_wait_fetch: 200, encode_zip: 400 },
      },
      {
        id: 't2', row: 0, col: 1,
        status: TILE_STATES.DONE,
        stageTimings: { fetch_total: 900, queue_wait_fetch: 100, encode_zip: 700 },
      },
    ],
  });

  const retryable = classifyError({ status: 429, message: 'Rate limited' });
  const nonRetryable = classifyError({ status: 400, message: 'Bad request' });

  return {
    deterministicJobId: idA === idB,
    deterministicTileId: tileA === tileB,
    hasSummary: !!summary?.byStage?.fetch_total,
    classify429Retryable: retryable.retryable,
    classify400NonRetryable: !nonRetryable.retryable,
    backoffExampleMs: computeBackoffMs(3, 1000, 30000),
  };
}

if (typeof window !== 'undefined') {
  window.__mapngBatchDebugHarness = runBatchDebugHarness;
}
