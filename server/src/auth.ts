import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, ora } from './db.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** N=2^15: ~60 ms su un core del Pi 5. Costoso offline, sostenibile online. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const k = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${k.toString('base64')}`;
}

export async function verificaPassword(password: string, salvata: string): Promise<boolean> {
  const p = salvata.split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const atteso = Buffer.from(p[5]!, 'base64');
  const k = await scryptAsync(password.normalize('NFKC'), Buffer.from(p[4]!, 'base64'), atteso.length, {
    N: Number(p[1]),
    r: Number(p[2]),
    p: Number(p[3]),
    maxmem: SCRYPT.maxmem,
  });
  return k.length === atteso.length && timingSafeEqual(k, atteso);
}

/** Usata quando l'email non esiste, perché il tempo di risposta non lo riveli. */
let hashFinto: string | null = null;
export async function confrontoFinto(password: string): Promise<void> {
  hashFinto ??= await hashPassword(randomUUID());
  await verificaPassword(password, hashFinto);
}

export const COOKIE = 'aqf_sess';

export interface Utente {
  id: string;
  email: string;
  nome: string;
  ruolo: 'admin' | 'utente';
  attivo: number;
  impostazioni: string;
  creato_il: string;
  ultimo_accesso: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    utente?: Utente;
    sessioneId?: string;
  }
}

export function creaSessione(utenteId: string, agente: string | undefined): { id: string; scade: Date } {
  const id = randomBytes(32).toString('base64url');
  const scade = new Date(Date.now() + config.sessionDays * 86400_000);
  db()
    .prepare('INSERT INTO sessione (id, utente_id, creata_il, scade_il, agente) VALUES (?, ?, ?, ?, ?)')
    .run(id, utenteId, ora(), scade.toISOString(), agente?.slice(0, 200) ?? null);
  db().prepare('UPDATE utente SET ultimo_accesso = ? WHERE id = ?').run(ora(), utenteId);
  return { id, scade };
}

export function impostaCookie(req: FastifyRequest, reply: FastifyReply, id: string, scade: Date): void {
  // Dietro il tunnel la richiesta arriva in HTTP da cloudflared: è
  // l'intestazione inoltrata a dire che il browser sta usando HTTPS.
  const https = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  reply.setCookie(COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: https,
    expires: scade,
  });
}

export function utenteDaSessione(id: string | undefined): Utente | undefined {
  if (!id) return undefined;
  const riga = db()
    .prepare(
      `SELECT u.*, s.scade_il FROM sessione s JOIN utente u ON u.id = s.utente_id
       WHERE s.id = ? AND u.attivo = 1`,
    )
    .get(id) as (Utente & { scade_il: string; password?: string }) | undefined;
  if (!riga) return undefined;
  if (new Date(riga.scade_il).getTime() < Date.now()) {
    db().prepare('DELETE FROM sessione WHERE id = ?').run(id);
    return undefined;
  }
  delete riga.password;
  return riga;
}

export async function richiediUtente(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = req.cookies[COOKIE];
  const u = utenteDaSessione(id);
  if (!u) {
    await reply.code(401).send({ errore: 'non_autenticato', messaggio: 'Accedi per continuare.' });
    return;
  }
  req.utente = u;
  req.sessioneId = id;
}

export async function richiediAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await richiediUtente(req, reply);
  if (reply.sent) return;
  if (req.utente?.ruolo !== 'admin') {
    await reply.code(403).send({ errore: 'vietato', messaggio: 'Serve un account amministratore.' });
  }
}

/**
 * Freno ai tentativi di accesso: la pagina è raggiungibile da Internet
 * attraverso il tunnel. Dieci tentativi falliti per IP o per email in un quarto
 * d'ora, poi si aspetta.
 */
const tentativi = new Map<string, { n: number; da: number }>();
const FINESTRA_MS = 15 * 60_000;
const MAX_TENTATIVI = 10;

export function bloccato(chiavi: string[]): boolean {
  const adesso = Date.now();
  return chiavi.some((k) => {
    const t = tentativi.get(k);
    return t !== undefined && adesso - t.da < FINESTRA_MS && t.n >= MAX_TENTATIVI;
  });
}

export function registraFallimento(chiavi: string[]): void {
  const adesso = Date.now();
  for (const k of chiavi) {
    const t = tentativi.get(k);
    if (!t || adesso - t.da >= FINESTRA_MS) tentativi.set(k, { n: 1, da: adesso });
    else t.n++;
  }
  if (tentativi.size > 10_000) tentativi.clear();
}

export function azzeraTentativi(chiavi: string[]): void {
  for (const k of chiavi) tentativi.delete(k);
}

export function pulisciSessioniScadute(): void {
  db().prepare('DELETE FROM sessione WHERE scade_il < ?').run(ora());
}

export function validaPassword(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 10) return 'La password deve avere almeno 10 caratteri.';
  if (p.length > 200) return 'Password troppo lunga.';
  return null;
}
