import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { byte, caricaFile, del, get, patch, post, type Documento, type Libreria as DatiLibreria } from '../api';
import { avvisa, chiediTesto, conferma, scegliCartella, Tendina } from '../dialoghi';
import { entraSchermoIntero } from '../presentazione/schermoIntero';

const ACCETTATI = '.pdf,.ppt,.pptx,.odp,.key,application/pdf';

export function Libreria() {
  const { id } = useParams();
  const cartella = id ?? null;
  const vai = useNavigate();
  const [dati, setDati] = useState<DatiLibreria | null>(null);
  const [recenti, setRecenti] = useState<Documento[]>([]);
  const [cerca, setCerca] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState<number | null>(null);
  const [rilascio, setRilascio] = useState(false);
  const scegliFile = useRef<HTMLInputElement>(null);

  const ricarica = useCallback(async () => {
    try {
      const q = cerca.trim();
      const url = q ? `/api/libreria?q=${encodeURIComponent(q)}` : `/api/libreria?cartella=${cartella ?? 'radice'}`;
      setDati(await get<DatiLibreria>(url));
      if (!cartella && !q) setRecenti(await get<Documento[]>('/api/recenti'));
      setErrore(null);
    } catch (err) {
      setErrore((err as Error).message);
    }
  }, [cartella, cerca]);

  useEffect(() => {
    const t = setTimeout(() => void ricarica(), cerca ? 250 : 0);
    return () => clearTimeout(t);
  }, [ricarica, cerca]);

  // Finché un PowerPoint si sta convertendo, la pagina si aggiorna da sola.
  const inConversione = dati?.documenti.some((d) => d.stato === 'in_conversione');
  useEffect(() => {
    if (!inConversione) return;
    const t = setInterval(() => void ricarica(), 4000);
    return () => clearInterval(t);
  }, [inConversione, ricarica]);

  const carica = async (file: File[]) => {
    if (file.length === 0) return;
    setCaricamento(0);
    try {
      const r = await caricaFile(`/api/documenti?cartella=${cartella ?? 'radice'}`, file, setCaricamento);
      if (r.scartati.length) avvisa(`Non caricati: ${r.scartati.join('; ')}`);
      else avvisa(r.creati.length === 1 ? 'Documento caricato.' : `${r.creati.length} documenti caricati.`);
      await ricarica();
    } catch (err) {
      avvisa((err as Error).message);
    } finally {
      setCaricamento(null);
    }
  };

  const presenta = (d: Documento) => {
    if (d.stato !== 'pronto') return;
    // Lo schermo intero va chiesto dentro il gesto, prima di cambiare pagina.
    entraSchermoIntero();
    vai(`/presenta/${d.id}`);
  };

  const azione = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) avvisa(ok);
      await ricarica();
    } catch (err) {
      avvisa((err as Error).message);
    }
  };

  const nuovaCartella = async () => {
    const nome = await chiediTesto('Nuova cartella', 'Nome', '', 'Crea');
    if (nome) await azione(() => post('/api/cartelle', { nome, genitore_id: cartella }));
  };

  const menuDocumento = (d: Documento) => [
    ...(d.stato === 'pronto' ? [{ testo: '▶︎ Presenta', azione: () => presenta(d) }] : []),
    {
      testo: '✏️ Rinomina',
      azione: async () => {
        const t = await chiediTesto('Rinomina documento', 'Titolo', d.titolo);
        if (t) await azione(() => patch(`/api/documenti/${d.id}`, { titolo: t }));
      },
    },
    {
      testo: '📁 Sposta in…',
      azione: async () => {
        const dest = await scegliCartella(`Sposta «${d.titolo}»`, d.cartella_id);
        if (dest !== undefined) await azione(() => patch(`/api/documenti/${d.id}`, { cartella_id: dest }), 'Spostato.');
      },
    },
    'separatore' as const,
    ...(d.stato === 'pronto'
      ? [{ testo: '🖍️ Scarica PDF con annotazioni', azione: () => window.open(`/api/documenti/${d.id}/annotato`, '_blank') }]
      : []),
    { testo: '⬇️ Scarica originale', azione: () => window.open(`/api/documenti/${d.id}/originale`, '_blank') },
    ...(d.tipo !== 'pdf' && d.stato === 'pronto'
      ? [{ testo: '⬇️ Scarica PDF', azione: () => window.open(`/api/documenti/${d.id}/pdf`, '_blank') }]
      : []),
    ...(d.tipo !== 'pdf'
      ? [{ testo: '🔄 Converti di nuovo', azione: () => void azione(() => post(`/api/documenti/${d.id}/riconverti`)) }]
      : []),
    ...(d.registrazioni > 0
      ? [{ testo: `🎙️ Registrazioni (${d.registrazioni})`, azione: () => vai(`/registrazioni?documento=${d.id}`) }]
      : []),
    'separatore' as const,
    {
      testo: '🧽 Cancella tutte le annotazioni',
      pericolo: true,
      azione: async () => {
        if (await conferma('Cancellare le annotazioni?', `Tutti i segni su «${d.titolo}» spariranno, su ogni pagina.`, { conferma: 'Cancella', pericolo: true }))
          await azione(() => del(`/api/documenti/${d.id}/annotazioni`), 'Annotazioni cancellate.');
      },
    },
    {
      testo: '🗑️ Elimina',
      pericolo: true,
      azione: async () => {
        if (await conferma('Eliminare il documento?', `«${d.titolo}» e le sue annotazioni verranno eliminati. Le registrazioni restano.`, { conferma: 'Elimina', pericolo: true }))
          await azione(() => del(`/api/documenti/${d.id}`), 'Documento eliminato.');
      },
    },
  ];

  return (
    <div
      className={rilascio ? 'zona-rilascio' : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setRilascio(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setRilascio(false)}
      onDrop={(e) => {
        e.preventDefault();
        setRilascio(false);
        void carica([...e.dataTransfer.files]);
      }}
    >
      <h1>{dati?.percorso.length ? dati.percorso[dati.percorso.length - 1]!.nome : cerca ? 'Risultati' : 'Libreria'}</h1>
      <nav className="briciole" aria-label="Percorso">
        <button type="button" onClick={() => (setCerca(''), vai('/'))}>
          Libreria
        </button>
        {dati?.percorso.map((p) => (
          <span key={p.id} style={{ display: 'contents' }}>
            <span aria-hidden>›</span>
            <button type="button" onClick={() => vai(`/cartella/${p.id}`)}>
              {p.nome}
            </button>
          </span>
        ))}
      </nav>

      <div className="barra-azioni">
        <input
          className="testo cerca"
          type="search"
          placeholder="Cerca documenti e cartelle…"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
          aria-label="Cerca"
        />
        <button
          type="button"
          className="pulsante"
          title="Da aprire sul PC del proiettore: mostra quello che presenti sull'iPad, in tempo reale"
          onClick={() => {
            entraSchermoIntero({ ancheIos: true });
            vai('/specchio');
          }}
        >
          📽 Specchio
        </button>
        <button type="button" className="pulsante" onClick={nuovaCartella}>
          ＋ Cartella
        </button>
        <button type="button" className="pulsante primario" onClick={() => scegliFile.current?.click()} disabled={caricamento !== null}>
          {caricamento !== null ? `Caricamento ${Math.round(caricamento * 100)}%` : '⬆︎ Carica'}
        </button>
        <input
          ref={scegliFile}
          type="file"
          accept={ACCETTATI}
          multiple
          hidden
          onChange={(e) => {
            void carica([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {errore && <p className="errore">{errore}</p>}

      {!cartella && !cerca && recenti.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>Aperti di recente</h2>
          <div className="griglia">
            {recenti.slice(0, 4).map((d) => (
              <CartaDocumento key={d.id} d={d} onApri={() => presenta(d)} menu={menuDocumento(d)} />
            ))}
          </div>
        </section>
      )}

      {dati && dati.cartelle.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          {!cerca && <h2>Cartelle</h2>}
          <div className="griglia">
            {dati.cartelle.map((c) => (
              <div
                key={c.id}
                className="scheda carta cartella-riga"
                role="button"
                tabIndex={0}
                onClick={() => (setCerca(''), vai(`/cartella/${c.id}`))}
                onKeyDown={(e) => e.key === 'Enter' && vai(`/cartella/${c.id}`)}
                style={{ flexDirection: 'row' }}
              >
                <span style={{ fontSize: 26 }}>📁</span>
                <span className="titolo" style={{ fontWeight: 650, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {c.nome}
                </span>
                <div className="menu" style={{ top: '50%', bottom: 'auto', transform: 'translateY(-50%)' }}>
                  <Tendina
                    voci={[
                      {
                        testo: '✏️ Rinomina',
                        azione: async () => {
                          const n = await chiediTesto('Rinomina cartella', 'Nome', c.nome);
                          if (n) await azione(() => patch(`/api/cartelle/${c.id}`, { nome: n }));
                        },
                      },
                      {
                        testo: '📁 Sposta in…',
                        azione: async () => {
                          const dest = await scegliCartella(`Sposta «${c.nome}»`, c.genitore_id, c.id);
                          if (dest !== undefined) await azione(() => patch(`/api/cartelle/${c.id}`, { genitore_id: dest }), 'Spostata.');
                        },
                      },
                      'separatore',
                      {
                        testo: '🗑️ Elimina',
                        pericolo: true,
                        azione: async () => {
                          if (
                            await conferma(
                              'Eliminare la cartella?',
                              `«${c.nome}» verrà eliminata insieme a tutte le sottocartelle e ai documenti che contiene.`,
                              { conferma: 'Elimina tutto', pericolo: true },
                            )
                          )
                            await azione(() => del(`/api/cartelle/${c.id}`), 'Cartella eliminata.');
                        },
                      },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {dati && (
        <section>
          {!cerca && dati.cartelle.length > 0 && dati.documenti.length > 0 && <h2>Documenti</h2>}
          {dati.documenti.length > 0 ? (
            <div className="griglia">
              {dati.documenti.map((d) => (
                <CartaDocumento key={d.id} d={d} onApri={() => presenta(d)} menu={menuDocumento(d)} />
              ))}
            </div>
          ) : (
            dati.cartelle.length === 0 && (
              <div className="vuoto scheda">
                {cerca ? (
                  'Nessun risultato.'
                ) : (
                  <>
                    <div style={{ fontSize: 40 }}>📄</div>
                    <p>
                      Nessun documento qui. Carica PDF o PowerPoint con <strong>Carica</strong>
                      <br />
                      oppure trascinali in questa pagina.
                    </p>
                  </>
                )}
              </div>
            )
          )}
        </section>
      )}
    </div>
  );
}

function CartaDocumento({
  d,
  onApri,
  menu,
}: {
  d: Documento;
  onApri: () => void;
  menu: Parameters<typeof Tendina>[0]['voci'];
}) {
  const icona = d.tipo === 'pdf' ? '📕' : '📙';
  return (
    <div
      className="scheda carta"
      role="button"
      tabIndex={0}
      aria-disabled={d.stato !== 'pronto'}
      onClick={onApri}
      onKeyDown={(e) => e.key === 'Enter' && onApri()}
    >
      <div className="copertina">
        {d.anteprima ? (
          <img src={`/api/documenti/${d.id}/anteprima`} alt="" loading="lazy" />
        ) : (
          <span style={{ fontSize: 44 }}>{icona}</span>
        )}
      </div>
      {d.stato === 'in_conversione' && <span className="distintivo">Conversione…</span>}
      {d.stato === 'errore' && (
        <span className="distintivo errore-d" title={d.errore ?? undefined}>
          Errore
        </span>
      )}
      <div className="dida">
        <div className="titolo">{d.titolo}</div>
        <div className="meta">
          {d.tipo.toUpperCase()} · {d.pagine ? `${d.pagine} pag. · ` : ''}
          {byte(d.dimensione)}
          {d.registrazioni > 0 ? ` · 🎙️${d.registrazioni}` : ''}
        </div>
        {d.stato === 'errore' && d.errore && (
          <div className="errore" style={{ fontSize: 12, marginTop: 4 }}>
            {d.errore}
          </div>
        )}
      </div>
      <div className="menu" onClick={(e) => e.stopPropagation()}>
        <Tendina voci={menu} />
      </div>
    </div>
  );
}
