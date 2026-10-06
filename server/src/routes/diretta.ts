import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { richiediUtente } from '../auth.js';

/**
 * La diretta: l'iPad presenta, il PC del proiettore fa da specchio.
 *
 * Una «stanza» per utente: lo specchio segue qualunque documento il suo
 * proprietario stia presentando, così in aula lo si apre una volta sola e
 * poi si passa da una lezione all'altra solo dall'iPad.
 *
 * Il server non interpreta i messaggi: li gira dal presentatore agli
 * specchi. Tiene solo l'ultimo stato (documento, pagina, vista), per chi si
 * collega a lezione già iniziata.
 */
interface Stanza {
  presentatori: Set<WebSocket>;
  specchi: Set<WebSocket>;
  stato: string | null;
}

const stanze = new Map<string, Stanza>();

function stanza(utente: string): Stanza {
  let s = stanze.get(utente);
  if (!s) {
    s = { presentatori: new Set(), specchi: new Set(), stato: null };
    stanze.set(utente, s);
  }
  return s;
}

function invia(ws: WebSocket, dati: string): void {
  // Uno specchio lento non deve far crescere la memoria del Raspberry:
  // oltre 1 MB in coda si saltano i messaggi intermedi (lo stato successivo li supera).
  if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(dati);
}

function annunciaPresenze(s: Stanza): void {
  const m = JSON.stringify({ tipo: 'presenze', specchi: s.specchi.size, presentatori: s.presentatori.size });
  for (const ws of [...s.presentatori, ...s.specchi]) invia(ws, m);
}

const TIPI_INOLTRATI = new Set(['stato', 'segni', 'tratto-inizio', 'tratto-punti', 'tratto-fine', 'laser']);

export async function rotteDiretta(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.get<{ Querystring: { ruolo?: string } }>(
    '/api/diretta',
    {
      websocket: true,
      preHandler: [
        // Contro il dirottamento da un altro sito: l'origine deve essere questa.
        async (req, reply) => {
          const origine = req.headers.origin;
          if (origine && new URL(origine).host !== req.headers.host) {
            await reply.code(403).send({ errore: 'origine', messaggio: 'Origine non consentita.' });
          }
        },
        richiediUtente,
      ],
    },
    (socket, req) => {
      const s = stanza(req.utente!.id);
      const specchio = req.query.ruolo === 'specchio';
      (specchio ? s.specchi : s.presentatori).add(socket);
      if (specchio && s.stato) invia(socket, s.stato);
      annunciaPresenze(s);

      // Tiene viva la connessione attraverso il tunnel (che chiude le inattive).
      const battito = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 25_000);

      socket.on('message', (grezzo: Buffer) => {
        if (specchio) return;
        const testo = grezzo.toString();
        let tipo: unknown;
        try {
          tipo = (JSON.parse(testo) as { tipo?: unknown }).tipo;
        } catch {
          return;
        }
        if (typeof tipo !== 'string' || !TIPI_INOLTRATI.has(tipo)) return;
        if (tipo === 'stato') s.stato = testo;
        for (const ws of s.specchi) invia(ws, testo);
      });

      socket.on('close', () => {
        clearInterval(battito);
        s.specchi.delete(socket);
        s.presentatori.delete(socket);
        annunciaPresenze(s);
      });
    },
  );
}
