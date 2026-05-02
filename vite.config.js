import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { templateCompilerOptions } from '@tresjs/core';
import { execSync } from 'child_process';

const nowIso = new Date().toISOString();

const git = (command) => {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

const resolveRefInfo = (candidates) => {
  for (const ref of candidates) {
    const hash = git(`git rev-parse --short ${ref}`);
    if (!hash) continue;
    const time = git(`git show -s --format=%cI ${ref}`) || '';
    return { hash, time };
  }
  return { hash: 'n/a', time: '' };
};

const commitHash = (() => {
  const headHash = git('git rev-parse --short HEAD');
  if (headHash) return headHash;
  return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || 'dev';
})();

const mainRefInfo = resolveRefInfo(['origin/main', 'main', 'origin/master', 'master']);
const devRefInfo = resolveRefInfo(['origin/dev', 'dev', 'origin/develop', 'develop', 'origin/development', 'development']);

const mainBuildHash = process.env.MAPNG_MAIN_BUILD_HASH || mainRefInfo.hash;
const mainBuildTime = process.env.MAPNG_MAIN_BUILD_TIME || mainRefInfo.time;
const devBuildHash = process.env.MAPNG_DEV_BUILD_HASH || devRefInfo.hash;
const devBuildTime = process.env.MAPNG_DEV_BUILD_TIME || devRefInfo.time;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      ...templateCompilerOptions
    })
  ],
  optimizeDeps: {
    exclude: ['geotiff'],
    include: ['laz-perf/lib/worker'],
  },
  css: {
    devSourcemap: false
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'leaflet': ['leaflet'],
          'geotiff': ['geotiff'],
          'proj4': ['proj4']
        }
      }
    }
  },
  define: {
    'process.env': {},
    '__BUILD_HASH__': JSON.stringify(commitHash),
    '__BUILD_TIME__': JSON.stringify(nowIso),
    '__BUILD_MAIN_HASH__': JSON.stringify(mainBuildHash),
    '__BUILD_MAIN_TIME__': JSON.stringify(mainBuildTime),
    '__BUILD_DEV_HASH__': JSON.stringify(devBuildHash),
    '__BUILD_DEV_TIME__': JSON.stringify(devBuildTime),
  },
  server: {
    proxy: {
      '/api/gpxz': {
        target: 'https://api.gpxz.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gpxz/, ''),
      },
      '/api/nominatim-osm': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nominatim-osm/, ''),
      },
      '/api/nominatim-geocode': {
        target: 'https://nominatim.geocoding.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nominatim-geocode/, ''),
      },
      '/api/kron86/': {
        target: 'https://mapy.geoportal.gov.pl',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/api\/kron86/, ''),
      },
      '/api/kron86-opendata': {
        target: 'https://opendata.geoportal.gov.pl',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/api\/kron86-opendata/, ''),
      },
    },
  },
});