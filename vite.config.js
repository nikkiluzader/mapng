import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { templateCompilerOptions } from '@tresjs/core';
import { execSync } from 'child_process';

const commitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || 'dev';
  }
})();

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
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
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