import type { FastifyInstance } from 'fastify';
import {
  azzeraTentativi,
  bloccato,
  confrontoFinto,
  COOKIE,
  creaSessione,
  hashPassword,
  impostaCookie,
  registraFallimento,
  richiediUtente,
  validaPassword,
  verificaPassword,
  type Utente,
} from '../auth.js';
import { db } from '../db.js';
import { normalizza, unisci } from '../impostazioni.js';

export function profilo(u: Utente) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    ruolo: u.ruolo,
    impostazioni: normalizza(JSON.parse(u.impostazioni || '{}')),
  };
}

export async function rotteAccesso(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string } }>('/api/accesso', async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const chiavi = [`ip:${req.ip}`, `email:${email}`];
    if (bloccato(chiavi)) {
      return reply.code(429).send({ errore: 'troppi_tentativi', messaggio: 'Troppi tentativi: riprova fra un quarto d’ora.' });
    }
    const riga = db().prepare('SELECT * FROM utente WHERE email = ?').get(email) as (Utente & { password: string }) | undefined;
    const ok = riga ? await verificaPassword(password, riga.password) : (await confrontoFinto(password), false);
    if (!riga || !ok || !riga.attivo) {
      registraFallimento(chiavi);
      return reply.code(401).send({ errore: 'credenziali', messaggio: 'Email o password non corrette.' });
    }
    azzeraTentativi(chiavi);
    const s = creaSessione(riga.id, req.headers['user-agent']);
    impostaCookie(req, reply, s.id, s.scade);
    return profilo(riga);
  });

  app.post('/api/uscita', { preHandler: richiediUtente }, async (req, reply) => {
    db().prepare('DELETE FROM sessione WHERE id = ?').run(req.sessioneId);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/io', { preHandler: richiediUtente }, async (req) => profilo(req.utente!));

  app.patch<{ Body: { impostazioni?: unknown; nome?: string } }>('/api/io', { preHandler: richiediUtente }, async (req) => {
    const u = req.utente!;
    if (req.body?.impostazioni !== undefined) {
      const nuove = unisci(normalizza(JSON.parse(u.impostazioni || '{}')), req.body.impostazioni);
      db().prepare('UPDATE utente SET impostazioni = ? WHERE id = ?').run(JSON.stringify(nuove), u.id);
    }
    if (typeof req.body?.nome === 'string' && req.body.nome.trim()) {
      db().prepare('UPDATE utente SET nome = ? WHERE id = ?').run(req.body.nome.trim().slice(0, 120), u.id);
    }
    const aggiornato = db().prepare('SELECT * FROM utente WHERE id = ?').get(u.id) as Utente;
    return profilo(aggiornato);
  });

  app.post<{ Body: { attuale?: string; nuova?: string } }>('/api/io/password', { preHandler: richiediUtente }, async (req, reply) => {
    const u = db().prepare('SELECT * FROM utente WHERE id = ?').get(req.utente!.id) as Utente & { password: string };
    if (!(await verificaPassword(String(req.body?.attuale ?? ''), u.password))) {
      return reply.code(400).send({ errore: 'password_attuale', messaggio: 'La password attuale non è corretta.' });
    }
    const errore = validaPassword(req.body?.nuova);
    if (errore) return reply.code(400).send({ errore: 'password_debole', messaggio: errore });
    db().prepare('UPDATE utente SET password = ? WHERE id = ?').run(await hashPassword(req.body!.nuova!), u.id);
    // Le altre sessioni (un tablet perso, un browser dimenticato) vengono chiuse.
    db().prepare('DELETE FROM sessione WHERE utente_id = ? AND id != ?').run(u.id, req.sessioneId);
    return { ok: true };
  });
}
