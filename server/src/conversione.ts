import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rename, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db } from './db.js';
import { percorsoFile, preparaCartella } from './storage.js';

const esegui = promisify(execFile);

/**
 * La coda delle conversioni: una alla volta.
 *
 * LibreOffice su un Pi 5 converte una presentazione di 40 slide in 10-30
 * secondi e occupa qualche centinaio di MB: due in parallelo rallenterebbero
 * le altre webapp del Raspberry senza finire prima.
 */
const coda: string[] = [];
let attiva = false;

export function accodaConversione(documentoId: string): void {
  coda.push(documentoId);
  void prossima();
}

async function prossima(): Promise<void> {
  if (attiva) return;
  const id = coda.shift();
  if (!id) return;
  attiva = true;
  try {
    await converti(id);
  } finally {
    attiva = false;
    void prossima();
  }
}

interface Riga {
  id: string;
  tipo: string;
  volume_id: string;
}

async function converti(id: string): Promise<void> {
  const d = db().prepare('SELECT id, tipo, volume_id FROM documento WHERE id = ?').get(id) as Riga | undefined;
  if (!d) return;
  const originale = percorsoFile(d.volume_id, 'documenti', `${d.id}.${d.tipo}`);
  const pdf = percorsoFile(d.volume_id, 'documenti', `${d.id}.pdf`);
  const lavoro = await mkdtemp(join(tmpdir(), 'aqf-conv-'));
  try {
    // Un profilo utente di LibreOffice usa e getta: il servizio non ha una home
    // scrivibile, e due istanze sullo stesso profilo si bloccano a vicenda.
    const sorgente = join(lavoro, `sorgente.${d.tipo}`);
    await copyFile(originale, sorgente);
    await esegui(
      config.soffice,
      [
        `-env:UserInstallation=file://${join(lavoro, 'profilo')}`,
        '--headless',
        '--norestore',
        '--convert-to',
        'pdf',
        '--outdir',
        lavoro,
        sorgente,
      ],
      { timeout: 5 * 60_000, env: { ...process.env, HOME: lavoro } },
    );
    const prodotto = (await readdir(lavoro)).find((f) => f.endsWith('.pdf'));
    if (!prodotto) throw new Error('LibreOffice non ha prodotto il PDF');
    await preparaCartella(pdf);
    await copyFile(join(lavoro, prodotto), `${pdf}.tmp`);
    await rename(`${pdf}.tmp`, pdf);
    db().prepare("UPDATE documento SET stato = 'pronto', errore = NULL WHERE id = ?").run(id);
    await dopoPdf(id);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const messaggio =
      e.code === 'ENOENT'
        ? 'LibreOffice non è installato sul Raspberry (sudo apt install libreoffice-impress).'
        : `Conversione non riuscita: ${e.message.slice(0, 300)}`;
    db().prepare("UPDATE documento SET stato = 'errore', errore = ? WHERE id = ?").run(messaggio, id);
  } finally {
    await rm(lavoro, { recursive: true, force: true });
  }
}

/**
 * Anteprima della prima pagina e numero di pagine, con poppler-utils se c'è.
 * Senza, la libreria mostra un'icona al posto della miniatura: non è un errore.
 */
export async function dopoPdf(id: string): Promise<void> {
  const d = db().prepare('SELECT id, volume_id FROM documento WHERE id = ?').get(id) as Riga | undefined;
  if (!d) return;
  const pdf = percorsoFile(d.volume_id, 'documenti', `${d.id}.pdf`);
  const png = percorsoFile(d.volume_id, 'anteprime', `${d.id}.png`);
  try {
    await preparaCartella(png);
    const base = png.slice(0, -4);
    await esegui(config.pdftoppm, ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '480', pdf, base], {
      timeout: 60_000,
    });
    db().prepare('UPDATE documento SET anteprima = 1 WHERE id = ?').run(id);
  } catch {
    /* poppler-utils assente o PDF strano: niente miniatura */
  }
  try {
    const { stdout } = await esegui('pdfinfo', [pdf], { timeout: 30_000 });
    const m = /Pages:\s+(\d+)/.exec(stdout);
    if (m) db().prepare('UPDATE documento SET pagine = ? WHERE id = ?').run(Number(m[1]), id);
  } catch {
    /* il numero di pagine lo scrive il visore alla prima apertura */
  }
}

/** Al riavvio le conversioni interrotte ripartono. */
export function riprendiConversioni(): void {
  const righe = db().prepare("SELECT id FROM documento WHERE stato = 'in_conversione'").all() as { id: string }[];
  for (const r of righe) accodaConversione(r.id);
}
