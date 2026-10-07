import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { byte, data, del, durata, get, patch, type Registrazione } from '../api';
import { avvisa, chiediTesto, conferma, Tendina } from '../dialoghi';

export function Registrazioni() {
  const [parametri, setParametri] = useSearchParams();
  const documento = parametri.get('documento');
  const [elenco, setElenco] = useState<Registrazione[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    try {
      setElenco(await get<Registrazione[]>(`/api/registrazioni${documento ? `?documento=${documento}` : ''}`));
    } catch (err) {
      setErrore((err as Error).message);
    }
  }, [documento]);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  return (
    <div>
      <h1>Registrazioni</h1>
      <p className="nota">
        La voce registrata durante le presentazioni. I segni sotto ogni lettore portano al momento in cui si è passati a quella pagina.
      </p>
      {documento && elenco && (
        <p>
          Solo le registrazioni di <strong>{elenco[0]?.documento_titolo ?? 'questo documento'}</strong> ·{' '}
          <button type="button" className="pulsante piccolo" onClick={() => setParametri({})}>
            Mostra tutte
          </button>
        </p>
      )}
      {errore && <p className="errore">{errore}</p>}
      {elenco?.length === 0 && (
        <div className="vuoto scheda">
          <div style={{ fontSize: 40 }}>🎙️</div>
          <p>
            Nessuna registrazione. Durante una presentazione tocca il centro dello schermo con un dito e premi <strong>Registra</strong>,
            oppure attiva la registrazione automatica nelle impostazioni.
          </p>
        </div>
      )}
      <div className="elenco">
        {elenco?.map((r) => (
          <VoceRegistrazione key={r.id} r={r} ricarica={ricarica} />
        ))}
      </div>
    </div>
  );
}

function VoceRegistrazione({ r, ricarica }: { r: Registrazione; ricarica: () => Promise<void> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [aperto, setAperto] = useState(false);
  const azione = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) avvisa(ok);
      await ricarica();
    } catch (err) {
      avvisa((err as Error).message);
    }
  };
  return (
    <div className="scheda riga" style={{ alignItems: 'flex-start' }}>
      <div className="principale">
        <strong>{r.titolo}</strong>
        <div className="nota">
          {data(r.iniziata_il)} · {durata(r.durata_s)} · {byte(r.dimensione)}
          {r.stato === 'in_corso' && ' · 🔴 in corso'}
          {r.documento_titolo && ` · 📄 ${r.documento_titolo}`}
        </div>
        {aperto ? (
          <>
            <audio ref={audio} controls preload="metadata" src={`/api/registrazioni/${r.id}/audio`} />
            {r.pagine.length > 1 && (
              <div className="marcatori">
                {r.pagine.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (!audio.current) return;
                      audio.current.currentTime = p.t;
                      void audio.current.play();
                    }}
                  >
                    {durata(p.t)} · {p.pagina < 0 ? `lavagna ${-p.pagina}` : `pag. ${p.pagina}`}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <button type="button" className="pulsante piccolo" style={{ marginTop: 8 }} onClick={() => setAperto(true)}>
            ▶︎ Ascolta
          </button>
        )}
      </div>
      <Tendina
        voci={[
          {
            testo: '✏️ Rinomina',
            azione: async () => {
              const t = await chiediTesto('Rinomina registrazione', 'Titolo', r.titolo);
              if (t) await azione(() => patch(`/api/registrazioni/${r.id}`, { titolo: t }));
            },
          },
          { testo: '⬇️ Scarica', azione: () => window.open(`/api/registrazioni/${r.id}/audio?scarica=1`, '_blank') },
          'separatore',
          {
            testo: '🗑️ Elimina',
            pericolo: true,
            azione: async () => {
              if (await conferma('Eliminare la registrazione?', `«${r.titolo}» verrà eliminata definitivamente.`, { conferma: 'Elimina', pericolo: true }))
                await azione(() => del(`/api/registrazioni/${r.id}`), 'Registrazione eliminata.');
            },
          },
        ]}
      />
    </div>
  );
}
