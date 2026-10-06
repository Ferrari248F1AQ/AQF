import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { get, type Cartella } from './api';

/**
 * Finestre di dialogo chiamabili come funzioni: `await chiediTesto(...)`.
 * Una sola alla volta, disegnata da <Dialoghi/> in cima all'applicazione.
 */
type Richiesta =
  | { tipo: 'testo'; titolo: string; etichetta: string; valore: string; conferma: string; ok: (v: string | null) => void }
  | { tipo: 'conferma'; titolo: string; messaggio: ReactNode; conferma: string; pericolo: boolean; ok: (v: boolean) => void }
  | { tipo: 'cartella'; titolo: string; esclusa: string | null; attuale: string | null; ok: (v: string | null | undefined) => void };

let attuale: Richiesta | null = null;
const ascoltatori = new Set<() => void>();
const imposta = (r: Richiesta | null) => {
  attuale = r;
  ascoltatori.forEach((f) => f());
};

export function chiediTesto(titolo: string, etichetta: string, valore = '', conferma = 'Salva'): Promise<string | null> {
  return new Promise((ok) => imposta({ tipo: 'testo', titolo, etichetta, valore, conferma, ok }));
}

export function conferma(titolo: string, messaggio: ReactNode, opzioni: { conferma?: string; pericolo?: boolean } = {}): Promise<boolean> {
  return new Promise((ok) =>
    imposta({ tipo: 'conferma', titolo, messaggio, conferma: opzioni.conferma ?? 'Conferma', pericolo: opzioni.pericolo ?? false, ok }),
  );
}

/** `undefined` = annullato; `null` = radice. */
export function scegliCartella(titolo: string, attuale: string | null, esclusa: string | null = null): Promise<string | null | undefined> {
  return new Promise((ok) => imposta({ tipo: 'cartella', titolo, esclusa, attuale, ok }));
}

let messaggioAvviso: string | null = null;
const ascoltaAvviso = new Set<() => void>();
let timerAvviso: ReturnType<typeof setTimeout> | undefined;
export function avvisa(m: string): void {
  messaggioAvviso = m;
  ascoltaAvviso.forEach((f) => f());
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => {
    messaggioAvviso = null;
    ascoltaAvviso.forEach((f) => f());
  }, 4000);
}

export function Dialoghi() {
  const r = useSyncExternalStore(
    (f) => (ascoltatori.add(f), () => ascoltatori.delete(f)),
    () => attuale,
  );
  const avviso = useSyncExternalStore(
    (f) => (ascoltaAvviso.add(f), () => ascoltaAvviso.delete(f)),
    () => messaggioAvviso,
  );
  return (
    <>
      {r?.tipo === 'testo' && <DialogoTesto r={r} />}
      {r?.tipo === 'conferma' && <DialogoConferma r={r} />}
      {r?.tipo === 'cartella' && <DialogoCartella r={r} />}
      {avviso && (
        <div className="avviso" role="status">
          {avviso}
        </div>
      )}
    </>
  );
}

function Velo({ children, chiudi }: { children: ReactNode; chiudi: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && chiudi();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [chiudi]);
  return (
    <div className="velo" onPointerDown={(e) => e.target === e.currentTarget && chiudi()}>
      <div className="finestra scheda" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function DialogoTesto({ r }: { r: Extract<Richiesta, { tipo: 'testo' }> }) {
  const [v, setV] = useState(r.valore);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);
  const fine = (valore: string | null) => {
    imposta(null);
    r.ok(valore);
  };
  return (
    <Velo chiudi={() => fine(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) fine(v.trim());
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 style={{ margin: 0 }}>{r.titolo}</h2>
        <label className="campo">
          <span>{r.etichetta}</span>
          <input ref={campo} value={v} onChange={(e) => setV(e.target.value)} maxLength={200} />
        </label>
        <div className="azioni">
          <button type="button" className="pulsante" onClick={() => fine(null)}>
            Annulla
          </button>
          <button type="submit" className="pulsante primario" disabled={!v.trim()}>
            {r.conferma}
          </button>
        </div>
      </form>
    </Velo>
  );
}

function DialogoConferma({ r }: { r: Extract<Richiesta, { tipo: 'conferma' }> }) {
  const fine = (v: boolean) => {
    imposta(null);
    r.ok(v);
  };
  return (
    <Velo chiudi={() => fine(false)}>
      <h2 style={{ margin: 0 }}>{r.titolo}</h2>
      <div>{r.messaggio}</div>
      <div className="azioni">
        <button type="button" className="pulsante" onClick={() => fine(false)}>
          Annulla
        </button>
        <button
          type="button"
          className={`pulsante ${r.pericolo ? '' : 'primario'}`}
          style={r.pericolo ? { background: 'var(--pericolo)', borderColor: 'var(--pericolo)', color: '#fff' } : undefined}
          onClick={() => fine(true)}
          autoFocus
        >
          {r.conferma}
        </button>
      </div>
    </Velo>
  );
}

function DialogoCartella({ r }: { r: Extract<Richiesta, { tipo: 'cartella' }> }) {
  const [cartelle, setCartelle] = useState<Cartella[] | null>(null);
  const [scelta, setScelta] = useState<string | null>(r.attuale);
  useEffect(() => {
    void get<Cartella[]>('/api/cartelle').then(setCartelle, () => setCartelle([]));
  }, []);
  const fine = (v: string | null | undefined) => {
    imposta(null);
    r.ok(v);
  };
  // Le cartelle sotto quella da spostare non possono accoglierla.
  const escluse = new Set<string>();
  if (r.esclusa && cartelle) {
    const coda = [r.esclusa];
    while (coda.length) {
      const id = coda.pop()!;
      escluse.add(id);
      cartelle.filter((c) => c.genitore_id === id).forEach((c) => coda.push(c.id));
    }
  }
  const rami = (genitore: string | null, livello: number): ReactNode[] =>
    (cartelle ?? [])
      .filter((c) => c.genitore_id === genitore)
      .flatMap((c) => [
        <button
          key={c.id}
          type="button"
          aria-pressed={scelta === c.id}
          disabled={escluse.has(c.id)}
          onClick={() => setScelta(c.id)}
          style={{ paddingLeft: 12 + livello * 20 }}
        >
          📁 {c.nome}
        </button>,
        ...rami(c.id, livello + 1),
      ]);
  return (
    <Velo chiudi={() => fine(undefined)}>
      <h2 style={{ margin: 0 }}>{r.titolo}</h2>
      <div className="albero" style={{ maxHeight: '50dvh', overflow: 'auto' }}>
        <button type="button" aria-pressed={scelta === null} onClick={() => setScelta(null)}>
          🏠 Libreria (radice)
        </button>
        {cartelle === null ? <p className="nota">Carico…</p> : rami(null, 1)}
      </div>
      <div className="azioni">
        <button type="button" className="pulsante" onClick={() => fine(undefined)}>
          Annulla
        </button>
        <button type="button" className="pulsante primario" onClick={() => fine(scelta)}>
          Sposta qui
        </button>
      </div>
    </Velo>
  );
}

/** Menu contestuale ancorato a un pulsante «⋯». */
export function Tendina({
  voci,
  etichetta = 'Altre azioni',
}: {
  voci: ({ testo: string; azione: () => void; pericolo?: boolean } | 'separatore')[];
  etichetta?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const chiudi = () => setPos(null);
    window.addEventListener('scroll', chiudi, true);
    window.addEventListener('resize', chiudi);
    return () => {
      window.removeEventListener('scroll', chiudi, true);
      window.removeEventListener('resize', chiudi);
    };
  }, [pos]);
  return (
    <>
      <button
        type="button"
        className="pulsante icona piccolo menu"
        aria-label={etichetta}
        title={etichetta}
        style={{ border: 'none', background: 'transparent', fontSize: 20 }}
        onClick={(e) => {
          e.stopPropagation();
          const b = e.currentTarget.getBoundingClientRect();
          const larghezza = 240;
          const altezza = voci.length * 44 + 12;
          setPos({
            x: Math.max(8, Math.min(window.innerWidth - larghezza - 8, b.right - larghezza)),
            y: b.bottom + altezza > window.innerHeight - 8 ? Math.max(8, b.top - altezza) : b.bottom + 4,
          });
        }}
      >
        ⋯
      </button>
      {pos && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={(e) => (e.stopPropagation(), setPos(null))}>
          <div className="tendina" style={{ left: pos.x, top: pos.y, width: 240 }} role="menu" onClick={(e) => e.stopPropagation()}>
            {voci.map((v, i) =>
              v === 'separatore' ? (
                <hr key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={v.pericolo ? 'pericolo' : undefined}
                  onClick={() => {
                    setPos(null);
                    v.azione();
                  }}
                >
                  {v.testo}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
