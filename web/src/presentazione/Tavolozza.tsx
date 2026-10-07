import type { ReactElement } from 'react';
import { COLORI, SPESSORI, type Strumento } from './tratti';

const tratto = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const ICONE: Record<Strumento, ReactElement> = {
  penna: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" />
      <path d="M14 7l3 3" />
    </svg>
  ),
  evidenziatore: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <path d="M9 14l-3 3v3h3l3-3" />
      <path d="M9 14l7-9 4 4-9 7z" />
      <path d="M4 21h16" opacity=".5" />
    </svg>
  ),
  riga: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <path d="M5 19L19 5" />
    </svg>
  ),
  freccia: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <path d="M5 19L19 5M11 5h8v8" />
    </svg>
  ),
  rettangolo: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  ),
  ellisse: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
    </svg>
  ),
  laser: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />
    </svg>
  ),
  gomma: (
    <svg viewBox="0 0 24 24" width="24" height="24" {...tratto}>
      <path d="M8 20h12M5 15l9-9 5 5-8 8H8l-3-3z" />
      <path d="M10 10l5 5" />
    </svg>
  ),
};

const NOMI: Record<Strumento, string> = {
  penna: 'Penna',
  evidenziatore: 'Evidenziatore',
  riga: 'Linea dritta',
  freccia: 'Freccia',
  rettangolo: 'Rettangolo',
  ellisse: 'Ellisse',
  laser: 'Puntatore laser (non lascia segni)',
  gomma: 'Gomma (cancella il segno toccato)',
};

const ORDINE: Strumento[] = ['penna', 'evidenziatore', 'riga', 'freccia', 'rettangolo', 'ellisse', 'laser', 'gomma'];

const lato = 42;

function Bottone({
  attivo,
  onClick,
  titolo,
  children,
  disabilitato,
}: {
  attivo?: boolean;
  onClick: () => void;
  titolo: string;
  children: ReactElement | string;
  disabilitato?: boolean;
}) {
  return (
    <button
      type="button"
      title={titolo}
      aria-label={titolo}
      aria-pressed={attivo}
      disabled={disabilitato}
      onClick={onClick}
      style={{
        width: lato,
        height: lato,
        flex: 'none',
        borderRadius: 10,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabilitato ? 'not-allowed' : 'pointer',
        background: attivo ? '#e3ab2f' : 'rgba(255,255,255,.1)',
        color: attivo ? '#1c1c1a' : '#fff',
        opacity: disabilitato ? 0.35 : 1,
        fontSize: 18,
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function Separatore() {
  return <span style={{ width: 34, height: 1, background: 'rgba(255,255,255,.2)', margin: '3px 0', flex: 'none' }} />;
}

/** La colonna degli strumenti, sul bordo sinistro (ricalcata su quella di drAwQ). */
export function Tavolozza({
  strumento,
  colore,
  spessore,
  onStrumento,
  onColore,
  onSpessore,
  onAnnulla,
  onRipeti,
  onPulisci,
  puoAnnullare,
  puoRipetere,
  haSegni,
  ditoDisegna,
  onDito,
  lavagna,
  onLavagna,
}: {
  strumento: Strumento;
  colore: string;
  spessore: number;
  onStrumento: (s: Strumento) => void;
  onColore: (c: string) => void;
  onSpessore: (w: number) => void;
  onAnnulla: () => void;
  onRipeti: () => void;
  onPulisci: () => void;
  puoAnnullare: boolean;
  puoRipetere: boolean;
  haSegni: boolean;
  lavagna: boolean;
  onLavagna: () => void;
  ditoDisegna: boolean;
  onDito: (v: boolean) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Strumenti di annotazione"
      style={{
        width: 66,
        maxHeight: '100%',
        background: 'rgba(28,28,26,.94)',
        borderRadius: '0 16px 16px 0',
        padding: '10px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        overflowY: 'auto',
        boxShadow: '0 8px 30px rgba(0,0,0,.35)',
      }}
    >
      {/* In cima, dove la punta arriva per prima: un tocco apre la lavagna, un altro torna alla slide. */}
      <button
        type="button"
        onClick={onLavagna}
        title={lavagna ? 'Torna alla slide' : 'Apri la lavagna bianca'}
        aria-label={lavagna ? 'Torna alla slide' : 'Apri la lavagna bianca'}
        aria-pressed={lavagna}
        style={{
          width: lato,
          minHeight: lato,
          flex: 'none',
          borderRadius: 10,
          border: lavagna ? 'none' : '2px solid rgba(255,255,255,.55)',
          background: lavagna ? '#e3ab2f' : '#fff',
          color: '#1c1c1a',
          cursor: 'pointer',
          font: '800 10px/1.1 var(--font)',
          padding: 2,
        }}
      >
        {lavagna ? '↩︎ SLIDE' : 'LAVA­GNA'}
      </button>
      <Separatore />
      {ORDINE.map((s) => (
        <Bottone key={s} attivo={strumento === s} onClick={() => onStrumento(s)} titolo={NOMI[s]}>
          {ICONE[s]}
        </Bottone>
      ))}
      <Separatore />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 24px)', gap: 6, flex: 'none' }}>
      {COLORI.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.nome}
          aria-label={`Colore ${c.nome}`}
          aria-pressed={colore === c.hex}
          onClick={() => onColore(c.hex)}
          style={{
            width: 24,
            height: 24,
            flex: 'none',
            padding: 0,
            borderRadius: 99,
            background: c.hex,
            cursor: 'pointer',
            border: colore === c.hex ? '3px solid #e3ab2f' : '2px solid rgba(255,255,255,.35)',
          }}
        />
      ))}
      </div>
      <Separatore />
      {SPESSORI.map((s) => (
        <button
          key={s.w}
          type="button"
          aria-label={`Spessore ${s.nome}`}
          title={`Spessore ${s.nome}`}
          aria-pressed={spessore === s.w}
          onClick={() => onSpessore(s.w)}
          style={{
            width: 40,
            height: 20,
            flex: 'none',
            borderRadius: 99,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            background: spessore === s.w ? 'rgba(255,255,255,.22)' : 'transparent',
          }}
        >
          <span style={{ width: 24, height: s.w * 1.2, minHeight: 2, borderRadius: 99, background: '#fff', display: 'block' }} />
        </button>
      ))}
      <Separatore />
      <Bottone onClick={onAnnulla} titolo="Annulla" disabilitato={!puoAnnullare}>
        ↶
      </Bottone>
      <Bottone onClick={onRipeti} titolo="Ripeti" disabilitato={!puoRipetere}>
        ↷
      </Bottone>
      <Bottone onClick={onPulisci} titolo="Cancella i segni di questa pagina" disabilitato={!haSegni}>
        🧹
      </Bottone>
      <Separatore />
      <Bottone attivo={ditoDisegna} onClick={() => onDito(!ditoDisegna)} titolo={ditoDisegna ? 'Il dito disegna (tocca per sfogliare col dito)' : 'Il dito sfoglia (tocca per disegnare col dito)'}>
        ☝︎
      </Bottone>
    </div>
  );
}
