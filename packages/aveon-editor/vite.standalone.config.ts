import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Script-tag build (`dist/standalone`): minified, KaTeX and MathJax bundled as lazily loaded chunks.
 * Also builds the equation viewer for read-only pages (`aveon-math-viewer.js`).
 */
export default defineConfig({
  build: {
    outDir: 'dist/standalone',
    emptyOutDir: true,
    lib: {
      entry: { 'aveon-editor.standalone': resolve(__dirname, 'src/standalone.ts'), 'aveon-math-viewer': resolve(__dirname, 'src/viewer.ts') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      output: {
        assetFileNames: asset => (asset.name === 'style.css' ? 'aveon-editor.standalone.css' : 'assets/[name]-[hash][extname]'),
        chunkFileNames: 'chunks/[name]-[hash].js'
      }
    },
    sourcemap: true,
    target: 'es2022',
    minify: true
  }
});
