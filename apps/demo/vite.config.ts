import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aveon/editor/theme.css': resolve(__dirname, '../../packages/aveon-editor/src/theme/index.css'),
      '@aveon/editor': resolve(__dirname, '../../packages/aveon-editor/src/index.ts')
    }
  },
  server: { port: 5180, strictPort: true },
  build: {
    // Every page of the demo, not just index.html.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        integration: resolve(__dirname, 'integration.html'),
        collaboration: resolve(__dirname, 'collaboration.html')
      }
    }
  }
});
