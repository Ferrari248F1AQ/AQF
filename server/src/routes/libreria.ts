import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { richiediUtente } from '../auth.js';
import { accodaConversione, dopoPdf } from '../conversione.js';
import { db, ora } from '../db.js';
import { percorsoFile, preparaCartella, volumeAttivo } from '../storage.js';

interface Cartella {
  id: string;
  proprietario_id: string;
  genitore_id: string | null;
  nome: string;
  creata_il: string;
}

interface Documento {
  id: string;
  proprietario_id: string;
  cartella_id: string | null;
  titolo: string;
  nome_originale: string;
  tipo: 'pdf' | 'pptx' | 'ppt' | 'odp' | 'key';
  volume_id: string;
  dimensione: number;
  pagine: number | null;
  stato: 'in_conversione' | 'pronto' | 'errore';
  errore: string | null;
  anteprima: number;
  ultima_pagina: number;
  creato_il: string;
  aperto_il: string | null;
}

const TIPI = new Set(['pdf', 'pptx', 'ppt', 'odp', 'key']);

function vistaDoc(d: Documento & { registrazioni?: number }) {
  return {
    id: d.id,
    cartella_id: d.cartella_id,
    titolo: d.titolo,
    nome_originale: d.nome_originale,
    tipo: d.tipo,
    dimensione: d.dimensione,
    pagine: d.pagine,
    stato: d.stato,
    errore: d.errore,
    anteprima: Boolean(d.anteprima),
    ultima_pagina: d.ultima_pagina,
    creato_il: d.creato_il,
    aperto_il: d.aperto_il,
    registrazioni: d.registrazioni ?? 0,
  };
}

const SELECT_DOC = `SELECT d.*, (SELECT COUNT(*) FROM registrazione r WHERE r.documento_id = d.id) AS registrazioni FROM documento d`;

function errore(reply: FastifyReply, codice: number, chiave: string, messaggio: string) {
  return reply.code(codice).send({ errore: chiave, messaggio });
}

function cartellaDi(id: string, utente: string): Cartella | undefined {
  return db().prepare('SELECT * FROM cartella WHERE id = ? AND proprietario_id = ?').get(id, utente) as Cartella | undefined;
}

function documentoDi(id: string, utente: string): Documento | undefined {
  return db().prepare('SELECT * FROM documento WHERE id = ? AND proprietario_id = ?').get(id, utente) as Documento | undefined;
}

function percorso(id: string | null, utente: string): { id: string; nome: string }[] {
  const out: { id: string; nome: string }[] = [];
  let attuale = id ? cartellaDi(id, utente) : undefined;
  while (attuale && out.length < 50) {
    out.unshift({ id: attuale.id, nome: attuale.nome });
    attuale = attuale.genitore_id ? cartellaDi(attuale.genitore_id, utente) : undefined;
  }
  return out;
}

/** Tutte le sottocartelle (compresa quella di partenza). */
function discendenti(id: string, utente: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    const figli = db()
      .prepare('SELECT id FROM cartella WHERE genitore_id = ? AND proprietario_id = ?')
      .all(out[i], utente) as { id: string }[];
    out.push(...figli.map((f) => f.id));
  }
  return out;
}

async function cancellaFileDocumento(d: Documento): Promise<void> {
  const nomi = [`${d.id}.pdf`, ...(d.tipo !== 'pdf' ? [`${d.id}.${d.tipo}`] : [])];
  for (const n of nomi) await rm(percorsoFile(d.volume_id, 'documenti', n), { force: true });
  await rm(percorsoFile(d.volume_id, 'anteprime', `${d.id}.png`), { force: true });
}

/** Il file si serve con le richieste parziali (Range): pdf.js lo legge a pezzi. */
async function inviaFile(reply: FastifyReply, file: string, opzioni: { scarica?: string; tipo?: string } = {}) {
  try {
    await stat(file);
  } catch {
    return errore(reply, 404, 'file_assente', "Il file non si trova sull'archivio: il disco è collegato?");
  }
  reply.header('cache-control', 'private, max-age=0, must-revalidate');
  if (opzioni.scarica) {
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opzioni.scarica)}`);
  }
  if (opzioni.tipo) reply.type(opzioni.tipo);
  return reply.sendFile(basename(file), dirname(file));
}

export async function rotteLibreria(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', richiediUtente);

  // --- Navigazione -----------------------------------------------------------

  app.get<{ Querystring: { cartella?: string; q?: string } }>('/api/libreria', async (req, reply) => {
    const u = req.utente!.id;
    const q = req.query.q?.trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      const documenti = db()
        .prepare(`${SELECT_DOC} WHERE d.proprietario_id = ? AND (d.titolo LIKE ? ESCAPE '\\' OR d.nome_originale LIKE ? ESCAPE '\\') ORDER BY d.titolo COLLATE NOCASE`)
        .all(u, like, like) as Documento[];
      const cartelle = db()
        .prepare(`SELECT * FROM cartella WHERE proprietario_id = ? AND nome LIKE ? ESCAPE '\\' ORDER BY nome COLLATE NOCASE`)
        .all(u, like) as Cartella[];
      return { cartella: null, percorso: [], cartelle: cartelle.map(vistaCartella), documenti: documenti.map(vistaDoc) };
    }
    const id = req.query.cartella && req.query.cartella !== 'radice' ? req.query.cartella : null;
    if (id && !cartellaDi(id, u)) return errore(reply, 404, 'inesistente', 'Cartella non trovata.');
    const cartelle = db()
      .prepare(`SELECT * FROM cartella WHERE proprietario_id = ? AND genitore_id IS ? ORDER BY nome COLLATE NOCASE`)
      .all(u, id) as Cartella[];
    const documenti = db()
      .prepare(`${SELECT_DOC} WHERE d.proprietario_id = ? AND d.cartella_id IS ? ORDER BY d.titolo COLLATE NOCASE`)
      .all(u, id) as Documento[];
    return {
      cartella: id,
      percorso: percorso(id, u),
      cartelle: cartelle.map(vistaCartella),
      documenti: documenti.map(vistaDoc),
    };
  });

  app.get('/api/recenti', async (req) => {
    const documenti = db()
      .prepare(`${SELECT_DOC} WHERE d.proprietario_id = ? AND d.aperto_il IS NOT NULL ORDER BY d.aperto_il DESC LIMIT 8`)
      .all(req.utente!.id) as Documento[];
    return documenti.map(vistaDoc);
  });

  /** Tutte le cartelle, per il selettore «Sposta in…». */
  app.get('/api/cartelle', async (req) => {
    const tutte = db()
      .prepare('SELECT * FROM cartella WHERE proprietario_id = ? ORDER BY nome COLLATE NOCASE')
      .all(req.utente!.id) as Cartella[];
    return tutte.map(vistaCartella);
  });

  // --- Cartelle --------------------------------------------------------------

  app.post<{ Body: { nome?: string; genitore_id?: string | null } }>('/api/cartelle', async (req, reply) => {
    const u = req.utente!.id;
    const nome = String(req.body?.nome ?? '').trim().slice(0, 160);
    if (!nome) return errore(reply, 400, 'nome', 'Dai un nome alla cartella.');
    const genitore = req.body?.genitore_id ?? null;
    if (genitore && !cartellaDi(genitore, u)) return errore(reply, 404, 'inesistente', 'Cartella di destinazione non trovata.');
    const id = randomUUID();
    db()
      .prepare('INSERT INTO cartella (id, proprietario_id, genitore_id, nome, creata_il) VALUES (?, ?, ?, ?, ?)')
      .run(id, u, genitore, nome, ora());
    return vistaCartella(cartellaDi(id, u)!);
  });

  app.patch<{ Params: { id: string }; Body: { nome?: string; genitore_id?: string | null } }>(
    '/api/cartelle/:id',
    async (req, reply) => {
      const u = req.utente!.id;
      const c = cartellaDi(req.params.id, u);
      if (!c) return errore(reply, 404, 'inesistente', 'Cartella non trovata.');
      if (typeof req.body?.nome === 'string') {
        const nome = req.body.nome.trim().slice(0, 160);
        if (!nome) return errore(reply, 400, 'nome', 'Il nome non può essere vuoto.');
        db().prepare('UPDATE cartella SET nome = ? WHERE id = ?').run(nome, c.id);
      }
      if (req.body && 'genitore_id' in req.body) {
        const g = req.body.genitore_id ?? null;
        if (g && !cartellaDi(g, u)) return errore(reply, 404, 'inesistente', 'Cartella di destinazione non trovata.');
        if (g && discendenti(c.id, u).includes(g)) {
          return errore(reply, 400, 'ciclo', 'Non puoi spostare una cartella dentro se stessa.');
        }
        db().prepare('UPDATE cartella SET genitore_id = ? WHERE id = ?').run(g, c.id);
      }
      return vistaCartella(cartellaDi(c.id, u)!);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/cartelle/:id', async (req, reply) => {
    const u = req.utente!.id;
    const c = cartellaDi(req.params.id, u);
    if (!c) return errore(reply, 404, 'inesistente', 'Cartella non trovata.');
    const ids = discendenti(c.id, u);
    const segnaposti = ids.map(() => '?').join(',');
    const docs = db()
      .prepare(`SELECT * FROM documento WHERE proprietario_id = ? AND cartella_id IN (${segnaposti})`)
      .all(u, ...ids) as Documento[];
    for (const d of docs) await cancellaFileDocumento(d);
    db().transaction(() => {
      db().prepare(`DELETE FROM documento WHERE proprietario_id = ? AND cartella_id IN (${segnaposti})`).run(u, ...ids);
      db().prepare('DELETE FROM cartella WHERE id = ?').run(c.id);
    })();
    return { ok: true, documenti_eliminati: docs.length };
  });

  // --- Documenti -------------------------------------------------------------

  app.post<{ Querystring: { cartella?: string } }>('/api/documenti', async (req, reply) => {
    const u = req.utente!.id;
    const cartella = req.query.cartella && req.query.cartella !== 'radice' ? req.query.cartella : null;
    if (cartella && !cartellaDi(cartella, u)) return errore(reply, 404, 'inesistente', 'Cartella non trovata.');
    const volume = volumeAttivo();
    const creati: ReturnType<typeof vistaDoc>[] = [];
    const scartati: string[] = [];
    for await (const parte of req.files()) {
      const nome = parte.filename || 'documento';
      const tipo = extname(nome).slice(1).toLowerCase();
      if (!TIPI.has(tipo)) {
        parte.file.resume();
        scartati.push(`${nome}: formato non supportato (PDF, PPTX, PPT, ODP, KEY)`);
        continue;
      }
      const id = randomUUID();
      const dest = percorsoFile(volume.id, 'documenti', `${id}.${tipo}`);
      await preparaCartella(dest);
      await pipeline(parte.file, createWriteStream(dest));
      if (parte.file.truncated) {
        await rm(dest, { force: true });
        scartati.push(`${nome}: troppo grande`);
        continue;
      }
      const dimensione = (await stat(dest)).size;
      const titolo = nome.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Documento';
      db()
        .prepare(
          `INSERT INTO documento (id, proprietario_id, cartella_id, titolo, nome_originale, tipo, volume_id, dimensione, stato, creato_il)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, u, cartella, titolo.slice(0, 200), nome.slice(0, 255), tipo, volume.id, dimensione, tipo === 'pdf' ? 'pronto' : 'in_conversione', ora());
      if (tipo === 'pdf') await dopoPdf(id);
      else accodaConversione(id);
      creati.push(vistaDoc(documentoDi(id, u)!));
    }
    return { creati, scartati };
  });

  app.get<{ Params: { id: string } }>('/api/documenti/:id', async (req, reply) => {
    const d = db().prepare(`${SELECT_DOC} WHERE d.id = ? AND d.proprietario_id = ?`).get(req.params.id, req.utente!.id) as
      | Documento
      | undefined;
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    return { ...vistaDoc(d), percorso: percorso(d.cartella_id, req.utente!.id) };
  });

  app.patch<{
    Params: { id: string };
    Body: { titolo?: string; cartella_id?: string | null; ultima_pagina?: number; pagine?: number; aperto?: boolean };
  }>('/api/documenti/:id', async (req, reply) => {
    const u = req.utente!.id;
    const d = documentoDi(req.params.id, u);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    const b = req.body ?? {};
    if (typeof b.titolo === 'string') {
      const t = b.titolo.trim().slice(0, 200);
      if (!t) return errore(reply, 400, 'titolo', 'Il titolo non può essere vuoto.');
      db().prepare('UPDATE documento SET titolo = ? WHERE id = ?').run(t, d.id);
    }
    if ('cartella_id' in b) {
      const c = b.cartella_id ?? null;
      if (c && !cartellaDi(c, u)) return errore(reply, 404, 'inesistente', 'Cartella non trovata.');
      db().prepare('UPDATE documento SET cartella_id = ? WHERE id = ?').run(c, d.id);
    }
    if (Number.isInteger(b.ultima_pagina) && b.ultima_pagina! >= 1) {
      db().prepare('UPDATE documento SET ultima_pagina = ? WHERE id = ?').run(b.ultima_pagina, d.id);
    }
    if (Number.isInteger(b.pagine) && b.pagine! >= 1) db().prepare('UPDATE documento SET pagine = ? WHERE id = ?').run(b.pagine, d.id);
    if (b.aperto) db().prepare('UPDATE documento SET aperto_il = ? WHERE id = ?').run(ora(), d.id);
    return vistaDoc(documentoDi(d.id, u)!);
  });

  app.post<{ Params: { id: string } }>('/api/documenti/:id/riconverti', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    if (d.tipo === 'pdf') return errore(reply, 400, 'pdf', 'È già un PDF.');
    db().prepare("UPDATE documento SET stato = 'in_conversione', errore = NULL WHERE id = ?").run(d.id);
    accodaConversione(d.id);
    return vistaDoc(documentoDi(d.id, req.utente!.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/documenti/:id', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    await cancellaFileDocumento(d);
    db().prepare('DELETE FROM documento WHERE id = ?').run(d.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/documenti/:id/pdf', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    if (d.stato !== 'pronto') return errore(reply, 409, 'non_pronto', 'Il documento non è ancora pronto.');
    return inviaFile(reply, percorsoFile(d.volume_id, 'documenti', `${d.id}.pdf`), { tipo: 'application/pdf' });
  });

  app.get<{ Params: { id: string } }>('/api/documenti/:id/originale', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    return inviaFile(reply, percorsoFile(d.volume_id, 'documenti', `${d.id}.${d.tipo}`), { scarica: d.nome_originale });
  });

  app.get<{ Params: { id: string } }>('/api/documenti/:id/anteprima', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d || !d.anteprima) return errore(reply, 404, 'inesistente', 'Anteprima non disponibile.');
    return inviaFile(reply, percorsoFile(d.volume_id, 'anteprime', `${d.id}.png`), { tipo: 'image/png' });
  });

  // --- Annotazioni -----------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/documenti/:id/annotazioni', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    const righe = db().prepare('SELECT pagina, tratti FROM annotazione WHERE documento_id = ?').all(d.id) as {
      pagina: number;
      tratti: string;
    }[];
    return Object.fromEntries(righe.map((r) => [r.pagina, JSON.parse(r.tratti)]));
  });

  app.put<{ Params: { id: string; pagina: string }; Body: { tratti?: unknown } }>(
    '/api/documenti/:id/annotazioni/:pagina',
    { bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      const d = documentoDi(req.params.id, req.utente!.id);
      if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
      const pagina = Number(req.params.pagina);
      // Le pagine negative sono i fogli della lavagna del documento.
      if (!Number.isInteger(pagina) || pagina === 0 || Math.abs(pagina) > 100_000) {
        return errore(reply, 400, 'pagina', 'Pagina non valida.');
      }
      const tratti = req.body?.tratti;
      if (!Array.isArray(tratti)) return errore(reply, 400, 'tratti', 'Formato non valido.');
      if (tratti.length === 0) {
        db().prepare('DELETE FROM annotazione WHERE documento_id = ? AND pagina = ?').run(d.id, pagina);
      } else {
        db()
          .prepare(
            `INSERT INTO annotazione (documento_id, pagina, tratti, aggiornata_il) VALUES (?, ?, ?, ?)
             ON CONFLICT (documento_id, pagina) DO UPDATE SET tratti = excluded.tratti, aggiornata_il = excluded.aggiornata_il`,
          )
          .run(d.id, pagina, JSON.stringify(tratti), ora());
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/documenti/:id/annotazioni', async (req, reply) => {
    const d = documentoDi(req.params.id, req.utente!.id);
    if (!d) return errore(reply, 404, 'inesistente', 'Documento non trovato.');
    db().prepare('DELETE FROM annotazione WHERE documento_id = ?').run(d.id);
    return { ok: true };
  });
}

function vistaCartella(c: Cartella) {
  return { id: c.id, nome: c.nome, genitore_id: c.genitore_id, creata_il: c.creata_il };
}
