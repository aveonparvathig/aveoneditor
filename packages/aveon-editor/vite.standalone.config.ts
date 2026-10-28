import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Script-tag build (`dist/standalone`): minified, KaTeX bundled as a lazily loaded chunk. */
export default defineConfig({
  build: {
    outDir: 'dist/standalone',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/standalone.ts'),
      formats: ['es'],
      fileName: () => 'aveon-editor.standalone.js'
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
