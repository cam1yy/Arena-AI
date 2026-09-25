import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // The browser only ever talks to this origin; API calls are proxied.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, xfwd: true },
      '/u/': { target: apiTarget, changeOrigin: false, xfwd: true },
    },
  },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: { '/api': apiTarget, '/u/': apiTarget } },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) return 'react';
            if (id.includes('@tanstack')) return 'query';
            if (id.includes('radix-ui') || id.includes('@radix-ui')) return 'radix';
          }
          return undefined;
        },
      },
    },
  },
});
