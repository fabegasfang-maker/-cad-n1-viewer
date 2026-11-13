import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        // index.html = หน้าแรก (3 ปุ่ม), viewer.html = ตัวดูแผนผัง CAD, map.html = ผังแบบแผนที่ (มือถือ/tablet)
        input: {
          main: path.resolve(__dirname, 'index.html'),
          viewer: path.resolve(__dirname, 'viewer.html'),
          map: path.resolve(__dirname, 'map.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
