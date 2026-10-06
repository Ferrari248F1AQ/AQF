import { randomUUID } from 'node:crypto';
import { appendFile, rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { richiediUtente } from '../auth.js';
import { db, ora } from '../db.js';
import { percorsoFile, preparaCartella, volumeAttivo } from '../storage.js';

interface Registrazione {
  id: string;
  proprietario_id: string;
  documento_id: string | null;
  titolo: string;
  mime: string;
  estensione: string;
  volume_id: string;
  dimensione: number;
  durata_s: number | null;
  pezzi: number;
  pagine: string;
  stato: 'in_corso' | 'conclusa';
  iniziata_il: string;
  aggiornata_il: string;
  conclusa_il: string | null;
}

function vista(r: Registrazione & { documento_titolo?: string | null }) {
  return {
    id: r.id,
    documento_id: r.documento_id,
    documento_titolo: r.documento_titolo ?? null,
    titolo: r.titolo,
    mime: r.mime,
    dimensione: r.dimensione,
    durata_s: r.durata_s,
    pagine: JSON.parse(r.pagine) as { t: number; pagina: number }[],
    stato: r.stato,
    iniziata_il: r.iniziata_il,
    conclusa_il: r.conclusa_il,
  };
}

function errore(reply: FastifyReply, codice: number, chiave: string, messaggio: string) {
  return reply.code(codice).send({ errore: chiave, messaggio });
}

function estensioneDa(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Una registrazione arriva a pezzi, uno ogni pochi secondi, e si accoda al
 * file sul disco man mano. Se il tablet si spegne o la rete cade a metà
 * lezione, quello che è già arrivato resta: non si perde un'ora di voce per
 * un ultimo invio fallito.
 */
export async function rotteRegistrazioni(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', richiediUtente);

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 32 * 1024 * 1024 }, (_req, corpo, fatto) =>
    fatto(null, corpo),
  );

  const di = (id: string, utente: string) =>
    db().prepare('SELECT * FROM registrazione WHERE id = ? AND proprietario_id = ?').get(id, utente) as Registrazione | undefined;

  app.get<{ Querystring: { documento?: string } }>('/api/registrazioni', async (req) => {
    const filtro = req.query.documento ? 'AND r.documento_id = ?' : '';
    const parametri = req.query.documento ? [req.utente!.id, req.query.documento] : [req.utente!.id];
    const righe = db()
      .prepare(
        `SELECT r.*, d.titolo AS documento_titolo FROM registrazione r LEFT JOIN documento d ON d.id = r.documento_id
         WHERE r.proprietario_id = ? ${filtro} ORDER BY r.iniziata_il DESC`,
      )
      .all(...parametri) as Registrazione[];
    return righe.map(vista);
  });

  app.post<{ Body: { documento_id?: string | null; mime?: string; titolo?: string } }>('/api/registrazioni', async (req, reply) => {
    const u = req.utente!.id;
    const docId = req.body?.documento_id ?? null;
    let titoloDoc: string | null = null;
    if (docId) {
      const d = db().prepare('SELECT titolo FROM documento WHERE id = ? AND proprietario_id = ?').get(docId, u) as
        | { titolo: string }
        | undefined;
      if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
      titoloDoc = d.titolo;
    }
    const mime = String(req.body?.mime ?? 'audio/webm').slice(0, 100);
    const quando = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' });
    const titolo = (req.body?.titolo?.trim() || `${titoloDoc ?? 'Lezione'} — ${quando}`).slice(0, 200);
    const id = randomUUID();
    const v = volumeAttivo();
    db()
      .prepare(
        `INSERT INTO registrazione (id, proprietario_id, documento_id, titolo, mime, estensione, volume_id, stato, iniziata_il, aggiornata_il)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'in_corso', ?, ?)`,
      )
      .run(id, u, docId, titolo, mime, estensioneDa(mime), v.id, ora(), ora());
    return vista(di(id, u)!);
  });

  app.put<{ Params: { id: string; n: string }; Body: Buffer }>('/api/registrazioni/:id/pezzi/:n', async (req, reply) => {
    const r = di(req.params.id, req.utente!.id);
    if (!r) return errore(reply, 404, 'inesistente', 'Registrazione non trovata.');
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 0) return errore(reply, 400, 'pezzo', 'Numero di pezzo non valido.');
    // Un pezzo già ricevuto (il client ha ritentato dopo un timeout) si ignora.
    if (n < r.pezzi) return { ok: true, pezzi: r.pezzi };
    if (n > r.pezzi) return errore(reply, 409, 'buco', `Manca il pezzo ${r.pezzi}.`);
    if (!Buffer.isBuffer(req.body)) return errore(reply, 400, 'corpo', 'Atteso un blocco audio.');
    const file = percorsoFile(r.volume_id, 'registrazioni', `${r.id}.${r.estensione}`);
    await preparaCartella(file);
    await appendFile(file, req.body);
    db()
      .prepare(
        "UPDATE registrazione SET pezzi = pezzi + 1, dimensione = dimensione + ?, aggiornata_il = ?, stato = 'in_corso' WHERE id = ?",
      )
      .run(req.body.length, ora(), r.id);
    return { ok: true, pezzi: r.pezzi + 1 };
  });

  app.post<{ Params: { id: string }; Body: { durata_s?: number; pagine?: { t: number; pagina: number }[] } }>(
    '/api/registrazioni/:id/fine',
    async (req, reply) => {
      const r = di(req.params.id, req.utente!.id);
      if (!r) return errore(reply, 404, 'inesistente', 'Registrazione non trovata.');
      const durata = Number(req.body?.durata_s);
      const pagine = Array.isArray(req.body?.pagine)
        ? req.body!.pagine.filter((p) => Number.isFinite(p?.t) && Number.isInteger(p?.pagina)).slice(0, 5000)
        : [];
      db()
        .prepare("UPDATE registrazione SET stato = 'conclusa', durata_s = ?, pagine = ?, conclusa_il = ?, aggiornata_il = ? WHERE id = ?")
        .run(Number.isFinite(durata) ? durata : null, JSON.stringify(pagine), ora(), ora(), r.id);
      return vista(di(r.id, req.utente!.id)!);
    },
  );

  app.patch<{ Params: { id: string }; Body: { titolo?: string; documento_id?: string | null } }>(
    '/api/registrazioni/:id',
    async (req, reply) => {
      const u = req.utente!.id;
      const r = di(req.params.id, u);
      if (!r) return errore(reply, 404, 'inesistente', 'Registrazione non trovata.');
      if (typeof req.body?.titolo === 'string' && req.body.titolo.trim()) {
        db().prepare('UPDATE registrazione SET titolo = ? WHERE id = ?').run(req.body.titolo.trim().slice(0, 200), r.id);
      }
      if (req.body && 'documento_id' in req.body) {
        const d = req.body.documento_id ?? null;
        if (d && !db().prepare('SELECT 1 FROM documento WHERE id = ? AND proprietario_id = ?').get(d, u)) {
          return errore(reply, 404, 'inesistente', 'Documento non trovato.');
        }
        db().prepare('UPDATE registrazione SET documento_id = ? WHERE id = ?').run(d, r.id);
      }
      return vista(di(r.id, u)!);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/registrazioni/:id', async (req, reply) => {
    const r = di(req.params.id, req.utente!.id);
    if (!r) return errore(reply, 404, 'inesistente', 'Registrazione non trovata.');
    await rm(percorsoFile(r.volume_id, 'registrazioni', `${r.id}.${r.estensione}`), { force: true });
    db().prepare('DELETE FROM registrazione WHERE id = ?').run(r.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { scarica?: string } }>('/api/registrazioni/:id/audio', async (req, reply) => {
    const r = di(req.params.id, req.utente!.id);
    if (!r) return errore(reply, 404, 'inesistente', 'Registrazione non trovata.');
    const file = percorsoFile(r.volume_id, 'registrazioni', `${r.id}.${r.estensione}`);
    try {
      await stat(file);
    } catch {
      return errore(reply, 404, 'file_assente', "Il file audio non si trova sull'archivio.");
    }
    if (req.query.scarica) {
      const nome = `${r.titolo.replace(/[\\/:*?"<>|]+/g, '-')}.${r.estensione}`;
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`);
    }
    reply.type(r.mime.split(';')[0] ?? 'audio/webm');
    return reply.sendFile(basename(file), dirname(file));
  });
}

/** Registrazioni rimaste aperte (tablet spento a metà): dopo un'ora senza pezzi si chiudono. */
export function chiudiRegistrazioniAbbandonate(): void {
  const limite = new Date(Date.now() - 3600_000).toISOString();
  db()
    .prepare("UPDATE registrazione SET stato = 'conclusa', conclusa_il = aggiornata_il WHERE stato = 'in_corso' AND aggiornata_il < ?")
    .run(limite);
}
