import { getStroke } from 'perfect-freehand';

export type Strumento = 'penna' | 'evidenziatore' | 'riga' | 'freccia' | 'rettangolo' | 'ellisse' | 'laser' | 'gomma';

/**
 * Un segno sulla pagina.
 *
 * Le coordinate sono normalizzate sulla pagina (0..1 in x e in y), lo spessore
 * è in millesimi della larghezza: lo stesso segno si ridisegna identico sul
 * tablet, sul portatile e al proiettore, a qualunque ingrandimento.
 */
export interface Tratto {
  id: string;
  s: Exclude<Strumento, 'laser' | 'gomma'>;
  c: string;
  w: number;
  /** [x, y, pressione] */
  p: [number, number, number][];
}

/** Larghezza di riferimento del viewBox SVG: x va da 0 a 1000. */
export const LARGHEZZA = 1000;

export const COLORI = [
  { hex: '#e53935', nome: 'Rosso' },
  { hex: '#1e63d6', nome: 'Blu' },
  { hex: '#1b1b1b', nome: 'Nero' },
  { hex: '#2e9d4f', nome: 'Verde' },
  { hex: '#f2b705', nome: 'Giallo' },
  { hex: '#ffffff', nome: 'Bianco' },
];

export const SPESSORI = [
  { w: 1.6, nome: 'sottile' },
  { w: 3, nome: 'medio' },
  { w: 6, nome: 'marcato' },
];

function percorsoDaContorno(contorno: number[][]): string {
  if (contorno.length === 0) return '';
  const f = (n: number): string => n.toFixed(2);
  let d = `M ${f(contorno[0]![0]!)} ${f(contorno[0]![1]!)} Q`;
  for (let i = 0; i < contorno.length; i++) {
    const [x0, y0] = contorno[i]!;
    const [x1, y1] = contorno[(i + 1) % contorno.length]!;
    d += ` ${f(x0!)} ${f(y0!)} ${f((x0! + x1!) / 2)} ${f((y0! + y1!) / 2)}`;
  }
  return `${d} Z`;
}

/**
 * Il tratto a mano libera come forma piena (perfect-freehand), non come linea:
 * Safari, con i tanti segmenti corti della Pencil, lascia righe bianche nei
 * raccordi di una linea spessa. Una forma riempita non ne ha.
 */
export function contorno(t: Pick<Tratto, 'p' | 'w' | 's'>, altezza: number, finito = true, pressione = true): string {
  const passo = Math.max(0.5, t.w / 3);
  const punti: number[][] = [];
  for (let i = 0; i < t.p.length; i++) {
    const [x, y, pr] = t.p[i]!;
    const q = [x * LARGHEZZA, y * altezza, pr];
    const u = punti[punti.length - 1];
    if (!u || Math.hypot(q[0]! - u[0]!, q[1]! - u[1]!) >= passo) punti.push(q);
    else if (i === t.p.length - 1) punti[punti.length - 1] = q;
  }
  const evidenziatore = t.s === 'evidenziatore';
  return percorsoDaContorno(
    getStroke(punti, {
      size: evidenziatore ? t.w * 4 : t.w,
      thinning: evidenziatore || !pressione ? 0 : 0.45,
      smoothing: 0.6,
      streamline: 0.45,
      simulatePressure: false,
      last: finito,
      start: { cap: !evidenziatore },
      end: { cap: !evidenziatore },
    }),
  );
}

export type Forma = { tipo: 'path'; d: string } | { tipo: 'linea'; x1: number; y1: number; x2: number; y2: number; freccia: boolean } | { tipo: 'rett'; x: number; y: number; w: number; h: number } | { tipo: 'ellisse'; cx: number; cy: number; rx: number; ry: number };

/** Gli strumenti geometrici usano solo il primo e l'ultimo punto. */
export function forma(t: Tratto, altezza: number, finito = true): Forma {
  const a = t.p[0]!;
  const b = t.p[t.p.length - 1]!;
  const x1 = a[0] * LARGHEZZA;
  const y1 = a[1] * altezza;
  const x2 = b[0] * LARGHEZZA;
  const y2 = b[1] * altezza;
  switch (t.s) {
    case 'riga':
    case 'freccia':
      return { tipo: 'linea', x1, y1, x2, y2, freccia: t.s === 'freccia' };
    case 'rettangolo':
      return { tipo: 'rett', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    case 'ellisse':
      return { tipo: 'ellisse', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 };
    default:
      return { tipo: 'path', d: contorno(t, altezza, finito) };
  }
}

function distanzaSegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/** Vero se il punto (in unità del viewBox) tocca il tratto, entro `raggio`. */
export function tocca(t: Tratto, x: number, y: number, raggio: number, altezza: number): boolean {
  const r = raggio + (t.s === 'evidenziatore' ? t.w * 2 : t.w / 2);
  const P = t.p.map(([px, py]) => [px * LARGHEZZA, py * altezza] as const);
  if (P.length === 0) return false;
  const a = P[0]!;
  const b = P[P.length - 1]!;
  if (t.s === 'riga' || t.s === 'freccia') return distanzaSegmento(x, y, a[0], a[1], b[0], b[1]) <= r;
  if (t.s === 'rettangolo') {
    const [x1, y1, x2, y2] = [a[0], a[1], b[0], b[1]];
    return (
      distanzaSegmento(x, y, x1, y1, x2, y1) <= r ||
      distanzaSegmento(x, y, x2, y1, x2, y2) <= r ||
      distanzaSegmento(x, y, x2, y2, x1, y2) <= r ||
      distanzaSegmento(x, y, x1, y2, x1, y1) <= r
    );
  }
  if (t.s === 'ellisse') {
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const rx = Math.max(1e-6, Math.abs(b[0] - a[0]) / 2);
    const ry = Math.max(1e-6, Math.abs(b[1] - a[1]) / 2);
    // Distanza approssimata dal bordo: buona abbastanza per una gomma.
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(k - 1) * Math.min(rx, ry) <= r;
  }
  if (P.length === 1) return Math.hypot(x - a[0], y - a[1]) <= r;
  for (let i = 1; i < P.length; i++) {
    const p = P[i - 1]!;
    const q = P[i]!;
    if (distanzaSegmento(x, y, p[0], p[1], q[0], q[1]) <= r) return true;
  }
  return false;
}

/** Toglie i punti che non cambiano la forma (Ramer–Douglas–Peucker). */
export function semplifica(punti: [number, number, number][], tolleranza: number): [number, number, number][] {
  if (punti.length < 3) return punti;
  const tieni = new Uint8Array(punti.length);
  tieni[0] = 1;
  tieni[punti.length - 1] = 1;
  const pila: [number, number][] = [[0, punti.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop()!;
    const a = punti[i]!;
    const b = punti[j]!;
    let massimo = 0;
    let indice = -1;
    for (let k = i + 1; k < j; k++) {
      const p = punti[k]!;
      const d = distanzaSegmento(p[0], p[1], a[0], a[1], b[0], b[1]);
      if (d > massimo) {
        massimo = d;
        indice = k;
      }
    }
    if (massimo > tolleranza && indice > 0) {
      tieni[indice] = 1;
      pila.push([i, indice], [indice, j]);
    }
  }
  return punti.filter((_, k) => tieni[k]).map(([x, y, p]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5, Math.round(p * 100) / 100]);
}

export function nuovoId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
