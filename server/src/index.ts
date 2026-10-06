import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { pulisciSessioniScadute } from './auth.js';
import { config } from './config.js';
import { riprendiConversioni } from './conversione.js';
import { chiudiDb, db } from './db.js';
import { rotteAccesso } from './routes/accesso.js';
import { rotteDiretta } from './routes/diretta.js';
import { rotteLibreria } from './routes/libreria.js';
import { chiudiRegistrazioniAbbandonate, rotteRegistrazioni } from './routes/registrazioni.js';
import { rotteSistema } from './routes/sistema.js';
import { rotteUtenti } from './routes/utenti.js';
import { assicuraVolumeIniziale } from './storage.js';

const app = Fastify({
  logger: { level: process.env.AQF_LOG ?? 'info' },
  // cloudflared arriva dalla rete interna (o dal Raspberry stesso): l'IP vero del
  // visitatore sta nelle intestazioni che aggiunge. Ci si fida solo di indirizzi privati.
  trustProxy: ['loopback', 'linklocal', 'uniquelocal'],
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 30 } });

const webPresente = existsSync(config.webDir);
await app.register(fastifyStatic, {
  root: webPresente ? config.webDir : config.dataDir,
  serve: webPresente,
  index: false,
  wildcard: true,
  // I file con l'impronta nel nome non cambiano mai: si tengono in cache a lungo.
  setHeaders: (res, percorso) => {
    if (percorso.includes('/assets/')) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  },
});

/**
 * Le richieste che cambiano qualcosa devono avere l'intestazione `x-aqf`.
 * Un modulo di un altro sito non può aggiungerla senza un preflight CORS che
 * questo server non concede: è la protezione contro il CSRF.
 */
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-aqf'] !== '1') {
    await reply.code(403).send({ errore: 'csrf', messaggio: 'Richiesta non valida.' });
  }
});

app.addHook('onSend', async (req, reply, corpo) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'same-origin');
  reply.header('x-frame-options', 'SAMEORIGIN');
  reply.header('permissions-policy', 'microphone=(self), camera=()');
  if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  return corpo;
});

app.get('/api/salute', async () => ({ ok: true }));
// La radice è una cartella per il server statico: la pagina la serve questa rotta.
app.get('/', async (_req, reply) => {
  if (!webPresente) return reply.code(404).send({ errore: 'non_trovato', messaggio: 'Interfaccia web non compilata.' });
  reply.header('cache-control', 'no-cache');
  return reply.sendFile('index.html');
});
await app.register(rotteAccesso);
await app.register(rotteUtenti);
await app.register(rotteLibreria);
await app.register(rotteRegistrazioni);
await app.register(rotteSistema);
await app.register(rotteDiretta);

// L'applicazione web è a pagina singola: ogni indirizzo che non è un file o
// un'API restituisce index.html, e ci pensa il router del browser.
app.setNotFoundHandler(async (req, reply) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/') && webPresente) {
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  }
  return reply.code(404).send({ errore: 'non_trovato', messaggio: 'Risorsa non trovata.' });
});

app.setErrorHandler(async (err, req, reply) => {
  const e = err as Error & { statusCode?: number; code?: string };
  if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
    return reply.code(413).send({ errore: 'troppo_grande', messaggio: `File troppo grande: il limite è ${config.maxUploadMb} MB.` });
  }
  if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ errore: e.code ?? 'richiesta', messaggio: e.message });
  req.log.error(err);
  return reply.code(500).send({ errore: 'interno', messaggio: 'Errore interno del server.' });
});

db();
await assicuraVolumeIniziale();
riprendiConversioni();
chiudiRegistrazioniAbbandonate();
pulisciSessioniScadute();
setInterval(() => {
  chiudiRegistrazioniAbbandonate();
  pulisciSessioniScadute();
}, 15 * 60_000).unref();

const utenti = (db().prepare('SELECT COUNT(*) AS n FROM utente').get() as { n: number }).n;
if (utenti === 0) {
  app.log.warn('Nessun utente: creane uno con «npm run utente -- crea --email ... --nome ... --admin».');
}

const chiudi = async () => {
  await app.close();
  chiudiDb();
  process.exit(0);
};
process.on('SIGTERM', chiudi);
process.on('SIGINT', chiudi);

await app.listen({ host: config.host, port: config.port });
