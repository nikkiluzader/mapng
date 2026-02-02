import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { templateCompilerOptions } from '@tresjs/core';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      ...templateCompilerOptions
    })
  ],
  optimizeDeps: {
    exclude: ['geotiff']
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
    'process.env': {}
  }
});