<template>
  <BaseCard class="bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 space-y-2" padded>
    <!-- Header -->
    <div class="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 pb-2">
      <ScanLine :size="13" class="text-[#FF6600]" />
      LiDAR Metadata
    </div>

    <!-- Row grid -->
    <div class="space-y-1">
      <div v-for="row in rows" :key="row.label" class="flex items-baseline justify-between gap-2 text-[11px]">
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
});

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPoints(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtBytes(n) {
  if (!n) return '—';
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576)     return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024)         return `${(n / 1_024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtCoord(v, pos, neg) {
  if (v == null) return null;
  const dir = v >= 0 ? pos : neg;
  return `${Math.abs(v).toFixed(5)}° ${dir}`;
}

// ── Derived values ────────────────────────────────────────────────────────────

const coverageKm = computed(() => {
  const b = props.meta.bounds;
  if (!b) return null;
  const midLat = (b.north + b.south) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const w = (b.east  - b.west)  * mPerDegLng / 1000;
  const h = (b.north - b.south) * mPerDegLat / 1000;
  return { w, h };
});

const densityPtM2 = computed(() => {
  const c = coverageKm.value;
  if (!c || !props.meta.pointCount) return null;
  const areaSqM = c.w * 1000 * c.h * 1000;
  return props.meta.pointCount / areaSqM;
});

// ── Row definitions ───────────────────────────────────────────────────────────

const rows = computed(() => {
  const m = props.meta;
  const list = [];

  // Format + version
  const fmt = m.pointFormat != null ? `Format ${m.pointFormat}` : null;
  const ver = (m.versionMajor != null && m.versionMinor != null)
    ? `LAS ${m.versionMajor}.${m.versionMinor}` : null;
  if (ver || fmt) {
    list.push({ label: 'Format', value: [ver, fmt].filter(Boolean).join(' · ') });
  }

  // Encoding
  list.push({ label: 'Encoding', value: m.isLaz ? 'LAZ (compressed)' : 'LAS (uncompressed)' });

  // File size
  if (m.fileSize) {
    list.push({ label: 'File size', value: fmtBytes(m.fileSize) });
  }

  // Point count
  if (m.pointCount != null) {
    list.push({ label: 'Points', value: fmtPoints(m.pointCount) });
  }

  // CRS
  list.push({ label: 'CRS', value: m.epsgCode ? `EPSG:${m.epsgCode}` : 'Unknown' });

  // Coverage (from WGS84 bounds)
  const cov = coverageKm.value;
  if (cov) {
    list.push({
      label: 'Coverage',
      value: `${cov.w.toFixed(2)} × ${cov.h.toFixed(2)} km`,
    });
  }

  // Z range (native CRS units — meters for most, feet for ftUS CRS)
  if (m.minZ != null && m.maxZ != null) {
    list.push({
      label: 'Z range',
      value: `${m.minZ.toFixed(1)} – ${m.maxZ.toFixed(1)}`,
    });
  }

  // Point density
  if (densityPtM2.value != null) {
    list.push({
      label: 'Density',
      value: `${densityPtM2.value.toFixed(1)} pts/m²`,
    });
  }

  // Center (WGS84)
  if (m.center) {
    list.push({ label: 'Lat', value: fmtCoord(m.center.lat, 'N', 'S') });
    list.push({ label: 'Lng', value: fmtCoord(m.center.lng, 'E', 'W') });
  }

  return list;
});
</script>
