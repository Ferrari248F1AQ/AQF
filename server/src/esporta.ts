import { readFile } from 'node:fs/promises';
import { getStroke } from 'perfect-freehand';
import { BlendMode, LineCapStyle, PDFDocument, rgb, type PDFPage } from 'pdf-lib';

/**
 * Il PDF del documento con le annotazioni sopra, e in coda i fogli della lavagna.
 *
 * I segni si ridisegnano come vettori dentro le pagine: restano nitidi a ogni
 * ingrandimento, il testo originale resta selezionabile e il file pesa poco
 * più dell'originale. Il contorno del tratto a mano libera si calcola con la
 * stessa libreria e le stesse opzioni del visore, quindi nel PDF il tratto ha
 * la stessa forma che aveva sull'iPad.
 */

type Punto = [number, number, number];
interface Tratto {
  id: string;
  s: 'penna' | 'evidenziatore' | 'riga' | 'freccia' | 'rettangolo' | 'ellisse';
  c: string;
  w: number;
  p: Punto[];
}

/** Larghezza di riferimento dei segni: x va da 0 a 1000 (vedi web/src/presentazione/tratti.ts). */
const LARGHEZZA = 1000;
/** Il foglio della lavagna: A4 orizzontale, in punti. */
const FOGLIO_LAVAGNA = { w: 841.89, h: 595.28 };

function colore(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0xe53935;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Lo stesso contorno del visore (contorno() in tratti.ts). */
function contorno(t: Tratto, altezza: number): number[][] {
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
  return getStroke(punti, {
    size: evidenziatore ? t.w * 4 : t.w,
    thinning: evidenziatore ? 0 : 0.45,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: false,
    last: true,
    start: { cap: !evidenziatore },
    end: { cap: !evidenziatore },
  });
}

/**
 * Da coordinate del visore (x 0..1000, y 0..altezza, y verso il basso) a
 * coordinate della pagina PDF, tenendo conto del riquadro visibile e della
 * rotazione della pagina, come fa pdf.js quando la mostra.
 */
function trasformazione(page: PDFPage | null, altezzaVB: number) {
  if (!page) {
    const k = FOGLIO_LAVAGNA.w / LARGHEZZA;
    return { mappa: (x: number, y: number): [number, number] => [x * k, FOGLIO_LAVAGNA.h - y * k], scala: k };
  }
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const larghezzaVisibile = r === 90 || r === 270 ? box.height : box.width;
  const mappa = (x: number, y: number): [number, number] => {
    const u = x / LARGHEZZA;
    const v = y / altezzaVB;
    switch (r) {
      case 90:
        return [box.x + v * box.width, box.y + u * box.height];
      case 180:
        return [box.x + (1 - u) * box.width, box.y + v * box.height];
      case 270:
        return [box.x + (1 - v) * box.width, box.y + (1 - u) * box.height];
      default:
        return [box.x + u * box.width, box.y + (1 - v) * box.height];
    }
  };
  return { mappa, scala: larghezzaVisibile / LARGHEZZA };
}

function altezzaVisore(page: PDFPage | null): number {
  if (!page) return (LARGHEZZA * FOGLIO_LAVAGNA.h) / FOGLIO_LAVAGNA.w;
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const [w, h] = r === 90 || r === 270 ? [box.height, box.width] : [box.width, box.height];
  return (LARGHEZZA * h) / w;
}

/** drawSvgPath capovolge l'asse y: le coordinate PDF si passano con y negativa. */
const f = (n: number) => n.toFixed(2);

function disegna(page: PDFPage, tratti: Tratto[], sorgente: PDFPage | null): void {
  const altezza = altezzaVisore(sorgente);
  const { mappa, scala } = trasformazione(sorgente, altezza);
  const P = (x: number, y: number) => {
    const [a, b] = mappa(x, y);
    return `${f(a)} ${f(-b)}`;
  };
  for (const t of tratti) {
    if (!Array.isArray(t.p) || t.p.length === 0) continue;
    const c = colore(t.c);
    const a = t.p[0]!;
    const b = t.p[t.p.length - 1]!;
    const [x1, y1, x2, y2] = [a[0] * LARGHEZZA, a[1] * altezza, b[0] * LARGHEZZA, b[1] * altezza];
    const linea = { x: 0, y: 0, borderColor: c, borderWidth: t.w * scala, borderLineCap: LineCapStyle.Round };
    if (t.s === 'penna' || t.s === 'evidenziatore') {
      const o = contorno(t, altezza);
      if (o.length < 2) continue;
      let d = `M ${P(o[0]![0]!, o[0]![1]!)}`;
      for (let i = 0; i < o.length; i++) {
        const [px, py] = o[i]!;
        const [qx, qy] = o[(i + 1) % o.length]!;
        d += ` Q ${P(px!, py!)} ${P((px! + qx!) / 2, (py! + qy!) / 2)}`;
      }
      page.drawSvgPath(`${d} Z`, {
        x: 0,
        y: 0,
        color: c,
        ...(t.s === 'evidenziatore' ? { opacity: 0.35, blendMode: BlendMode.Multiply } : {}),
      });
    } else if (t.s === 'riga' || t.s === 'freccia') {
      let d = `M ${P(x1, y1)} L ${P(x2, y2)}`;
      if (t.s === 'freccia') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const l = Math.max(10, t.w * 5);
        d += ` M ${P(x2 - l * Math.cos(ang - 0.45), y2 - l * Math.sin(ang - 0.45))} L ${P(x2, y2)} L ${P(
          x2 - l * Math.cos(ang + 0.45),
          y2 - l * Math.sin(ang + 0.45),
        )}`;
      }
      page.drawSvgPath(d, linea);
    } else if (t.s === 'rettangolo') {
      page.drawSvgPath(`M ${P(x1, y1)} L ${P(x2, y1)} L ${P(x2, y2)} L ${P(x1, y2)} Z`, linea);
    } else if (t.s === 'ellisse') {
      const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2];
      let d = '';
      for (let i = 0; i <= 72; i++) {
        const k = (i / 72) * Math.PI * 2;
        d += `${i ? ' L' : 'M'} ${P(cx + rx * Math.cos(k), cy + ry * Math.sin(k))}`;
      }
      page.drawSvgPath(`${d} Z`, linea);
    }
  }
}

export async function pdfAnnotato(
  file: string,
  annotazioni: Map<number, unknown>,
  titolo: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await readFile(file), { ignoreEncryption: true });
  const pagine = pdf.getPages();
  for (const [n, tratti] of annotazioni) {
    if (n < 1 || n > pagine.length || !Array.isArray(tratti)) continue;
    const page = pagine[n - 1]!;
    disegna(page, tratti as Tratto[], page);
  }
  // I fogli della lavagna (pagine -1, -2…) in coda, in ordine.
  const fogli = [...annotazioni.keys()].filter((k) => k < 0).sort((a, b) => b - a);
  for (const k of fogli) {
    const tratti = annotazioni.get(k);
    if (!Array.isArray(tratti) || tratti.length === 0) continue;
    const page = pdf.addPage([FOGLIO_LAVAGNA.w, FOGLIO_LAVAGNA.h]);
    page.drawRectangle({ x: 0, y: 0, width: FOGLIO_LAVAGNA.w, height: FOGLIO_LAVAGNA.h, color: rgb(1, 1, 1) });
    disegna(page, tratti as Tratto[], null);
  }
  pdf.setTitle(`${titolo} (annotato)`);
  pdf.setProducer('AQF · PDF platform utility of UnivAQ');
  return pdf.save();
}
