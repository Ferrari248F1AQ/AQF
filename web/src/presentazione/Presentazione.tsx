import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as EventoPuntatore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, get, patch, type Documento } from '../api';
import { avvisa } from '../dialoghi';
import { useSessione } from '../sessione';
import { Cronometro, useInizioLezione } from './Cronometro';
import { useDiretta, type MessaggioDiretta } from './diretta';
import { PaginaPdf } from './PaginaPdf';
import { usePennaVicina } from './penna';
import { Registratore, registrazioneSupportata } from './registratore';
import { esciSchermoIntero, useSchermoIntero } from './schermoIntero';
import { Tavolozza } from './Tavolozza';
import { forma, LARGHEZZA, nuovoId, semplifica, tocca, type Strumento, type Tratto } from './tratti';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Punto = [number, number, number];
type Vista = { scala: number; x: number; y: number };

const PREFERENZE = 'aqf.penna';
function preferenze(): { strumento: Strumento; colore: string; spessore: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFERENZE) ?? 'null');
    if (v?.strumento && v?.colore && v?.spessore) return v;
  } catch {
    /* niente */
  }
  return { strumento: 'penna', colore: '#e53935', spessore: 3 };
}

/** Dopo che la punta si alza, per quanto un tocco è ancora considerato il palmo. */
const PALMO_MS = 700;
/** Di quanto devono allargarsi (o stringersi) due dita prima di ingrandire. */
const SOGLIA_PIZZICO = 0.1;
/** Sotto questo ingrandimento, a dita alzate si torna a pagina intera. */
const SCATTO_SCALA = 1.25;
/** Il foglio della lavagna: A orizzontale (√2 : 1). */
const FOGLIO_LAVAGNA = { w: 1414, h: 1000 };

/** Quanto resta visibile il laser dopo che la punta è passata. */
const LASER_MS = 900;

/**
 * La presentazione: il documento a tutto schermo, con le annotazioni sopra.
 *
 * Chi la usa ha in mano la Pencil e davanti una classe: lo schermo deve
 * mostrare la pagina e nient'altro. La barra degli strumenti compare solo
 * avvicinando la punta al bordo sinistro; i comandi (uscita, pagine,
 * registrazione) compaiono con un tocco di dito al centro e se ne vanno da
 * soli. Il cronometro è un numero tenue nell'angolo, che si fa notare solo
 * quando si avvicina la pausa.
 *
 * Ruoli dei puntatori, come in drAwQ:
 * - **penna** e **mouse** disegnano con lo strumento scelto;
 * - **dito**: sfoglia (scorrimento orizzontale o tocco ai bordi), ingrandisce
 *   con due dita, apre i comandi con un tocco al centro. Disegna solo se lo si
 *   chiede, e mai mentre la penna è in uso: il palmo appoggiato non lascia segni.
 */
export default function Presentazione({ specchio = false }: { specchio?: boolean }) {
  const { id: idRotta = '' } = useParams();
  // Lo specchio non sceglie il documento: segue quello aperto sull'iPad.
  const [idSpecchio, setIdSpecchio] = useState<string | null>(null);
  const id = specchio ? (idSpecchio ?? '') : idRotta;
  const vai = useNavigate();
  const { utente, aggiornaImpostazioni } = useSessione();
  const imp = utente!.impostazioni;

  const [doc, setDoc] = useState<Documento | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /**
   * La lavagna: fogli bianchi del documento, numerati 1, 2, 3… e salvati come
   * pagine negative (-1, -2…) accanto alle annotazioni delle slide. Quando è
   * aperta, `chiave` indica il foglio della lavagna invece della slide.
   */
  const [lavagna, setLavagna] = useState<number | null>(null);
  const chiave = lavagna ? -lavagna : pagina;
  const [dimPagina, setDimPagina] = useState<{ w: number; h: number } | null>(null);
  const [schermo, setSchermo] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [annotazioni, setAnnotazioni] = useState<Record<number, Tratto[]>>({});
  const storia = useRef<Record<number, { indietro: Tratto[][]; avanti: Tratto[][] }>>({});
  const [, setVersioneStoria] = useState(0);
  const [mostraSegni, setMostraSegni] = useState(true);

  const iniziali = useMemo(preferenze, []);
  const [strumento, setStrumento] = useState<Strumento>(iniziali.strumento);
  const [colore, setColore] = useState(iniziali.colore);
  const [spessore, setSpessore] = useState(iniziali.spessore);
  useEffect(() => {
    try {
      localStorage.setItem(PREFERENZE, JSON.stringify({ strumento, colore, spessore }));
    } catch {
      /* niente */
    }
  }, [strumento, colore, spessore]);

  const [vista, setVista] = useState<Vista>({ scala: 1, x: 0, y: 0 });
  const [nitidezza, setNitidezza] = useState(1);
  const [inCorso, setInCorso] = useState<Tratto | null>(null);
  const [laser, setLaser] = useState<{ x: number; y: number; t: number }[]>([]);
  const [comandi, setComandi] = useState(false);

  // --- Diretta: l'iPad trasmette, lo specchio (il PC del proiettore) copia ---

  const remoto = useRef<Extract<MessaggioDiretta, { tipo: 'stato' }> | null>(null);
  const [vistaRemota, setVistaRemota] = useState<Vista>({ scala: 1, x: 0, y: 0 });
  const [inCorsoRemoto, setInCorsoRemoto] = useState<Tratto | null>(null);
  const timerRemoto = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const diretta = useDiretta(specchio ? 'specchio' : 'presentatore', (m) => {
    if (!specchio) return;
    switch (m.tipo) {
      case 'stato':
        remoto.current = m;
        setIdSpecchio(m.documento);
        setPagina(m.pagina);
        setLavagna(m.lavagna ?? null);
        setMostraSegni(m.mostraSegni);
        setVistaRemota(m.vista);
        break;
      case 'segni':
        if (m.documento !== remoto.current?.documento) return;
        setAnnotazioni((a) => ({ ...a, [m.pagina]: m.tratti }));
        setInCorsoRemoto((t) => (t && m.tratti.some((x) => x.id === t.id) ? null : t));
        break;
      case 'tratto-inizio':
        clearTimeout(timerRemoto.current);
        setInCorsoRemoto(m.tratto);
        break;
      case 'tratto-punti':
        setInCorsoRemoto((t) => (t && t.id === m.id ? { ...t, p: m.sostituisci ? m.punti : [...t.p, ...m.punti] } : t));
        break;
      case 'tratto-fine':
        // Di solito lo toglie l'arrivo dei segni salvati; questo è il ripiego
        // per un tratto scartato (una linea troppo corta, un pizzico).
        timerRemoto.current = setTimeout(() => setInCorsoRemoto((t) => (t?.id === m.id ? null : t)), 600);
        break;
      case 'laser': {
        const t = performance.now();
        setLaser((l) => [...l, ...m.punti.map(([x, y]) => ({ x, y, t }))]);
        break;
      }
    }
  });
  const trasmetti = (m: MessaggioDiretta) => {
    if (!specchio && diretta.specchi > 0) diretta.invia(m);
  };

  const barra = useRef<HTMLDivElement>(null);
  const foglio = useRef<HTMLDivElement>(null);
  const penna = usePennaVicina(barra);
  const schermoIntero = useSchermoIntero();
  const [inizioLezione, azzeraLezione] = useInizioLezione();

  // --- Caricamento -----------------------------------------------------------

  useEffect(() => {
    if (!id) return;
    let annullato = false;
    let caricato: PDFDocumentProxy | null = null;
    setPdf(null);
    setDimPagina(null);
    void (async () => {
      try {
        const d = await get<Documento>(`/api/documenti/${id}`);
        if (annullato) return;
        setDoc(d);
        const [p, a] = await Promise.all([
          pdfjs.getDocument({ url: `/api/documenti/${id}/pdf`, withCredentials: true, isEvalSupported: false }).promise,
          get<Record<string, Tratto[]>>(`/api/documenti/${id}/annotazioni`),
        ]);
        caricato = p;
        if (annullato) return void p.destroy();
        setAnnotazioni(Object.fromEntries(Object.entries(a).map(([k, v]) => [Number(k), v])));
        setPdf(p);
        const iniziale = specchio ? (remoto.current?.pagina ?? 1) : d.ultima_pagina;
        setPagina(Math.min(Math.max(1, iniziale), p.numPages));
        if (!specchio) {
          void patch(`/api/documenti/${id}`, { aperto: true, ...(d.pagine !== p.numPages ? { pagine: p.numPages } : {}) });
        }
      } catch (err) {
        if (!annullato) setErrore((err as Error).message);
      }
    })();
    return () => {
      annullato = true;
      void caricato?.destroy();
    };
  }, [id, specchio]);

  useEffect(() => {
    if (!pdf) return;
    let annullato = false;
    void pdf.getPage(pagina).then((p) => {
      if (annullato) return;
      const v = p.getViewport({ scale: 1 });
      setDimPagina({ w: v.width, h: v.height });
    });
    return () => {
      annullato = true;
    };
  }, [pdf, pagina]);

  useLayoutEffect(() => {
    const aggiorna = () => setSchermo({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', aggiorna);
    window.visualViewport?.addEventListener('resize', aggiorna);
    return () => {
      window.removeEventListener('resize', aggiorna);
      window.visualViewport?.removeEventListener('resize', aggiorna);
    };
  }, []);

  // La pagina riempie lo schermo senza deformarsi.
  // La lavagna ha le proporzioni di un foglio A orizzontale, uguali sull'iPad e
  // sul proiettore: i segni restano dove li si è fatti anche su schermi diversi.
  const dimVista = lavagna ? FOGLIO_LAVAGNA : dimPagina;
  const box = useMemo(() => {
    if (!dimVista) return null;
    const k = Math.min(schermo.w / dimVista.w, schermo.h / dimVista.h);
    return { w: Math.floor(dimVista.w * k), h: Math.floor(dimVista.h * k) };
  }, [dimVista, schermo]);
  const altezzaVB = dimVista ? (LARGHEZZA * dimVista.h) / dimVista.w : LARGHEZZA;

  const vistaVisibile: Vista =
    specchio && box ? { scala: vistaRemota.scala, x: vistaRemota.x * box.w, y: vistaRemota.y * box.h } : vista;

  // Ingranditi, la pagina si ridisegna più nitida quando il gesto si ferma.
  useEffect(() => {
    const t = setTimeout(() => setNitidezza(Math.min(4, Math.max(1, Math.round(vistaVisibile.scala * 2) / 2))), 250);
    return () => clearTimeout(t);
  }, [vistaVisibile.scala]);

  // Il presentatore manda lo stato a ogni cambio, e i segni della pagina
  // quando cambiano o quando si collega un nuovo specchio.
  useEffect(() => {
    if (specchio || !pdf || !box || !diretta.collegato) return;
    diretta.invia({
      tipo: 'stato',
      documento: id,
      pagina,
      lavagna,
      mostraSegni,
      vista: { scala: vista.scala, x: vista.x / box.w, y: vista.y / box.h },
    });
  }, [specchio, pdf, box, diretta.collegato, id, pagina, lavagna, mostraSegni, vista]); // eslint-disable-line react-hooks/exhaustive-deps
  const segniPagina = annotazioni[chiave];
  useEffect(() => {
    if (specchio || !pdf || !diretta.collegato || diretta.specchi === 0) return;
    diretta.invia({ tipo: 'segni', documento: id, pagina: chiave, tratti: segniPagina ?? [] });
  }, [specchio, pdf, diretta.collegato, diretta.specchi, id, chiave, segniPagina]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo schermo non si spegne durante la lezione.
  useEffect(() => {
    let blocco: { release: () => Promise<void> } | null = null;
    const chiedi = async () => {
      try {
        blocco = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
      } catch {
        /* non concesso: pazienza */
      }
    };
    void chiedi();
    const visibile = () => document.visibilityState === 'visible' && void chiedi();
    document.addEventListener('visibilitychange', visibile);
    return () => {
      document.removeEventListener('visibilitychange', visibile);
      void blocco?.release();
    };
  }, []);

  // --- Salvataggio delle annotazioni ----------------------------------------

  const daSalvare = useRef(new Set<number>());
  const ultimeAnnotazioni = useRef(annotazioni);
  ultimeAnnotazioni.current = annotazioni;
  const timerSalva = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const salva = useCallback(
    (keepalive = false) => {
      clearTimeout(timerSalva.current);
      const pagine = [...daSalvare.current];
      daSalvare.current.clear();
      for (const p of pagine) {
        void api('PUT', `/api/documenti/${id}/annotazioni/${p}`, { tratti: ultimeAnnotazioni.current[p] ?? [] }, { keepalive }).catch(() => {
          daSalvare.current.add(p);
          avvisa('Annotazioni non salvate: riprovo fra poco.');
          timerSalva.current = setTimeout(() => salva(), 5000);
        });
      }
    },
    [id],
  );

  useEffect(() => {
    const via = () => salva(true);
    window.addEventListener('pagehide', via);
    return () => {
      window.removeEventListener('pagehide', via);
      salva(true);
    };
  }, [salva]);

  const cambiaSegni = useCallback(
    (p: number, nuovi: Tratto[], storico = true) => {
      setAnnotazioni((prima) => {
        if (storico) {
          const s = (storia.current[p] ??= { indietro: [], avanti: [] });
          s.indietro.push(prima[p] ?? []);
          if (s.indietro.length > 100) s.indietro.shift();
          s.avanti = [];
        }
        return { ...prima, [p]: nuovi };
      });
      setVersioneStoria((v) => v + 1);
      daSalvare.current.add(p);
      clearTimeout(timerSalva.current);
      timerSalva.current = setTimeout(() => salva(), 800);
    },
    [salva],
  );

  const annulla = () => {
    const s = storia.current[chiave];
    const prima = s?.indietro.pop();
    if (!s || !prima) return;
    s.avanti.push(annotazioni[chiave] ?? []);
    cambiaSegni(chiave, prima, false);
  };
  const ripeti = () => {
    const s = storia.current[chiave];
    const dopo = s?.avanti.pop();
    if (!s || !dopo) return;
    s.indietro.push(annotazioni[chiave] ?? []);
    cambiaSegni(chiave, dopo, false);
  };

  // --- Pagine ----------------------------------------------------------------

  const registratore = useRef<Registratore | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const vaiA = useCallback(
    (n: number) => {
      if (!pdf) return;
      const p = Math.min(Math.max(1, n), pdf.numPages);
      setPagina(p);
      setVista({ scala: 1, x: 0, y: 0 });
      setInCorso(null);
      registratore.current?.segnaPagina(p);
    },
    [pdf],
  );

  /** Quanti fogli ha la lavagna: almeno uno, più quelli già scritti. */
  const fogliLavagna = Math.max(
    1,
    lavagna ?? 1,
    ...Object.keys(annotazioni)
      .map(Number)
      .filter((k) => k < 0 && (annotazioni[k]?.length ?? 0) > 0)
      .map((k) => -k),
  );
  const ultimaLavagna = useRef(1);

  const vaiALavagna = useCallback((n: number | null) => {
    setLavagna(n);
    if (n) ultimaLavagna.current = n;
    setVista({ scala: 1, x: 0, y: 0 });
    setInCorso(null);
    registratore.current?.segnaPagina(n ? -n : pagina);
  }, [pagina]);

  const alternaLavagna = useCallback(() => {
    vaiALavagna(lavagna ? null : ultimaLavagna.current);
  }, [lavagna, vaiALavagna]);

  /** Avanti/indietro: fra le slide, o fra i fogli della lavagna se è aperta. */
  const naviga = useCallback(
    (passo: 1 | -1) => {
      if (!lavagna) return vaiA(pagina + passo);
      const n = lavagna + passo;
      if (n < 1) return;
      // Dopo l'ultimo foglio se ne apre uno nuovo, ma solo se quello attuale è stato usato.
      if (n > fogliLavagna && (annotazioni[-lavagna]?.length ?? 0) === 0) return;
      vaiALavagna(n);
    },
    [lavagna, pagina, vaiA, fogliLavagna, annotazioni, vaiALavagna],
  );

  useEffect(() => {
    if (!pdf || specchio) return;
    const t = setTimeout(() => void patch(`/api/documenti/${id}`, { ultima_pagina: pagina }).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [pagina, pdf, id, specchio]);

  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (specchio) return;
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        naviga(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        naviga(-1);
      } else if (e.key === 'l' || e.key === 'L') alternaLavagna();
      else if (e.key === 'Home' && !lavagna) vaiA(1);
      else if (e.key === 'End' && pdf && !lavagna) vaiA(pdf.numPages);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ripeti();
        else annulla();
      }
    };
    window.addEventListener('keydown', tasto);
    return () => window.removeEventListener('keydown', tasto);
  });

  // --- Registrazione ---------------------------------------------------------

  const avviaRegistrazione = useCallback(async () => {
    const r = (registratore.current ??= new Registratore());
    r.onCambio = setRegistrando;
    r.onErrore = (m) => avvisa(`🎙️ ${m}`);
    try {
      await r.avvia(id, pagina);
    } catch (err) {
      const e = err as Error & { name?: string };
      avvisa(e.name === 'NotAllowedError' ? 'Microfono non concesso: abilitalo nelle impostazioni del browser.' : e.message);
    }
  }, [id, pagina]);

  const fermaRegistrazione = useCallback(async () => {
    try {
      const piena = await registratore.current?.ferma();
      avvisa(piena ? 'Registrazione salvata.' : 'Nessun audio ricevuto: la registrazione vuota non è stata salvata.');
    } catch (err) {
      avvisa(`Registrazione: ${(err as Error).message}`);
    }
  }, []);

  const avviataAuto = useRef(false);
  useEffect(() => {
    if (specchio || !pdf || avviataAuto.current || !imp.registrazione.automatica || !registrazioneSupportata()) return;
    avviataAuto.current = true;
    void avviaRegistrazione();
  }, [specchio, pdf, imp.registrazione.automatica, avviaRegistrazione]);

  useEffect(() => () => void registratore.current?.ferma().catch(() => undefined), []);

  // Mentre registra, il pulsante mostra tempo e audio già al sicuro sul
  // Raspberry: si vede subito se qualcosa non va, non a fine lezione.
  const [, setBattito] = useState(0);
  useEffect(() => {
    if (!registrando) return;
    const t = setInterval(() => setBattito((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [registrando]);
  const infoRegistrazione = (() => {
    const r = registratore.current;
    if (!r || !registrando) return '';
    const sec = Math.floor(r.secondi);
    const kb = Math.round(r.byteInviati / 1024);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`}`;
  })();

  const esci = async () => {
    salva(true);
    if (registratore.current?.attivo) await fermaRegistrazione();
    esciSchermoIntero();
    vai(doc?.cartella_id ? `/cartella/${doc.cartella_id}` : '/');
  };

  // --- Comandi che spariscono da soli ---------------------------------------

  const timerComandi = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mostraComandi = useCallback(() => {
    setComandi(true);
    clearTimeout(timerComandi.current);
    timerComandi.current = setTimeout(() => setComandi(false), 5000);
  }, []);
  const tieniComandi = () => comandi && mostraComandi();

  // --- Puntatori -------------------------------------------------------------

  /**
   * Ultimo *contatto* della penna con il vetro (non il sorvolo).
   *
   * Prima contava anche la punta che sorvola: con la Pencil in mano vicino allo
   * schermo ogni scorrimento del dito veniva preso per il palmo e ignorato, e
   * le slide sembravano non voler andare avanti.
   */
  const ultimaPenna = useRef(0);
  const pennaInTratto = useRef(false);
  const attivo = useRef<number | null>(null);
  const tratto = useRef<Tratto | null>(null);
  const tocchi = useRef(new Map<number, { x: number; y: number }>());
  const pizzico = useRef<{ distanza: number; centro: { x: number; y: number }; vista: Vista; avviato?: boolean } | null>(null);
  const trascina = useRef<{ id: number; x0: number; y0: number; t0: number; vista: Vista; mosso: boolean } | null>(null);
  const ultimoTap = useRef(0);

  const coordinate = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): Punto => {
    const r = foglio.current!.getBoundingClientRect();
    const pressione = e.pointerType === 'pen' && e.pressure ? e.pressure : 0.5;
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pressione];
  };

  const cancellaVicino = (p: Punto) => {
    const segni = ultimeAnnotazioni.current[chiave] ?? [];
    const r = foglio.current!.getBoundingClientRect();
    // ~14 px sullo schermo, qualunque sia l'ingrandimento.
    const raggio = (14 / r.width) * LARGHEZZA;
    const restano = segni.filter((t) => !tocca(t, p[0] * LARGHEZZA, p[1] * altezzaVB, raggio, altezzaVB));
    if (restano.length !== segni.length) cambiaSegni(chiave, restano);
  };

  const iniziaDisegno = (e: EventoPuntatore<HTMLDivElement>) => {
    if (!foglio.current) return;
    e.preventDefault();
    attivo.current = e.pointerId;
    pennaInTratto.current = e.pointerType === 'pen';
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* il tratto funziona anche senza cattura */
    }
    const p = coordinate(e);
    if (strumento === 'gomma') return cancellaVicino(p);
    if (strumento === 'laser') {
      trasmetti({ tipo: 'laser', punti: [[p[0], p[1]]] });
      return setLaser((l) => [...l, { x: p[0], y: p[1], t: performance.now() }]);
    }
    if (!mostraSegni) setMostraSegni(true);
    tratto.current = { id: nuovoId(), s: strumento, c: colore, w: spessore, p: [p] };
    trasmetti({ tipo: 'tratto-inizio', pagina: chiave, tratto: tratto.current });
    setInCorso(tratto.current);
  };

  const giu = (e: EventoPuntatore<HTMLDivElement>) => {
    if (e.pointerType === 'pen') {
      ultimaPenna.current = Date.now();
      pizzico.current = null;
      trascina.current = null;
      tocchi.current.clear();
      return iniziaDisegno(e);
    }
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      return iniziaDisegno(e);
    }
    // Dito. Mentre la penna scrive, o l'ha appena alzata, è il palmo: non conta.
    if (pennaInTratto.current || Date.now() - ultimaPenna.current < PALMO_MS) return;
    tocchi.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tocchi.current.size === 2) {
      // Il secondo dito trasforma tutto in un pizzico: il tratto del primo si annulla.
      if (attivo.current !== null) {
        if (tratto.current) trasmetti({ tipo: 'tratto-fine', id: tratto.current.id });
        attivo.current = null;
        tratto.current = null;
        setInCorso(null);
      }
      trascina.current = null;
      const [a, b] = [...tocchi.current.values()];
      pizzico.current = {
        distanza: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        centro: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        vista,
      };
      return;
    }
    if (tocchi.current.size > 2) return;
    const pennaPosata = Date.now() - ultimaPenna.current > 10_000;
    if (imp.ditoDisegna && pennaPosata) return iniziaDisegno(e);
    trascina.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Date.now(), vista, mosso: false };
  };

  const muovi = (e: EventoPuntatore<HTMLDivElement>) => {
    if (e.pointerType === 'pen' && e.buttons !== 0) ultimaPenna.current = Date.now();
    if (e.pointerType === 'touch' && tocchi.current.has(e.pointerId)) {
      tocchi.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const z = pizzico.current;
      if (z && tocchi.current.size === 2) {
        const [a, b] = [...tocchi.current.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const c = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        // Due dita appoggiate senza allargarle (il pollice, il palmo) non ingrandiscono.
        if (!z.avviato && Math.abs(d / z.distanza - 1) < SOGLIA_PIZZICO) return;
        z.avviato = true;
        const scala = Math.min(6, Math.max(1, (z.vista.scala * d) / z.distanza));
        const k = scala / z.vista.scala;
        // Il punto sotto le dita resta sotto le dita.
        const ox = z.centro.x - schermo.w / 2;
        const oy = z.centro.y - schermo.h / 2;
        setVista(
          scala <= 1.01
            ? { scala: 1, x: 0, y: 0 }
            : { scala, x: ox - (ox - z.vista.x) * k + (c.x - z.centro.x), y: oy - (oy - z.vista.y) * k + (c.y - z.centro.y) },
        );
        return;
      }
      const t = trascina.current;
      if (t && t.id === e.pointerId) {
        const dx = e.clientX - t.x0;
        const dy = e.clientY - t.y0;
        if (Math.hypot(dx, dy) > 10) t.mosso = true;
        if (t.vista.scala > 1) setVista({ ...t.vista, x: t.vista.x + dx, y: t.vista.y + dy });
        return;
      }
    }
    if (attivo.current !== e.pointerId) return;
    e.preventDefault();
    const nativi = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const nuovi = (nativi.length > 0 ? nativi : [e]).map((n) => coordinate(n as PointerEvent));
    if (strumento === 'gomma') return nuovi.forEach(cancellaVicino);
    if (strumento === 'laser') {
      const t = performance.now();
      trasmetti({ tipo: 'laser', punti: nuovi.map((p) => [p[0], p[1]]) });
      return setLaser((l) => [...l, ...nuovi.map((p) => ({ x: p[0], y: p[1], t }))]);
    }
    const tr = tratto.current;
    if (!tr) return;
    const libero = tr.s === 'penna' || tr.s === 'evidenziatore';
    tr.p = libero ? [...tr.p, ...nuovi] : [tr.p[0]!, nuovi[nuovi.length - 1]!];
    trasmetti({ tipo: 'tratto-punti', id: tr.id, punti: libero ? nuovi : tr.p, sostituisci: !libero });
    setInCorso({ ...tr });
  };

  const su = (e: EventoPuntatore<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      const t = trascina.current;
      tocchi.current.delete(e.pointerId);
      if (tocchi.current.size < 2 && pizzico.current) {
        pizzico.current = null;
        // Un ingrandimento appena accennato torna a pagina intera: invisibile,
        // bloccava lo scorrimento delle slide.
        setVista((v) => (v.scala < SCATTO_SCALA ? { scala: 1, x: 0, y: 0 } : v));
      }
      if (t && t.id === e.pointerId) {
        trascina.current = null;
        if (e.type !== 'pointerup') return;
        const dx = e.clientX - t.x0;
        const dy = e.clientY - t.y0;
        const dt = Date.now() - t.t0;
        if (t.vista.scala <= 1.01 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 1000) {
          naviga(dx < 0 ? 1 : -1);
          return;
        }
        if (!t.mosso && dt < 350) {
          const adesso = Date.now();
          if (adesso - ultimoTap.current < 320 && vista.scala > 1.01) {
            setVista({ scala: 1, x: 0, y: 0 });
            ultimoTap.current = 0;
            return;
          }
          ultimoTap.current = adesso;
          // Tocco ai bordi: pagina precedente / successiva (anche ingranditi); al centro: i comandi.
          if (e.clientX < schermo.w * 0.2) naviga(-1);
          else if (e.clientX > schermo.w * 0.8) naviga(1);
          else if (comandi) setComandi(false);
          else mostraComandi();
        }
      }
      if (attivo.current !== e.pointerId) return;
    }
    if (attivo.current !== e.pointerId) return;
    attivo.current = null;
    pennaInTratto.current = false;
    if (e.pointerType === 'pen') ultimaPenna.current = Date.now();
    const tr = tratto.current;
    tratto.current = null;
    setInCorso(null);
    if (tr) trasmetti({ tipo: 'tratto-fine', id: tr.id });
    if (!tr || e.type === 'pointercancel' && tr.p.length < 2) return;
    const a = tr.p[0]!;
    const b = tr.p[tr.p.length - 1]!;
    const geometrico = tr.s !== 'penna' && tr.s !== 'evidenziatore';
    if (geometrico && Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.004) return;
    const finale: Tratto = { ...tr, p: geometrico ? [a, b] : semplifica(tr.p, 0.0004 / vista.scala) };
    cambiaSegni(chiave, [...(ultimeAnnotazioni.current[chiave] ?? []), finale]);
  };

  const rotella = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const scala = Math.min(6, Math.max(1, vista.scala * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      setVista(scala < 1.05 ? { scala: 1, x: 0, y: 0 } : { ...vista, scala });
    }
  };

  // Il laser sfuma da solo.
  useEffect(() => {
    if (laser.length === 0) return;
    let raf = 0;
    const passo = () => {
      const limite = performance.now() - LASER_MS;
      setLaser((l) => (l.length && l[0]!.t < limite ? l.filter((p) => p.t >= limite) : l));
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [laser.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Disegno ---------------------------------------------------------------

  const segni = annotazioni[chiave] ?? [];
  const s = storia.current[chiave];

  const disegnaTratto = (t: Tratto, finito = true) => {
    const f = forma(t, altezzaVB, finito);
    const evid = t.s === 'evidenziatore';
    const largo = t.w;
    switch (f.tipo) {
      case 'path':
        return <path key={t.id} d={f.d} fill={t.c} opacity={evid ? 0.35 : 1} style={evid ? { mixBlendMode: 'multiply' } : undefined} />;
      case 'linea': {
        const ang = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
        const l = Math.max(10, largo * 5);
        return (
          <g key={t.id} stroke={t.c} strokeWidth={largo} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} />
            {f.freccia && (
              <polyline
                points={`${f.x2 - l * Math.cos(ang - 0.45)},${f.y2 - l * Math.sin(ang - 0.45)} ${f.x2},${f.y2} ${f.x2 - l * Math.cos(ang + 0.45)},${f.y2 - l * Math.sin(ang + 0.45)}`}
              />
            )}
          </g>
        );
      }
      case 'rett':
        return <rect key={t.id} x={f.x} y={f.y} width={f.w} height={f.h} stroke={t.c} strokeWidth={largo} fill="none" strokeLinejoin="round" />;
      case 'ellisse':
        return <ellipse key={t.id} cx={f.cx} cy={f.cy} rx={f.rx} ry={f.ry} stroke={t.c} strokeWidth={largo} fill="none" />;
    }
  };

  if (errore) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <p>{errore}</p>
        <button type="button" className="pulsante" onClick={() => vai('/')}>
          Torna alla libreria
        </button>
      </div>
    );
  }

  const totale = pdf?.numPages ?? 0;
  const barraVisibile = penna.vicina;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#111',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        overscrollBehavior: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* La superficie che riceve penna, mouse e dita. */}
      <div
        style={{ position: 'absolute', inset: 0, cursor: specchio ? 'default' : strumento === 'laser' ? 'none' : 'crosshair' }}
        onPointerDown={specchio ? undefined : giu}
        onPointerMove={specchio ? undefined : muovi}
        onPointerUp={specchio ? undefined : su}
        onPointerCancel={specchio ? undefined : su}
        onWheel={specchio ? undefined : rotella}
      >
        {pdf && box && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: box.w,
              height: box.h,
              transform: `translate(-50%, -50%) translate(${vistaVisibile.x}px, ${vistaVisibile.y}px) scale(${vistaVisibile.scala})`,
              transition: specchio ? 'transform .08s linear' : undefined,
              transformOrigin: 'center center',
              boxShadow: '0 0 40px rgba(0,0,0,.5)',
            }}
          >
            <div ref={foglio} style={{ position: 'absolute', inset: 0 }}>
              {lavagna ? (
                <div style={{ width: box.w, height: box.h, background: '#fff' }} aria-label={`Lavagna, foglio ${lavagna}`} />
              ) : (
                <PaginaPdf pdf={pdf} numero={pagina} larghezza={box.w} altezza={box.h} nitidezza={nitidezza} />
              )}
              <svg
                viewBox={`0 0 ${LARGHEZZA} ${altezzaVB}`}
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
              >
                {(mostraSegni || lavagna) && segni.map((t) => disegnaTratto(t))}
                {inCorso && disegnaTratto(inCorso, false)}
                {inCorsoRemoto && disegnaTratto(inCorsoRemoto, false)}
                {laser.length > 0 && (
                  <g>
                    <polyline
                      points={laser.map((p) => `${p.x * LARGHEZZA},${p.y * altezzaVB}`).join(' ')}
                      fill="none"
                      stroke="#ff1744"
                      strokeOpacity={0.55}
                      strokeWidth={6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ filter: 'drop-shadow(0 0 6px #ff1744)' }}
                    />
                    <circle
                      cx={laser[laser.length - 1]!.x * LARGHEZZA}
                      cy={laser[laser.length - 1]!.y * altezzaVB}
                      r={7}
                      fill="#ff1744"
                      style={{ filter: 'drop-shadow(0 0 8px #ff1744)' }}
                    />
                  </g>
                )}
              </svg>
            </div>
          </div>
        )}
        {!pdf && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', padding: 24, textAlign: 'center' }}>
            {specchio && !id
              ? diretta.collegato
                ? 'Specchio pronto. Apri una presentazione sull’iPad: comparirà qui.'
                : 'Collegamento al Raspberry…'
              : `Carico ${doc?.titolo ?? 'il documento'}…`}
          </div>
        )}
      </div>

      {specchio && <ComandiSpecchio collegato={diretta.collegato} presentatori={diretta.presentatori} titolo={doc?.titolo} onEsci={() => (esciSchermoIntero(), vai('/'))} />}
      {!specchio && (
      <>

      {/* Barra degli strumenti: compare avvicinando la penna (o il mouse) al bordo sinistro. */}
      <div
        ref={barra}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 6,
          display: 'flex',
          alignItems: 'center',
          paddingTop: 'env(safe-area-inset-top)',
          transform: barraVisibile ? 'none' : 'translateX(-100%)',
          opacity: barraVisibile ? 1 : 0,
          transition: 'transform .18s ease, opacity .18s ease',
          pointerEvents: barraVisibile ? 'auto' : 'none',
        }}
      >
        <Tavolozza
          strumento={strumento}
          colore={colore}
          spessore={spessore}
          onStrumento={setStrumento}
          onColore={(c) => {
            setColore(c);
            if (strumento === 'gomma' || strumento === 'laser') setStrumento('penna');
          }}
          onSpessore={setSpessore}
          onAnnulla={annulla}
          onRipeti={ripeti}
          onPulisci={() => segni.length > 0 && cambiaSegni(chiave, [])}
          lavagna={lavagna !== null}
          onLavagna={alternaLavagna}
          puoAnnullare={(s?.indietro.length ?? 0) > 0}
          puoRipetere={(s?.avanti.length ?? 0) > 0}
          haSegni={segni.length > 0}
          ditoDisegna={imp.ditoDisegna}
          onDito={(v) => void aggiornaImpostazioni({ ditoDisegna: v })}
        />
      </div>

      {/* La linguetta apre la barra a chi non ha una Pencil che sorvola. */}
      {comandi && !barraVisibile && (
        <button
          type="button"
          data-linguetta
          aria-label="Mostra gli strumenti"
          onClick={() => {
            penna.mostra();
            setComandi(false);
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 7,
            width: 26,
            height: 96,
            border: 'none',
            borderRadius: '0 12px 12px 0',
            background: 'rgba(28,28,26,.85)',
            color: '#fff',
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          ›
        </button>
      )}

      {/* Comandi: compaiono toccando il centro con un dito, spariscono da soli. */}
      <div
        data-resta-aperta
        onPointerDown={tieniComandi}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          zIndex: 7,
          padding: 'max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left))',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,0))',
          color: '#fff',
          transform: comandi ? 'none' : 'translateY(-100%)',
          opacity: comandi ? 1 : 0,
          transition: 'transform .2s ease, opacity .2s ease',
          pointerEvents: comandi ? 'auto' : 'none',
        }}
      >
        <BottoneComando onClick={() => void esci()} titolo="Esci dalla presentazione">
          ✕
        </BottoneComando>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lavagna ? `Lavagna · ${doc?.titolo ?? ''}` : doc?.titolo}
        </div>
        {diretta.specchi > 0 && (
          <span title="Proiettori che seguono questa presentazione" style={{ fontSize: 14, fontWeight: 700, opacity: 0.9, whiteSpace: 'nowrap' }}>
            📽 {diretta.specchi}
          </span>
        )}
        {registrazioneSupportata() && (
          <BottoneComando
            onClick={() => void (registrando ? fermaRegistrazione() : avviaRegistrazione())}
            titolo={registrando ? 'Ferma la registrazione' : 'Registra la voce'}
            attivo={registrando}
            largo
          >
            {registrando ? `■ Stop · ${infoRegistrazione}` : '🎙️ Registra'}
          </BottoneComando>
        )}
        <BottoneComando onClick={alternaLavagna} titolo={lavagna ? 'Torna alla slide (L)' : 'Apri la lavagna (L)'} attivo={lavagna !== null} coloreAttivo="#e3ab2f" largo>
          {lavagna ? '↩︎ Slide' : '⬜ Lavagna'}
        </BottoneComando>
        <BottoneComando onClick={() => setMostraSegni((v) => !v)} titolo={mostraSegni ? 'Nascondi le annotazioni' : 'Mostra le annotazioni'} attivo={!mostraSegni}>
          {mostraSegni ? '👁' : '🚫'}
        </BottoneComando>
        {!imp.cronometro.attivo && (
          <BottoneComando onClick={() => void aggiornaImpostazioni({ cronometro: { attivo: true } })} titolo="Mostra il cronometro">
            ⏱
          </BottoneComando>
        )}
        {schermoIntero.supportato && (
          <BottoneComando onClick={schermoIntero.alterna} titolo={schermoIntero.attivo ? 'Esci dallo schermo intero' : 'Schermo intero'}>
            {schermoIntero.attivo ? '⤡' : '⤢'}
          </BottoneComando>
        )}
      </div>

      <div
        data-resta-aperta
        onPointerDown={tieniComandi}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 7,
          padding: '10px max(80px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.75))',
          color: '#fff',
          transform: comandi ? 'none' : 'translateY(100%)',
          opacity: comandi ? 1 : 0,
          transition: 'transform .2s ease, opacity .2s ease',
          pointerEvents: comandi ? 'auto' : 'none',
        }}
      >
        <BottoneComando onClick={() => naviga(-1)} titolo="Indietro" disabilitato={lavagna ? lavagna <= 1 : pagina <= 1}>
          ‹
        </BottoneComando>
        {lavagna ? (
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 650 }}>
            Lavagna · foglio {lavagna} di {fogliLavagna}
            {lavagna === fogliLavagna && (annotazioni[-lavagna]?.length ?? 0) > 0 ? ' — avanti per un foglio nuovo' : ''}
          </span>
        ) : (
          <>
            <input
              type="range"
              min={1}
              max={Math.max(1, totale)}
              value={pagina}
              onChange={(e) => vaiA(Number(e.target.value))}
              aria-label="Vai alla pagina"
              style={{ flex: 1, accentColor: '#e3ab2f', minWidth: 0 }}
            />
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650, whiteSpace: 'nowrap' }}>
              {pagina} / {totale}
            </span>
          </>
        )}
        <BottoneComando
          onClick={() => naviga(1)}
          titolo="Avanti"
          disabilitato={lavagna ? lavagna >= fogliLavagna && (annotazioni[-lavagna]?.length ?? 0) === 0 : pagina >= totale}
        >
          ›
        </BottoneComando>
      </div>

      {vista.scala > 1.01 && (
        <button
          type="button"
          data-resta-aperta
          onClick={() => setVista({ scala: 1, x: 0, y: 0 })}
          title="Torna a pagina intera"
          style={{
            position: 'absolute',
            left: 'max(12px, env(safe-area-inset-left))',
            bottom: 'max(12px, env(safe-area-inset-bottom))',
            zIndex: 8,
            border: 'none',
            borderRadius: 999,
            padding: '8px 14px',
            background: 'rgba(28,28,26,.85)',
            color: '#fff',
            font: '700 14px var(--font)',
            cursor: 'pointer',
          }}
        >
          {Math.round(vista.scala * 100)}% · pagina intera
        </button>
      )}
      {imp.cronometro.attivo && (
        <Cronometro
          inizio={inizioLezione}
          minuti={imp.cronometro.minuti}
          sempreVisibile={imp.cronometro.sempreVisibile}
          onAzzera={azzeraLezione}
          onMinuti={(m) => void aggiornaImpostazioni({ cronometro: { minuti: m } })}
          onSempreVisibile={(v) => void aggiornaImpostazioni({ cronometro: { sempreVisibile: v } })}
          onNascondi={() => void aggiornaImpostazioni({ cronometro: { attivo: false } })}
        />
      )}

      {/* Di proposito nessuna spia di registrazione, a meno che non la si chieda nelle impostazioni. */}
      {registrando && imp.registrazione.indicatore && (
        <span
          aria-label="Registrazione in corso"
          style={{
            position: 'absolute',
            top: 'max(10px, env(safe-area-inset-top))',
            right: 'max(10px, env(safe-area-inset-right))',
            width: 8,
            height: 8,
            borderRadius: 99,
            background: '#e53935',
            opacity: 0.6,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

/**
 * I comandi dello specchio: compaiono muovendo il mouse sul PC del proiettore
 * e spariscono da soli. Sul proiettore, in lezione, c'è solo la pagina.
 */
function ComandiSpecchio({
  collegato,
  presentatori,
  titolo,
  onEsci,
}: {
  collegato: boolean;
  presentatori: number;
  titolo?: string;
  onEsci: () => void;
}) {
  const [visibili, setVisibili] = useState(true);
  const schermo = useSchermoIntero({ ancheIos: true });
  useEffect(() => {
    let t = setTimeout(() => setVisibili(false), 4000);
    const muovi = () => {
      setVisibili(true);
      clearTimeout(t);
      t = setTimeout(() => setVisibili(false), 3000);
    };
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') schermo.alterna();
    };
    window.addEventListener('pointermove', muovi);
    window.addEventListener('pointerdown', muovi);
    window.addEventListener('keydown', tasto);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', muovi);
      window.removeEventListener('pointerdown', muovi);
      window.removeEventListener('keydown', tasto);
    };
  }, [schermo.alterna]); // eslint-disable-line react-hooks/exhaustive-deps
  const stato = !collegato ? '🔴 Non collegato, riprovo…' : presentatori > 0 ? '🟢 Segue l’iPad' : '🟡 In attesa dell’iPad';
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          zIndex: 7,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,0))',
          color: '#fff',
          opacity: visibili ? 1 : 0,
          transition: 'opacity .3s ease',
          pointerEvents: visibili ? 'auto' : 'none',
          cursor: 'default',
        }}
      >
        <BottoneComando onClick={onEsci} titolo="Chiudi lo specchio">
          ✕
        </BottoneComando>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <strong>📽 Specchio</strong> · {stato}
          {titolo ? ` · ${titolo}` : ''}
        </div>
        {schermo.supportato && (
          <BottoneComando onClick={schermo.alterna} titolo={schermo.attivo ? 'Esci dallo schermo intero (F)' : 'Schermo intero (F)'} largo>
            {schermo.attivo ? '⤡ Finestra' : '⤢ Schermo intero'}
          </BottoneComando>
        )}
      </div>
      {/* Il puntatore del mouse sparisce quando i comandi se ne vanno. */}
      {!visibili && <style>{'body { cursor: none; }'}</style>}
    </>
  );
}

function BottoneComando({
  onClick,
  titolo,
  children,
  attivo,
  coloreAttivo = '#e53935',
  largo,
  disabilitato,
}: {
  onClick: () => void;
  titolo: string;
  children: React.ReactNode;
  attivo?: boolean;
  coloreAttivo?: string;
  largo?: boolean;
  disabilitato?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titolo}
      aria-label={titolo}
      disabled={disabilitato}
      style={{
        minWidth: 44,
        height: 44,
        padding: largo ? '0 14px' : 0,
        borderRadius: 12,
        border: 'none',
        background: attivo ? coloreAttivo : 'rgba(255,255,255,.14)',
        color: attivo && coloreAttivo !== '#e53935' ? '#1c1c1a' : '#fff',
        fontSize: largo ? 15 : 20,
        fontWeight: 700,
        cursor: disabilitato ? 'default' : 'pointer',
        opacity: disabilitato ? 0.35 : 1,
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {children}
    </button>
  );
}
