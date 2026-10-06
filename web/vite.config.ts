import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8790' },
  },
});
