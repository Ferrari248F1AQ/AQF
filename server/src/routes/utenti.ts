import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hashPassword, richiediAdmin, validaPassword, type Utente } from '../auth.js';
import { db, ora } from '../db.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function vista(u: Utente) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    ruolo: u.ruolo,
    attivo: Boolean(u.attivo),
    creato_il: u.creato_il,
    ultimo_accesso: u.ultimo_accesso,
  };
}

function adminAttivi(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM utente WHERE ruolo = 'admin' AND attivo = 1").get() as { n: number }).n;
}

export async function rotteUtenti(app: FastifyInstance): Promise<void> {
  app.get('/api/utenti', { preHandler: richiediAdmin }, async () =>
    (db().prepare('SELECT * FROM utente ORDER BY creato_il').all() as Utente[]).map(vista),
  );

  app.post<{ Body: { email?: string; nome?: string; password?: string; ruolo?: string } }>(
    '/api/utenti',
    { preHandler: richiediAdmin },
    async (req, reply) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const nome = String(req.body?.nome ?? '').trim();
      const ruolo = req.body?.ruolo === 'admin' ? 'admin' : 'utente';
      if (!EMAIL.test(email)) return reply.code(400).send({ errore: 'email', messaggio: 'Email non valida.' });
      if (!nome) return reply.code(400).send({ errore: 'nome', messaggio: 'Indica un nome.' });
      const errore = validaPassword(req.body?.password);
      if (errore) return reply.code(400).send({ errore: 'password_debole', messaggio: errore });
      if (db().prepare('SELECT 1 FROM utente WHERE email = ?').get(email)) {
        return reply.code(409).send({ errore: 'esiste', messaggio: 'Esiste già un utente con questa email.' });
      }
      const id = randomUUID();
      db()
        .prepare('INSERT INTO utente (id, email, nome, password, ruolo, creato_il) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, email, nome.slice(0, 120), await hashPassword(req.body!.password!), ruolo, ora());
      return vista(db().prepare('SELECT * FROM utente WHERE id = ?').get(id) as Utente);
    },
  );

  app.patch<{ Params: { id: string }; Body: { nome?: string; ruolo?: string; attivo?: boolean; password?: string } }>(
    '/api/utenti/:id',
    { preHandler: richiediAdmin },
    async (req, reply) => {
      const u = db().prepare('SELECT * FROM utente WHERE id = ?').get(req.params.id) as Utente | undefined;
      if (!u) return reply.code(404).send({ errore: 'inesistente', messaggio: 'Utente non trovato.' });
      const b = req.body ?? {};
      const togliAdmin = (b.ruolo === 'utente' || b.attivo === false) && u.ruolo === 'admin' && u.attivo;
      if (togliAdmin && adminAttivi() <= 1) {
        return reply.code(409).send({ errore: 'ultimo_admin', messaggio: 'Serve almeno un amministratore attivo.' });
      }
      if (typeof b.nome === 'string' && b.nome.trim()) db().prepare('UPDATE utente SET nome = ? WHERE id = ?').run(b.nome.trim().slice(0, 120), u.id);
      if (b.ruolo === 'admin' || b.ruolo === 'utente') db().prepare('UPDATE utente SET ruolo = ? WHERE id = ?').run(b.ruolo, u.id);
      if (typeof b.attivo === 'boolean') {
        db().prepare('UPDATE utente SET attivo = ? WHERE id = ?').run(b.attivo ? 1 : 0, u.id);
        if (!b.attivo) db().prepare('DELETE FROM sessione WHERE utente_id = ?').run(u.id);
      }
      if (b.password !== undefined) {
        const errore = validaPassword(b.password);
        if (errore) return reply.code(400).send({ errore: 'password_debole', messaggio: errore });
        db().prepare('UPDATE utente SET password = ? WHERE id = ?').run(await hashPassword(b.password), u.id);
        db().prepare('DELETE FROM sessione WHERE utente_id = ? AND id != ?').run(u.id, req.sessioneId ?? '');
      }
      return vista(db().prepare('SELECT * FROM utente WHERE id = ?').get(u.id) as Utente);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/utenti/:id', { preHandler: richiediAdmin }, async (req, reply) => {
    const u = db().prepare('SELECT * FROM utente WHERE id = ?').get(req.params.id) as Utente | undefined;
    if (!u) return reply.code(404).send({ errore: 'inesistente', messaggio: 'Utente non trovato.' });
    if (u.id === req.utente!.id) return reply.code(409).send({ errore: 'se_stesso', messaggio: 'Non puoi eliminare il tuo account.' });
    if (u.ruolo === 'admin' && u.attivo && adminAttivi() <= 1) {
      return reply.code(409).send({ errore: 'ultimo_admin', messaggio: 'Serve almeno un amministratore attivo.' });
    }
    const n = (
      db()
        .prepare(
          'SELECT (SELECT COUNT(*) FROM documento WHERE proprietario_id = ?) + (SELECT COUNT(*) FROM registrazione WHERE proprietario_id = ?) AS n',
        )
        .get(u.id, u.id) as { n: number }
    ).n;
    if (n > 0) {
      return reply.code(409).send({
        errore: 'ha_documenti',
        messaggio: `L'utente ha ancora ${n} fra documenti e registrazioni: disattivalo, oppure eliminali prima.`,
      });
    }
    db().prepare('DELETE FROM utente WHERE id = ?').run(u.id);
    return { ok: true };
  });
}
