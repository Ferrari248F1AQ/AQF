import { useEffect, useRef, useState } from 'react';
import type { Tratto } from './tratti';

/** Pagina, vista e visibilità dei segni: quello che lo specchio deve copiare. */
export interface StatoDiretta {
  tipo: 'stato';
  documento: string;
  pagina: number;
  mostraSegni: boolean;
  /** Ingrandimento; x e y sono frazioni della pagina, così valgono a ogni risoluzione. */
  vista: { scala: number; x: number; y: number };
}

export type MessaggioDiretta =
  | StatoDiretta
  | { tipo: 'segni'; documento: string; pagina: number; tratti: Tratto[] }
  | { tipo: 'tratto-inizio'; pagina: number; tratto: Tratto }
  | { tipo: 'tratto-punti'; id: string; punti: Tratto['p']; sostituisci: boolean }
  | { tipo: 'tratto-fine'; id: string }
  | { tipo: 'laser'; punti: [number, number][] }
  | { tipo: 'presenze'; specchi: number; presentatori: number };

/**
 * Il canale verso il Raspberry. Se cade (Wi‑Fi dell'aula, tunnel che si
 * riconnette) riprova da solo, sempre più piano fino a 10 secondi; appena
 * torna, il presentatore rimanda lo stato e lo specchio si riallinea.
 */
export function useDiretta(ruolo: 'presentatore' | 'specchio', suMessaggio: (m: MessaggioDiretta) => void) {
  const ws = useRef<WebSocket | null>(null);
  const gestore = useRef(suMessaggio);
  gestore.current = suMessaggio;
  const [collegato, setCollegato] = useState(false);
  const [specchi, setSpecchi] = useState(0);
  const [presentatori, setPresentatori] = useState(0);

  useEffect(() => {
    let chiuso = false;
    let attesa = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apri = () => {
      const protocollo = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const s = new WebSocket(`${protocollo}//${location.host}/api/diretta?ruolo=${ruolo}`);
      ws.current = s;
      s.onopen = () => {
        attesa = 500;
        setCollegato(true);
      };
      s.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string) as MessaggioDiretta;
          if (m.tipo === 'presenze') {
            setSpecchi(m.specchi);
            setPresentatori(m.presentatori);
          }
          gestore.current(m);
        } catch {
          /* messaggio non valido: si ignora */
        }
      };
      s.onclose = () => {
        setCollegato(false);
        if (chiuso) return;
        timer = setTimeout(apri, attesa);
        attesa = Math.min(attesa * 2, 10_000);
      };
    };
    apri();
    return () => {
      chiuso = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [ruolo]);

  const invia = (m: MessaggioDiretta) => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
  };

  return { collegato, specchi, presentatori, invia };
}
