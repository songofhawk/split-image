import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: mode === 'production' ? '/snaplab/' : '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Note: COOP/COEP headers removed as they block model downloads from HuggingFace
      // transformers.js will work in single-threaded mode without SharedArrayBuffer
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': '/src',
      }
    }
  };
});
