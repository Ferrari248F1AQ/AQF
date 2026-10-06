import { useEffect, useState } from 'react';

const CHIAVE = 'aqf.lezione';
/** Uscire dalla presentazione per meno di questo tempo non azzera il cronometro. */
const RIPRESA_MS = 15 * 60_000;

function leggi(): { inizio: number; visto: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE) ?? 'null');
    return v && typeof v.inizio === 'number' && typeof v.visto === 'number' ? v : null;
  } catch {
    return null;
  }
}

function scrivi(inizio: number): void {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify({ inizio, visto: Date.now() }));
  } catch {
    /* navigazione privata: il cronometro vale per questa presentazione */
  }
}

/**
 * Da quanto si è in presentazione. Si passa da un documento all'altro, o si
 * esce un attimo a cercare un file, e il tempo continua: si azzera solo dopo
 * un quarto d'ora fuori, o a mano dopo la pausa.
 */
export function useInizioLezione(): [number, () => void] {
  const [inizio, setInizio] = useState(() => {
    const s = leggi();
    return s && Date.now() - s.visto < RIPRESA_MS ? s.inizio : Date.now();
  });
  useEffect(() => {
    scrivi(inizio);
    const t = setInterval(() => scrivi(inizio), 20_000);
    return () => {
      clearInterval(t);
      scrivi(inizio);
    };
  }, [inizio]);
  return [inizio, () => setInizio(Date.now())];
}

/**
 * Il cronometro della pausa.
 *
 * All'inizio della lezione quasi non si vede: un numero tenue nell'angolo.
 * Man mano che ci si avvicina alla pausa diventa più leggibile, a tre quarti
 * prende colore, e allo scadere è pieno e pulsa piano. «Sempre visibile» lo
 * tiene leggibile dall'inizio.
 */
export function Cronometro({
  inizio,
  minuti,
  sempreVisibile,
  onAzzera,
  onMinuti,
  onSempreVisibile,
  onNascondi,
}: {
  inizio: number;
  minuti: number;
  sempreVisibile: boolean;
  onAzzera: () => void;
  onMinuti: (m: number) => void;
  onSempreVisibile: (v: boolean) => void;
  onNascondi: () => void;
}) {
  const [adesso, setAdesso] = useState(Date.now());
  const [aperto, setAperto] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const trascorsi = Math.max(0, adesso - inizio) / 60_000;
  const r = trascorsi / minuti;
  const scaduto = r >= 1;
  const vicino = r >= 0.8;
  // Curva morbida: fino a metà quasi invisibile, poi cresce in fretta.
  const opacita = sempreVisibile || scaduto ? 0.95 : 0.1 + 0.8 * Math.pow(Math.max(0, (r - 0.4) / 0.6), 1.6);
  const colore = scaduto ? '#ffffff' : vicino ? '#f2b705' : '#ffffff';
  const sfondo = scaduto ? 'rgba(211,47,47,.92)' : `rgba(20,20,18,${0.15 + 0.6 * Math.min(1, opacita)})`;
  const testo = trascorsi < 60 ? `${Math.floor(trascorsi)}′` : `${Math.floor(trascorsi / 60)}h${String(Math.floor(trascorsi % 60)).padStart(2, '0')}`;

  return (
    <div data-resta-aperta style={{ position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', bottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 8 }}>
      <style>{`@keyframes aqf-pulsa { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }`}</style>
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        aria-label={`In presentazione da ${Math.floor(trascorsi)} minuti su ${minuti}`}
        title="Cronometro della pausa"
        style={{
          opacity: aperto ? 1 : opacita,
          transition: 'opacity 1.5s ease, background 1.5s ease, font-size 1.5s ease',
          background: sfondo,
          color: colore,
          border: 'none',
          borderRadius: 999,
          padding: vicino ? '6px 14px' : '4px 10px',
          font: `700 ${vicino ? 20 : 15}px/1.2 var(--font)`,
          fontVariantNumeric: 'tabular-nums',
          cursor: 'pointer',
          animation: scaduto && !aperto ? 'aqf-pulsa 2.4s ease-in-out infinite' : undefined,
          minWidth: 44,
          minHeight: 32,
        }}
      >
        {scaduto ? `☕ ${testo}` : testo}
      </button>
      {aperto && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 8px)',
            width: 270,
            background: 'rgba(28,28,26,.97)',
            color: '#fff',
            borderRadius: 14,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 8px 30px rgba(0,0,0,.4)',
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {Math.floor(trascorsi)} min su {minuti}
            {scaduto ? ' — è ora della pausa' : ''}
          </div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Pausa dopo</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <BottoneScuro onClick={() => onMinuti(Math.max(5, minuti - 5))} etichetta="−5" />
            <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 18 }}>{minuti}′</span>
            <BottoneScuro onClick={() => onMinuti(Math.min(240, minuti + 5))} etichetta="+5" />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[30, 45, 60, 90].map((m) => (
              <BottoneScuro key={m} onClick={() => onMinuti(m)} etichetta={`${m}`} attivo={m === minuti} />
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={sempreVisibile} onChange={(e) => onSempreVisibile(e.target.checked)} />
            Sempre ben visibile
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <BottoneScuro
              onClick={() => {
                onAzzera();
                setAperto(false);
              }}
              etichetta="Pausa fatta: azzera"
              largo
            />
          </div>
          <BottoneScuro onClick={onNascondi} etichetta="Nascondi il cronometro" largo />
        </div>
      )}
    </div>
  );
}

function BottoneScuro({ onClick, etichetta, attivo, largo }: { onClick: () => void; etichetta: string; attivo?: boolean; largo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: largo ? 1 : undefined,
        minWidth: 44,
        minHeight: 38,
        padding: '0 10px',
        borderRadius: 9,
        border: 'none',
        background: attivo ? '#e3ab2f' : 'rgba(255,255,255,.12)',
        color: attivo ? '#1c1c1a' : '#fff',
        fontWeight: 700,
        cursor: 'pointer',
        flexGrow: largo ? 1 : 1,
      }}
    >
      {etichetta}
    </button>
  );
}
