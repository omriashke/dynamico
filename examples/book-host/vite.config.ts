import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const rnwPath = path.dirname(require.resolve('react-native-web/package.json'));
const rnSvgWebPath = require.resolve('react-native-svg-web');

export default defineConfig({
  plugins: [react()],
  base: process.env.DYNAMICO_BOOK_BASE ?? '/',
  define: {
    global: 'globalThis',
  },
  server: {
    port: 6006,
    proxy: {
      '/api/dynamico': {
        target: process.env.DYNAMICO_REGISTRY_PROXY ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
        rewrite: (p) =>
          process.env.DYNAMICO_REGISTRY_PROXY
            ? p
            : p.replace(/^\/api\/dynamico/, ''),
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-native', 'react-native-web'],
    alias: [
      { find: 'react-native', replacement: rnwPath },
      { find: 'react-native-svg', replacement: rnSvgWebPath },
      {
        find: 'expo-secure-store',
        replacement: path.resolve(appDir, 'src/stubs/expo-secure-store.ts'),
      },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  optimizeDeps: {
    exclude: ['@omriashke/dynamico-book', 'expo-secure-store'],
    include: ['react-native-web', 'react-native-svg-web', '@omriashke/dynamico-web', 'prop-types'],
  },
});
