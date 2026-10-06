export class ErroreApi extends Error {
  constructor(
    readonly stato: number,
    readonly codice: string,
    messaggio: string,
  ) {
    super(messaggio);
  }
}

/** Avvisa la sessione quando il server dice che non siamo più autenticati. */
let suNonAutenticato: (() => void) | null = null;
export function quandoNonAutenticato(f: () => void): void {
  suNonAutenticato = f;
}

export async function api<T>(metodo: string, percorso: string, corpo?: unknown, opzioni: { keepalive?: boolean } = {}): Promise<T> {
  const r = await fetch(percorso, {
    method: metodo,
    credentials: 'same-origin',
    keepalive: opzioni.keepalive,
    headers: {
      'x-aqf': '1',
      ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const testo = await r.text();
  let dati: any = null;
  try {
    dati = testo ? JSON.parse(testo) : null;
  } catch {
    dati = null;
  }
  if (!r.ok) {
    if (r.status === 401 && percorso !== '/api/accesso') suNonAutenticato?.();
    throw new ErroreApi(r.status, dati?.errore ?? 'http', dati?.messaggio ?? `Errore ${r.status}`);
  }
  return dati as T;
}

export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, c?: unknown) => api<T>('POST', p, c ?? {});
export const patch = <T,>(p: string, c: unknown) => api<T>('PATCH', p, c);
export const put = <T,>(p: string, c: unknown) => api<T>('PUT', p, c);
export const del = <T,>(p: string) => api<T>('DELETE', p);

/** Caricamento con avanzamento: fetch non lo dà, XMLHttpRequest sì. */
export function caricaFile(
  percorso: string,
  file: File[],
  suAvanzamento: (frazione: number) => void,
): Promise<{ creati: Documento[]; scartati: string[] }> {
  return new Promise((ok, ko) => {
    const dati = new FormData();
    for (const f of file) dati.append('file', f, f.name);
    const x = new XMLHttpRequest();
    x.open('POST', percorso);
    x.setRequestHeader('x-aqf', '1');
    x.upload.onprogress = (e) => e.lengthComputable && suAvanzamento(e.loaded / e.total);
    x.onload = () => {
      let r: any = null;
      try {
        r = JSON.parse(x.responseText);
      } catch {
        /* risposta non JSON */
      }
      if (x.status >= 200 && x.status < 300) ok(r);
      else ko(new ErroreApi(x.status, r?.errore ?? 'http', r?.messaggio ?? `Errore ${x.status}`));
    };
    x.onerror = () => ko(new ErroreApi(0, 'rete', 'Connessione interrotta durante il caricamento.'));
    x.send(dati);
  });
}

// --- Tipi ---------------------------------------------------------------------

export interface Impostazioni {
  cronometro: { attivo: boolean; minuti: number; sempreVisibile: boolean };
  registrazione: { automatica: boolean; indicatore: boolean };
  ditoDisegna: boolean;
}

export interface Profilo {
  id: string;
  email: string;
  nome: string;
  ruolo: 'admin' | 'utente';
  impostazioni: Impostazioni;
}

export interface Cartella {
  id: string;
  nome: string;
  genitore_id: string | null;
  creata_il: string;
}

export interface Documento {
  id: string;
  cartella_id: string | null;
  titolo: string;
  nome_originale: string;
  tipo: 'pdf' | 'pptx' | 'ppt' | 'odp' | 'key';
  dimensione: number;
  pagine: number | null;
  stato: 'in_conversione' | 'pronto' | 'errore';
  errore: string | null;
  anteprima: boolean;
  ultima_pagina: number;
  creato_il: string;
  aperto_il: string | null;
  registrazioni: number;
}

export interface Libreria {
  cartella: string | null;
  percorso: { id: string; nome: string }[];
  cartelle: Cartella[];
  documenti: Documento[];
}

export interface Registrazione {
  id: string;
  documento_id: string | null;
  documento_titolo: string | null;
  titolo: string;
  mime: string;
  dimensione: number;
  durata_s: number | null;
  pagine: { t: number; pagina: number }[];
  stato: 'in_corso' | 'conclusa';
  iniziata_il: string;
  conclusa_il: string | null;
}

export interface UtenteGestito {
  id: string;
  email: string;
  nome: string;
  ruolo: 'admin' | 'utente';
  attivo: boolean;
  creato_il: string;
  ultimo_accesso: string | null;
}

export interface Archivi {
  volumi: {
    id: string;
    etichetta: string;
    percorso: string;
    attivo: boolean;
    raggiungibile: boolean;
    spazio: { totale: number; libero: number } | null;
    documenti: number;
    registrazioni: number;
    occupato: number;
  }[];
  candidati: {
    percorso: string;
    dispositivo: string;
    tipo: string;
    sola_lettura: boolean;
    totale: number | null;
    libero: number | null;
    registrato: boolean;
  }[];
  spostamento: { in_corso: boolean; verso: string | null; fatti: number; totale: number; errori: string[]; concluso_il: string | null };
}

export function byte(n: number | null | undefined): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

export function durata(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—';
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}
