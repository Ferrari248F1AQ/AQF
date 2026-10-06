import { useCallback, useEffect, useState } from 'react';
import { byte, del, get, post, type Archivi } from '../api';
import { avvisa, chiediTesto, conferma } from '../dialoghi';
import { inAppInstallata, suIosNelBrowser } from '../presentazione/schermoIntero';
import { useSessione } from '../sessione';

export function Impostazioni() {
  const { utente, aggiornaImpostazioni, esci } = useSessione();
  const imp = utente!.impostazioni;
  const salva = (m: Parameters<typeof aggiornaImpostazioni>[0]) =>
    aggiornaImpostazioni(m).catch((err: Error) => avvisa(err.message));

  return (
    <div>
      <h1>Impostazioni</h1>
      <p className="nota">
        {utente!.nome} · {utente!.email}
      </p>

      <section className="scheda sezione" style={{ marginTop: 18 }}>
        <h2>⏱ Cronometro della pausa</h2>
        <label className="interruttore">
          <input type="checkbox" checked={imp.cronometro.attivo} onChange={(e) => void salva({ cronometro: { attivo: e.target.checked } })} />
          <span>
            <strong>Mostra il cronometro durante la presentazione</strong>
            <div className="nota">I minuti da quando sei entrato in presentazione, nell'angolo in basso a destra.</div>
          </span>
        </label>
        <label className="campo" style={{ maxWidth: 260, margin: '6px 0 12px' }}>
          <span>Pausa dopo (minuti)</span>
          <input
            type="number"
            min={5}
            max={240}
            step={5}
            value={imp.cronometro.minuti}
            onChange={(e) => {
              const m = Number(e.target.value);
              if (m >= 5 && m <= 240) void salva({ cronometro: { minuti: m } });
            }}
          />
        </label>
        <label className="interruttore">
          <input
            type="checkbox"
            checked={imp.cronometro.sempreVisibile}
            onChange={(e) => void salva({ cronometro: { sempreVisibile: e.target.checked } })}
          />
          <span>
            <strong>Sempre ben visibile</strong>
            <div className="nota">
              Spento: il numero è appena accennato all'inizio e si fa più evidente man mano che ti avvicini alla pausa; a
              fine tempo diventa rosso. Puoi cambiare i minuti anche toccando il cronometro durante la lezione.
            </div>
          </span>
        </label>
      </section>

      <section className="scheda sezione">
        <h2>🎙️ Registrazione della voce</h2>
        <label className="interruttore">
          <input
            type="checkbox"
            checked={imp.registrazione.automatica}
            onChange={(e) => void salva({ registrazione: { automatica: e.target.checked } })}
          />
          <span>
            <strong>Registra automaticamente quando apro una presentazione</strong>
            <div className="nota">Altrimenti si avvia dai comandi (tocca il centro dello schermo con un dito).</div>
          </span>
        </label>
        <label className="interruttore">
          <input
            type="checkbox"
            checked={imp.registrazione.indicatore}
            onChange={(e) => void salva({ registrazione: { indicatore: e.target.checked } })}
          />
          <span>
            <strong>Mostra un puntino discreto mentre registra</strong>
            <div className="nota">Spento (predefinito): sullo schermo proiettato non compare nulla.</div>
          </span>
        </label>
        {!window.isSecureContext && (
          <p className="errore">
            Stai usando la piattaforma senza HTTPS: il browser non concede il microfono. Aprila dall'indirizzo del tunnel Cloudflare.
          </p>
        )}
      </section>

      <section className="scheda sezione">
        <h2>✍️ Annotazioni</h2>
        <label className="interruttore">
          <input type="checkbox" checked={imp.ditoDisegna} onChange={(e) => void salva({ ditoDisegna: e.target.checked })} />
          <span>
            <strong>Disegna anche con il dito</strong>
            <div className="nota">
              Utile senza Apple Pencil. Quando la Pencil è in uso il dito torna comunque a sfogliare, così il palmo appoggiato non
              lascia segni.
            </div>
          </span>
        </label>
        <p className="nota">
          Con una Apple Pencil che sorvola lo schermo (iPad Pro/Air recenti), la barra degli strumenti compare avvicinando la punta
          al bordo sinistro e sparisce quando torni sul foglio. Altrimenti tocca il centro con un dito e usa la linguetta a sinistra.
        </p>
        {suIosNelBrowser() && !inAppInstallata() && (
          <p className="nota" style={{ marginTop: 8 }}>
            <strong>Schermo intero su iPad:</strong> in Safari tocca Condividi → «Aggiungi alla schermata Home» e apri la piattaforma
            dall'icona: si apre senza barre e senza il gesto di Safari che fa uscire dallo schermo intero.
          </p>
        )}
      </section>

      <Account />

      {utente!.ruolo === 'admin' && <ArchivioDati />}

      <button type="button" className="pulsante pericolo" onClick={() => void esci()}>
        Esci dall'account
      </button>
    </div>
  );
}

function Account() {
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [ripeti, setRipeti] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  return (
    <section className="scheda sezione">
      <h2>🔑 Password</h2>
      <form
        style={{ display: 'grid', gap: 12, maxWidth: 380 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setErrore(null);
          if (nuova !== ripeti) return setErrore('Le due password nuove non coincidono.');
          try {
            await post('/api/io/password', { attuale, nuova });
            setAttuale('');
            setNuova('');
            setRipeti('');
            avvisa('Password cambiata. Le altre sessioni sono state chiuse.');
          } catch (err) {
            setErrore((err as Error).message);
          }
        }}
      >
        <label className="campo">
          <span>Password attuale</span>
          <input type="password" autoComplete="current-password" value={attuale} onChange={(e) => setAttuale(e.target.value)} required />
        </label>
        <label className="campo">
          <span>Nuova password (almeno 10 caratteri)</span>
          <input type="password" autoComplete="new-password" value={nuova} onChange={(e) => setNuova(e.target.value)} required minLength={10} />
        </label>
        <label className="campo">
          <span>Ripeti la nuova password</span>
          <input type="password" autoComplete="new-password" value={ripeti} onChange={(e) => setRipeti(e.target.value)} required />
        </label>
        {errore && <div className="errore">{errore}</div>}
        <div>
          <button type="submit" className="pulsante primario">
            Cambia password
          </button>
        </div>
      </form>
    </section>
  );
}

function ArchivioDati() {
  const [dati, setDati] = useState<Archivi | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [percorso, setPercorso] = useState('');

  const ricarica = useCallback(async () => {
    try {
      setDati(await get<Archivi>('/api/archivi'));
      setErrore(null);
    } catch (err) {
      setErrore((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void ricarica();
  }, [ricarica]);
  useEffect(() => {
    if (!dati?.spostamento.in_corso) return;
    const t = setInterval(() => void ricarica(), 2000);
    return () => clearInterval(t);
  }, [dati?.spostamento.in_corso, ricarica]);

  const azione = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) avvisa(ok);
    } catch (err) {
      avvisa((err as Error).message);
    }
    await ricarica();
  };

  const registra = async (p: string) => {
    const etichetta = await chiediTesto('Nuovo archivio', 'Nome da mostrare', p.split('/').filter(Boolean).pop() ?? p, 'Aggiungi');
    if (etichetta) await azione(() => post('/api/archivi', { percorso: p, etichetta }), 'Archivio aggiunto.');
  };

  const sp = dati?.spostamento;

  return (
    <section className="scheda sezione">
      <h2>💾 Dove salvare i dati</h2>
      <p className="nota">
        I documenti e le registrazioni nuovi vanno sull'archivio <strong>attivo</strong>. Quelli già caricati restano dove sono
        (ognuno sa su quale disco si trova), a meno che tu non scelga di spostarli. Il database resta sempre sul disco interno.
      </p>
      {errore && <p className="errore">{errore}</p>}

      <div className="elenco" style={{ margin: '14px 0' }}>
        {dati?.volumi.map((v) => {
          const usato = v.spazio ? 1 - v.spazio.libero / v.spazio.totale : 0;
          return (
            <div key={v.id} className="scheda riga" style={{ boxShadow: 'none', borderColor: v.attivo ? 'var(--accento)' : undefined }}>
              <div className="principale">
                <strong>
                  {v.attivo ? '● ' : ''}
                  {v.etichetta}
                </strong>{' '}
                {v.attivo && <span className="nota">(attivo)</span>}
                {!v.raggiungibile && <span className="errore"> · non raggiungibile: il disco è collegato?</span>}
                <div className="nota" style={{ overflowWrap: 'anywhere' }}>
                  {v.percorso} · {v.documenti} documenti, {v.registrazioni} registrazioni ({byte(v.occupato)})
                </div>
                {v.spazio && (
                  <>
                    <div className="barra-spazio">
                      <span style={{ width: `${Math.round(usato * 100)}%` }} />
                    </div>
                    <div className="nota">
                      {byte(v.spazio.libero)} liberi su {byte(v.spazio.totale)}
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!v.attivo && (
                  <button
                    type="button"
                    className="pulsante piccolo primario"
                    disabled={!v.raggiungibile || sp?.in_corso}
                    onClick={async () => {
                      const altri = dati.volumi.filter((x) => x.id !== v.id).reduce((n, x) => n + x.documenti + x.registrazioni, 0);
                      const sposta =
                        altri > 0 &&
                        (await conferma(
                          'Spostare anche i file esistenti?',
                          `Su altri archivi ci sono ${altri} file. Vuoi spostarli su «${v.etichetta}»? Se scegli Annulla, l'archivio diventa comunque attivo per i file nuovi.`,
                          { conferma: 'Sì, spostali' },
                        ));
                      await azione(() => post(`/api/archivi/${v.id}/attiva`, { sposta }), sposta ? 'Archivio attivo: spostamento avviato.' : 'Archivio attivo.');
                    }}
                  >
                    Usa questo
                  </button>
                )}
                {v.attivo && dati.volumi.some((x) => !x.attivo && x.documenti + x.registrazioni > 0) && (
                  <button
                    type="button"
                    className="pulsante piccolo"
                    disabled={sp?.in_corso}
                    onClick={() => void azione(() => post(`/api/archivi/${v.id}/sposta-qui`), 'Spostamento avviato.')}
                  >
                    Porta qui tutti i file
                  </button>
                )}
                {!v.attivo && v.documenti + v.registrazioni === 0 && (
                  <button
                    type="button"
                    className="pulsante piccolo pericolo"
                    onClick={async () => {
                      if (await conferma('Togliere l’archivio?', `«${v.etichetta}» non verrà più usato. Non cancella nulla dal disco.`, { conferma: 'Togli' }))
                        await azione(() => del(`/api/archivi/${v.id}`));
                    }}
                  >
                    Togli
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sp && (sp.in_corso || sp.concluso_il) && (
        <p className={sp.errori.length ? 'errore' : 'nota'}>
          {sp.in_corso ? `Spostamento in corso: ${sp.fatti} di ${sp.totale}…` : `Ultimo spostamento concluso: ${sp.fatti} file.`}
          {sp.errori.length > 0 && ` ${sp.errori.length} errori: ${sp.errori.slice(0, 3).join('; ')}`}
        </p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 20 }}>Dischi montati sul Raspberry</h2>
      <div className="elenco">
        {dati?.candidati.map((c) => (
          <div key={c.percorso} className="scheda riga" style={{ boxShadow: 'none' }}>
            <div className="principale">
              <strong style={{ overflowWrap: 'anywhere' }}>{c.percorso}</strong>
              <div className="nota">
                {c.dispositivo} · {c.tipo}
                {c.totale ? ` · ${byte(c.libero)} liberi su ${byte(c.totale)}` : ''}
                {c.sola_lettura ? ' · sola lettura' : ''}
              </div>
            </div>
            {c.registrato ? (
              <span className="nota">già aggiunto</span>
            ) : (
              <button type="button" className="pulsante piccolo" disabled={c.sola_lettura} onClick={() => void registra(c.percorso)}>
                Aggiungi
              </button>
            )}
          </div>
        ))}
        {dati && dati.candidati.length === 0 && <p className="nota">Nessun disco trovato.</p>}
      </div>

      <form
        style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (percorso.trim()) void registra(percorso.trim()).then(() => setPercorso(''));
        }}
      >
        <input
          className="testo"
          style={{ flex: '1 1 240px' }}
          placeholder="Oppure un percorso, es. /srv/aqf/disco1"
          value={percorso}
          onChange={(e) => setPercorso(e.target.value)}
          aria-label="Percorso di un archivio"
        />
        <button type="submit" className="pulsante" disabled={!percorso.trim()}>
          Aggiungi percorso
        </button>
      </form>
      <p className="nota" style={{ marginTop: 10 }}>
        I file finiscono in una sottocartella <code>aqf-dati</code> del disco scelto. Il servizio può scrivere solo dove l'utente
        <code> aqf</code> ha i permessi: vedi <code>deploy/README.md</code>.
      </p>
    </section>
  );
}
