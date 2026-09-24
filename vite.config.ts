import { defineConfig } from 'vite';

// `base: './'` makes every asset path relative, so the production build works
// from a domain root, a GitHub Pages sub-path (/<repo>/), Netlify, Vercel, etc.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
