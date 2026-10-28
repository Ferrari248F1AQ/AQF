import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Quale versione gira: si legge nelle Impostazioni, per sapere se il Raspberry è aggiornato. */
function versione(): string {
  try {
    const c = execSync('git log -1 --format=%h·%cd --date=format:%d/%m/%Y', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return c || 'sconosciuta';
  } catch {
    return 'sconosciuta';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __VERSIONE__: JSON.stringify(versione()) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8790' },
  },
});
