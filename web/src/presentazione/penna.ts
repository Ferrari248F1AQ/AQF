import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * La barra degli strumenti che compare avvicinando la penna al bordo sinistro
 * (la stessa regola di drAwQ).
 *
 * Gli iPad con Apple Pencil 2 o Pro sentono la punta qualche millimetro prima
 * che tocchi: Safari manda `pointermove` di tipo `pen` senza tasti premuti.
 * Con una Pencil di prima generazione, o con il dito, questi eventi non
 * arrivano mai: `capace` resta falso e la barra si apre dalla linguetta.
 *
 * La regola è di posizione, non di tempo, perché si possa prevedere: la barra
 * c'è mentre la punta sorvola la fascia sinistra dello schermo (o la barra
 * stessa) e se ne va quando la punta si sposta verso il foglio o lo tocca.
 * Lo stesso vale per il mouse su un portatile: avvicinarsi al bordo la apre.
 */
const FASCIA_PX = 90;
const MARGINE_USCITA_PX = 60;
/** Dieci secondi senza penna e un dito che tocca: la penna è stata posata. */
const DITO_DOPO_MS = 10_000;
const POSATA_DOPO_MS = 120_000;

export function usePennaVicina(zona: React.RefObject<HTMLElement | null>): {
  capace: boolean;
  vicina: boolean;
  mostra: () => void;
  nascondi: () => void;
} {
  const [capace, setCapace] = useState(false);
  const [vicina, setVicina] = useState(false);
  const aperta = useRef(false);
  const imposta = useCallback((v: boolean) => {
    aperta.current = v;
    setVicina(v);
  }, []);
  const ultimaPenna = useRef(0);

  useEffect(() => {
    const posata = (): void => {
      setCapace(false);
      imposta(false);
    };
    const controllo = setInterval(() => {
      if (ultimaPenna.current && Date.now() - ultimaPenna.current > POSATA_DOPO_MS) posata();
    }, 5000);
    const suMovimento = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      if (e.buttons !== 0) return;
      if (e.pointerType === 'pen') {
        ultimaPenna.current = Date.now();
        setCapace(true);
      }
      const sopraLaBarra = zona.current?.contains(e.target as Node) ?? false;
      const larghezza = zona.current?.getBoundingClientRect().width ?? FASCIA_PX;
      if (sopraLaBarra || e.clientX < FASCIA_PX) {
        if (!aperta.current) imposta(true);
      } else if (aperta.current && e.clientX > larghezza + MARGINE_USCITA_PX) {
        imposta(false);
      }
    };
    const suTocco = (e: PointerEvent): void => {
      if (e.pointerType === 'pen') ultimaPenna.current = Date.now();
      else if (e.pointerType === 'touch' && ultimaPenna.current && Date.now() - ultimaPenna.current > DITO_DOPO_MS) {
        posata();
        return;
      }
      if (zona.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-linguetta],[data-resta-aperta]')) return;
      if (aperta.current) imposta(false);
    };
    document.addEventListener('pointermove', suMovimento, true);
    document.addEventListener('pointerdown', suTocco, true);
    return () => {
      document.removeEventListener('pointermove', suMovimento, true);
      document.removeEventListener('pointerdown', suTocco, true);
      clearInterval(controllo);
    };
  }, [zona, imposta]);

  return {
    capace,
    vicina,
    mostra: useCallback(() => imposta(true), [imposta]),
    nascondi: useCallback(() => imposta(false), [imposta]),
  };
}
