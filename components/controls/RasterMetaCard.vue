<template>
  <BaseCard class="bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 space-y-2" padded>
    <div class="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 pb-2">
      <ScanLine :size="13" class="text-brand" />
      Raster Metadata
    </div>

    <div class="space-y-1">
      <div v-for="row in rows" :key="row.label" class="flex items-baseline justify-between gap-2 text-caption">
        <span class="text-gray-400 dark:text-gray-500 shrink-0">{{ row.label }}</span>
        <span class="text-gray-700 dark:text-gray-200 font-medium text-right tabular-nums">{{ row.value }}</span>
      </div>
    </div>
  </BaseCard>
</template>

<script setup>
import { computed } from 'vue';
import { ScanLine } from 'lucide-vue-next';
import BaseCard from '../base/BaseCard.vue';

const props = defineProps({
  meta: { type: Object, required: true },
  verticalUnitOverride: { type: String, default: 'auto' },
});

function fmtBytes(n) {
  if (!n) return '—';
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtCoord(v, pos, neg) {
  if (v == null) return null;
  const dir = v >= 0 ? pos : neg;
  return `${Math.abs(v).toFixed(5)}° ${dir}`;
}

function fmtMpp(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${v.toFixed(3)} m/px`;
}

const coverageKm = computed(() => {
  const b = props.meta?.bounds;
  if (!b) return null;
  const midLat = (b.north + b.south) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const w = (b.east - b.west) * mPerDegLng / 1000;
  const h = (b.north - b.south) * mPerDegLat / 1000;
  return { w, h };
});

const detectedUnitLabel = computed(() => {
  const u = props.meta?.verticalUnitDetected;
  if (u === 'meters') return 'meters';
  if (u === 'feet') return 'feet (international)';
  if (u === 'us_survey_feet') return 'feet (US survey)';
  return 'unknown';
});

const detectionSourceLabel = computed(() => {
  const s = props.meta?.verticalUnitDetectionSource;
  if (!s) return '—';
  if (s === 'VerticalUnitsGeoKey') return 'GeoKey vertical units';
  if (s === 'ProjLinearUnitsGeoKey') return 'GeoKey projected units';
  if (s === 'GeoAsciiParamsTag') return 'GeoTIFF ASCII params';
  return s;
});

const noDataLabel = computed(() => {
  const detection = props.meta?.noDataDetection;
  const value = props.meta?.noData;
  if (!Number.isFinite(value)) return 'none declared';
  const shown = Math.abs(value) >= 1e6 ? value.toExponential(2) : String(Number(value.toFixed(4)));
  if (detection?.source === 'tag') return `${shown} (tagged)`;
  if (detection?.source === 'detected') {
    const pct = Number.isFinite(detection.share) ? ` — ${(detection.share * 100).toFixed(1)}% of pixels` : '';
    return `${shown} (detected${pct})`;
  }
  return shown;
});

const rows = computed(() => {
  const m = props.meta || {};
  const list = [];

  list.push({ label: 'Format', value: m.formatLabel || (m.isGeoTiff ? 'GeoTIFF' : 'TIFF (no geo metadata)') });

  if (m.sourceWidth && m.sourceHeight) {
    list.push({ label: 'Source grid', value: `${m.sourceWidth} × ${m.sourceHeight} px` });
  }

  if (m.nativeWidth && m.nativeHeight) {
    list.push({ label: 'Native coverage grid', value: `${m.nativeWidth} × ${m.nativeHeight} px` });
  }

  if (String(m.sourceFormat || '').toLowerCase() === 'gml-zip') {
    if (Number.isFinite(m.zipOverallGridWidthPx) && Number.isFinite(m.zipOverallGridHeightPx)) {
      list.push({ label: 'ZIP overall grid', value: `${m.zipOverallGridWidthPx} × ${m.zipOverallGridHeightPx} px` });
    }
    if (Number.isFinite(m.tileGridColumns) && Number.isFinite(m.tileGridRows)) {
      list.push({ label: 'ZIP tile layout', value: `${m.tileGridColumns} × ${m.tileGridRows}` });
    }
    if (Number.isFinite(m.sourceFileCount)) {
      list.push({ label: 'ZIP tiles present', value: `${m.sourceFileCount}` });
    }
    if (Number.isFinite(m.expectedTileCount)) {
      list.push({ label: 'ZIP tiles expected', value: `${m.expectedTileCount}` });
    }
    if (Number.isFinite(m.missingTileCount)) {
      list.push({ label: 'ZIP tiles missing', value: `${m.missingTileCount}` });
    }
  }

  if (m.suggestedResolution) {
    list.push({ label: 'Suggested square export (optional)', value: `${m.suggestedResolution} × ${m.suggestedResolution} px` });
  }

  if (Number.isFinite(m.nativeMetersPerPixel)) {
    list.push({ label: 'Source resolution', value: fmtMpp(m.nativeMetersPerPixel) });
    list.push({ label: 'Target grid resolution', value: '1.000 m/px' });
  }

  list.push({ label: 'CRS', value: m.epsgCode ? `EPSG:${m.epsgCode}` : 'Unknown / user-defined' });

  const cov = coverageKm.value;
  if (cov) {
    list.push({ label: 'Coverage', value: `${cov.w.toFixed(2)} × ${cov.h.toFixed(2)} km` });
  }

  list.push({ label: 'No-data value', value: noDataLabel.value });

  list.push({ label: 'Detected elevation units', value: detectedUnitLabel.value });
  list.push({ label: 'Detection source', value: detectionSourceLabel.value });
  list.push({ label: 'Applied units mode', value: props.verticalUnitOverride || 'auto' });

  if (m.fileSize) {
    list.push({ label: 'File size', value: fmtBytes(m.fileSize) });
  }

  if (m.center) {
    list.push({ label: 'Lat', value: fmtCoord(m.center.lat, 'N', 'S') });
    list.push({ label: 'Lng', value: fmtCoord(m.center.lng, 'E', 'W') });
  }

  return list;
});
</script>
