import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from './config.js';
import { db, ora } from './db.js';

/** Sottocartella creata dentro ogni disco: i file della piattaforma non si mescolano con altro. */
export const CARTELLA = 'aqf-dati';

export interface Volume {
  id: string;
  etichetta: string;
  percorso: string;
  attivo: number;
  registrato_il: string;
}

export class ErroreStorage extends Error {
  constructor(
    readonly codice: string,
    messaggio: string,
  ) {
    super(messaggio);
  }
}

export function radice(v: Pick<Volume, 'percorso'>): string {
  return join(v.percorso, CARTELLA);
}

export function elencoVolumi(): Volume[] {
  return db().prepare('SELECT * FROM volume ORDER BY registrato_il').all() as Volume[];
}

export function volumePerId(id: string): Volume | undefined {
  return db().prepare('SELECT * FROM volume WHERE id = ?').get(id) as Volume | undefined;
}

export function volumeAttivo(): Volume {
  const v = db().prepare('SELECT * FROM volume WHERE attivo = 1').get() as Volume | undefined;
  if (!v) throw new ErroreStorage('nessun_volume', 'Nessun archivio attivo.');
  return v;
}

/** Al primo avvio l'archivio è la cartella dati interna: si parte senza dischi esterni. */
export async function assicuraVolumeIniziale(): Promise<void> {
  if (db().prepare('SELECT 1 FROM volume WHERE attivo = 1').get()) return;
  const primo = elencoVolumi()[0];
  if (primo) {
    db().prepare('UPDATE volume SET attivo = 1 WHERE id = ?').run(primo.id);
    return;
  }
  await registraVolume(config.dataDir, 'Disco interno', true);
}

async function verificaScrivibile(cartella: string): Promise<void> {
  const prova = join(cartella, `.prova-${randomUUID()}`);
  try {
    await writeFile(prova, 'ok');
    if ((await readFile(prova, 'utf8')) !== 'ok') throw new Error('rilettura diversa');
    await rm(prova);
  } catch (err) {
    throw new ErroreStorage(
      'non_scrivibile',
      `Non riesco a scrivere in ${cartella}: ${(err as Error).message}. ` +
        `Controlla che il disco sia montato in lettura/scrittura e che appartenga all'utente del servizio (aqf).`,
    );
  }
}

export async function registraVolume(percorso: string, etichetta: string, attivo = false): Promise<Volume> {
  const punto = resolve(percorso);
  const esistente = db().prepare('SELECT * FROM volume WHERE percorso = ?').get(punto) as Volume | undefined;
  if (esistente) throw new ErroreStorage('gia_registrato', `${punto} è già fra gli archivi («${esistente.etichetta}»).`);
  const cartella = join(punto, CARTELLA);
  try {
    await mkdir(cartella, { recursive: true });
  } catch (err) {
    const codice = (err as NodeJS.ErrnoException).code;
    if (codice === 'EROFS' || codice === 'EACCES' || codice === 'EPERM') {
      throw new ErroreStorage(
        'fuori_dai_percorsi_scrivibili',
        `Il servizio non può scrivere in ${punto}. Il servizio scrive solo sotto /var/lib/aqf, /srv/aqf, /media e /mnt ` +
          `e solo dove l'utente aqf ha i permessi: per un disco esterno il modo più semplice è montarlo sotto /srv/aqf ` +
          `(vedi deploy/README.md) oppure dare la cartella all'utente aqf con «sudo chown aqf:aqf ${punto}».`,
      );
    }
    throw new ErroreStorage('cartella_non_creata', `Non riesco a preparare ${cartella}: ${(err as Error).message}`);
  }
  await verificaScrivibile(cartella);
  const v: Volume = { id: randomUUID(), etichetta, percorso: punto, attivo: attivo ? 1 : 0, registrato_il: ora() };
  db().transaction(() => {
    if (attivo) db().prepare('UPDATE volume SET attivo = 0').run();
    db()
      .prepare('INSERT INTO volume (id, etichetta, percorso, attivo, registrato_il) VALUES (@id, @etichetta, @percorso, @attivo, @registrato_il)')
      .run(v);
  })();
  return v;
}

export async function attivaVolume(id: string): Promise<void> {
  const v = volumePerId(id);
  if (!v) throw new ErroreStorage('inesistente', 'Archivio non registrato.');
  await verificaScrivibile(radice(v));
  db().transaction(() => {
    db().prepare('UPDATE volume SET attivo = 0').run();
    db().prepare('UPDATE volume SET attivo = 1 WHERE id = ?').run(id);
  })();
}

export function rimuoviVolume(id: string): void {
  const v = volumePerId(id);
  if (!v) throw new ErroreStorage('inesistente', 'Archivio non registrato.');
  if (v.attivo) throw new ErroreStorage('attivo', 'Prima scegli un altro archivio come attivo.');
  const usato = db()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM documento WHERE volume_id = ?) + (SELECT COUNT(*) FROM registrazione WHERE volume_id = ?) AS n`,
    )
    .get(id, id) as { n: number };
  if (usato.n > 0) {
    throw new ErroreStorage('in_uso', `Su questo archivio ci sono ancora ${usato.n} file: spostali prima di toglierlo.`);
  }
  db().prepare('DELETE FROM volume WHERE id = ?').run(id);
}

export async function spazio(percorso: string): Promise<{ totale: number; libero: number } | null> {
  try {
    const s = await statfs(percorso);
    return { totale: s.blocks * s.bsize, libero: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

export async function raggiungibile(v: Volume): Promise<boolean> {
  try {
    await access(radice(v), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Filesystem che hanno senso come archivio: niente pseudo-filesystem, niente partizioni di avvio. */
const TIPI_DATI = new Set(['ext4', 'ext3', 'ext2', 'xfs', 'btrfs', 'f2fs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk']);
const ESCLUSI = ['/boot', '/boot/firmware', '/efi', '/snap', '/var/snap'];

export interface Candidato {
  percorso: string;
  dispositivo: string;
  tipo: string;
  sola_lettura: boolean;
  totale: number | null;
  libero: number | null;
  registrato: boolean;
}

/** I dischi montati sul Raspberry, letti da /proc/mounts. */
export async function candidati(): Promise<Candidato[]> {
  let testo = '';
  try {
    testo = await readFile('/proc/mounts', 'utf8');
  } catch {
    return [];
  }
  const registrati = new Set(elencoVolumi().map((v) => v.percorso));
  const visti = new Set<string>();
  const out: Candidato[] = [];
  for (const riga of testo.split('\n')) {
    const [dispositivo, puntoGrezzo, tipo, opzioni] = riga.split(' ');
    if (!dispositivo || !puntoGrezzo || !tipo || !opzioni) continue;
    if (!TIPI_DATI.has(tipo)) continue;
    // /proc/mounts codifica gli spazi come \040.
    const punto = puntoGrezzo.replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
    if (ESCLUSI.some((e) => punto === e || punto.startsWith(`${e}/`))) continue;
    if (visti.has(punto)) continue;
    visti.add(punto);
    const s = await spazio(punto);
    out.push({
      percorso: punto,
      dispositivo,
      tipo,
      sola_lettura: opzioni.split(',').includes('ro'),
      totale: s?.totale ?? null,
      libero: s?.libero ?? null,
      registrato: registrati.has(punto),
    });
  }
  return out;
}

// --- Percorsi dei file ------------------------------------------------------

export type Categoria = 'documenti' | 'anteprime' | 'registrazioni';

export function percorsoFile(volumeId: string, categoria: Categoria, nome: string): string {
  const v = volumePerId(volumeId);
  if (!v) throw new ErroreStorage('inesistente', 'Archivio del file non registrato.');
  return join(radice(v), categoria, nome);
}

export async function preparaCartella(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

// --- Spostamento dei dati fra archivi ---------------------------------------

export interface StatoSpostamento {
  in_corso: boolean;
  verso: string | null;
  fatti: number;
  totale: number;
  errori: string[];
  concluso_il: string | null;
}

const statoSpostamento: StatoSpostamento = {
  in_corso: false,
  verso: null,
  fatti: 0,
  totale: 0,
  errori: [],
  concluso_il: null,
};

export function leggiSpostamento(): StatoSpostamento {
  return { ...statoSpostamento, errori: [...statoSpostamento.errori] };
}

/** Un file con i nomi che usa su disco. */
interface Voce {
  tabella: 'documento' | 'registrazione';
  id: string;
  volume_id: string;
  file: { categoria: Categoria; nome: string }[];
}

function vociDaSpostare(destinazione: string): Voce[] {
  const docs = db()
    .prepare('SELECT id, volume_id, tipo, anteprima FROM documento WHERE volume_id != ?')
    .all(destinazione) as { id: string; volume_id: string; tipo: string; anteprima: number }[];
  const regs = db()
    .prepare("SELECT id, volume_id, estensione FROM registrazione WHERE volume_id != ? AND stato = 'conclusa'")
    .all(destinazione) as { id: string; volume_id: string; estensione: string }[];
  return [
    ...docs.map((d) => ({
      tabella: 'documento' as const,
      id: d.id,
      volume_id: d.volume_id,
      file: [
        { categoria: 'documenti' as const, nome: `${d.id}.pdf` },
        ...(d.tipo !== 'pdf' ? [{ categoria: 'documenti' as const, nome: `${d.id}.${d.tipo}` }] : []),
        ...(d.anteprima ? [{ categoria: 'anteprime' as const, nome: `${d.id}.png` }] : []),
      ],
    })),
    ...regs.map((r) => ({
      tabella: 'registrazione' as const,
      id: r.id,
      volume_id: r.volume_id,
      file: [{ categoria: 'registrazioni' as const, nome: `${r.id}.${r.estensione}` }],
    })),
  ];
}

/**
 * Copia ogni file sul nuovo archivio, verifica la dimensione, aggiorna la riga
 * e solo allora cancella l'originale: se il disco si stacca a metà, ogni file
 * è ancora leggibile da uno dei due posti.
 */
export function avviaSpostamento(destinazione: string): void {
  if (statoSpostamento.in_corso) throw new ErroreStorage('in_corso', 'Uno spostamento è già in corso.');
  if (!volumePerId(destinazione)) throw new ErroreStorage('inesistente', 'Archivio non registrato.');
  const voci = vociDaSpostare(destinazione);
  Object.assign(statoSpostamento, {
    in_corso: true,
    verso: destinazione,
    fatti: 0,
    totale: voci.length,
    errori: [],
    concluso_il: null,
  });
  void (async () => {
    for (const voce of voci) {
      try {
        const copiati: string[] = [];
        for (const f of voce.file) {
          const da = percorsoFile(voce.volume_id, f.categoria, f.nome);
          const a = percorsoFile(destinazione, f.categoria, f.nome);
          let presente = true;
          try {
            await stat(da);
          } catch {
            presente = false;
          }
          if (!presente) continue;
          await preparaCartella(a);
          await copyFile(da, a);
          if ((await stat(da)).size !== (await stat(a)).size) throw new Error(`copia incompleta di ${f.nome}`);
          copiati.push(da);
        }
        db().prepare(`UPDATE ${voce.tabella} SET volume_id = ? WHERE id = ?`).run(destinazione, voce.id);
        for (const da of copiati) await rm(da, { force: true });
      } catch (err) {
        statoSpostamento.errori.push(`${voce.tabella} ${voce.id}: ${(err as Error).message}`);
      }
      statoSpostamento.fatti++;
    }
    statoSpostamento.in_corso = false;
    statoSpostamento.concluso_il = ora();
  })();
}
