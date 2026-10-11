import { defineConfig } from 'vite';

// Source lives in app/; the build goes to dist/ and is published to GitHub Pages under /block-squad/
export default defineConfig({
  root: 'app',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 }
});
