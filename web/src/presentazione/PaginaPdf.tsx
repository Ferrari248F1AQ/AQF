import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/** iOS rifiuta i canvas oltre ~16,7 milioni di pixel: si resta sotto. */
const MAX_PIXEL = 12_000_000;

/**
 * Una pagina del PDF disegnata su un canvas.
 *
 * Si disegna fuori schermo e poi si copia: durante il cambio di pagina, o
 * quando si ridisegna più nitida dopo un ingrandimento, sullo schermo resta
 * la versione precedente invece di un lampo bianco.
 */
export function PaginaPdf({
  pdf,
  numero,
  larghezza,
  altezza,
  nitidezza,
  onPronta,
}: {
  pdf: PDFDocumentProxy;
  numero: number;
  /** Dimensioni CSS in cui la pagina è mostrata. */
  larghezza: number;
  altezza: number;
  /** Moltiplicatore per l'ingrandimento: a 2× serve il doppio dei pixel. */
  nitidezza: number;
  onPronta?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (larghezza <= 0 || altezza <= 0) return;
    let annullato = false;
    let compito: RenderTask | null = null;
    void (async () => {
      const pagina = await pdf.getPage(numero);
      if (annullato) return;
      const base = pagina.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      let scala = (larghezza / base.width) * dpr * nitidezza;
      const pixel = base.width * scala * base.height * scala;
      if (pixel > MAX_PIXEL) scala *= Math.sqrt(MAX_PIXEL / pixel);
      const vp = pagina.getViewport({ scale: scala });
      const fuori = document.createElement('canvas');
      fuori.width = Math.floor(vp.width);
      fuori.height = Math.floor(vp.height);
      const ctx = fuori.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, fuori.width, fuori.height);
      compito = pagina.render({ canvasContext: ctx, viewport: vp });
      try {
        await compito.promise;
      } catch {
        return; // annullato da un ridisegno più recente
      }
      if (annullato || !canvas.current) return;
      const c = canvas.current;
      c.width = fuori.width;
      c.height = fuori.height;
      c.getContext('2d')?.drawImage(fuori, 0, 0);
      // Libera subito la memoria del canvas di lavoro (Safari è avaro).
      fuori.width = 0;
      fuori.height = 0;
      onPronta?.();
      // La pagina dopo si prepara mentre si parla di questa.
      if (numero < pdf.numPages) void pdf.getPage(numero + 1);
    })();
    return () => {
      annullato = true;
      compito?.cancel();
    };
  }, [pdf, numero, larghezza, altezza, nitidezza, onPronta]);

  return (
    <canvas
      ref={canvas}
      style={{ width: larghezza, height: altezza, display: 'block', background: '#fff' }}
      aria-label={`Pagina ${numero}`}
    />
  );
}
