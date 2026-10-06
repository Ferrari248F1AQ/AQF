import { resolve } from 'node:path';

/**
 * Tutta la configurazione arriva dall'ambiente (in esercizio da /etc/aqf/aqf.env).
 *
 * `AQF_DATA_DIR` contiene il database e, finché non si sceglie un disco
 * diverso dalle impostazioni, anche i documenti: è il «disco interno».
 */
const dataDir = resolve(process.env.AQF_DATA_DIR ?? './dati');

export const config = {
  /** 0.0.0.0: raggiungibile dall'IP del Raspberry in rete interna (e quindi da cloudflared). */
  host: process.env.AQF_HOST ?? '0.0.0.0',
  port: Number(process.env.AQF_PORT ?? 8790),
  dataDir,
  dbPath: resolve(dataDir, 'aqf.sqlite'),
  /** Dove sta il build della parte web. */
  webDir: resolve(process.env.AQF_WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname),
  /** Tetto per un singolo documento caricato. Il tunnel Cloudflare gratuito taglia a 100 MB. */
  maxUploadMb: Number(process.env.AQF_MAX_UPLOAD_MB ?? 95),
  /** Durata della sessione: 30 giorni, rinnovata a ogni uso. */
  sessionDays: Number(process.env.AQF_SESSION_DAYS ?? 30),
  soffice: process.env.AQF_SOFFICE ?? 'soffice',
  pdftoppm: process.env.AQF_PDFTOPPM ?? 'pdftoppm',
};
