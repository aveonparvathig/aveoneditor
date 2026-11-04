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
      external: ['katex', 'marked', /^mermaid(\/|$)/, /^mathjax-full(\/|$)/]
    },
    sourcemap: true,
    target: 'es2022',
    minify: false
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // The first equation image in a test file loads MathJax (about 1.4 MB), which takes more than
    // the default 5 s on slower CI machines.
    testTimeout: 30000
  }
});
