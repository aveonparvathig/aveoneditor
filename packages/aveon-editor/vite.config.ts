import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AveonEditor',
      formats: ['es'],
      fileName: () => 'aveon-editor.js',
      cssFileName: 'aveon-editor'
    },
    rollupOptions: {
      external: ['katex', 'marked', /^mermaid(\/|$)/]
    },
    sourcemap: true,
    target: 'es2022',
    minify: false
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts']
  }
});
