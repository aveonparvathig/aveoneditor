import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aveon/editor/theme.css': resolve(__dirname, '../../packages/aveon-editor/src/theme/index.css'),
      '@aveon/editor': resolve(__dirname, '../../packages/aveon-editor/src/index.ts')
    }
  },
  server: { port: 5180, strictPort: true }
});
