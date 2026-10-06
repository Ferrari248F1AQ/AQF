import type { FastifyInstance, FastifyReply } from 'fastify';
import { richiediAdmin } from '../auth.js';
import { db } from '../db.js';
import {
  attivaVolume,
  avviaSpostamento,
  candidati,
  elencoVolumi,
  ErroreStorage,
  leggiSpostamento,
  raggiungibile,
  registraVolume,
  rimuoviVolume,
  spazio,
} from '../storage.js';

function rispondiErrore(reply: FastifyReply, err: unknown) {
  if (err instanceof ErroreStorage) return reply.code(400).send({ errore: err.codice, messaggio: err.message });
  throw err;
}

export async function rotteSistema(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', richiediAdmin);

  app.get('/api/archivi', async () => {
    const conteggi = db()
      .prepare(
        `SELECT v.id,
           (SELECT COUNT(*) FROM documento d WHERE d.volume_id = v.id) AS documenti,
           (SELECT COUNT(*) FROM registrazione r WHERE r.volume_id = v.id) AS registrazioni,
           (SELECT COALESCE(SUM(dimensione),0) FROM documento d WHERE d.volume_id = v.id)
             + (SELECT COALESCE(SUM(dimensione),0) FROM registrazione r WHERE r.volume_id = v.id) AS occupato
         FROM volume v`,
      )
      .all() as { id: string; documenti: number; registrazioni: number; occupato: number }[];
    const perId = new Map(conteggi.map((c) => [c.id, c]));
    const volumi = await Promise.all(
      elencoVolumi().map(async (v) => ({
        id: v.id,
        etichetta: v.etichetta,
        percorso: v.percorso,
        attivo: Boolean(v.attivo),
        raggiungibile: await raggiungibile(v),
        spazio: await spazio(v.percorso),
        documenti: perId.get(v.id)?.documenti ?? 0,
        registrazioni: perId.get(v.id)?.registrazioni ?? 0,
        occupato: perId.get(v.id)?.occupato ?? 0,
      })),
    );
    return { volumi, candidati: await candidati(), spostamento: leggiSpostamento() };
  });

  app.post<{ Body: { percorso?: string; etichetta?: string; attiva?: boolean } }>('/api/archivi', async (req, reply) => {
    const percorso = String(req.body?.percorso ?? '').trim();
    if (!percorso.startsWith('/')) return reply.code(400).send({ errore: 'percorso', messaggio: 'Indica un percorso assoluto.' });
    try {
      const v = await registraVolume(percorso, String(req.body?.etichetta ?? '').trim() || percorso, req.body?.attiva === true);
      return { id: v.id };
    } catch (err) {
      return rispondiErrore(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { sposta?: boolean } }>('/api/archivi/:id/attiva', async (req, reply) => {
    try {
      await attivaVolume(req.params.id);
      if (req.body?.sposta) avviaSpostamento(req.params.id);
      return { ok: true };
    } catch (err) {
      return rispondiErrore(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>('/api/archivi/:id/sposta-qui', async (req, reply) => {
    try {
      avviaSpostamento(req.params.id);
      return { ok: true };
    } catch (err) {
      return rispondiErrore(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/archivi/:id', async (req, reply) => {
    try {
      rimuoviVolume(req.params.id);
      return { ok: true };
    } catch (err) {
      return rispondiErrore(reply, err);
    }
  });
}
