import { useCallback, useEffect, useState } from 'react';
import { data, del, get, patch, post, type UtenteGestito } from '../api';
import { avvisa, chiediTesto, conferma, Tendina } from '../dialoghi';
import { useSessione } from '../sessione';

export function Utenti() {
  const { utente } = useSessione();
  const [elenco, setElenco] = useState<UtenteGestito[] | null>(null);
  const [nuovo, setNuovo] = useState({ nome: '', email: '', password: '', admin: false });
  const [errore, setErrore] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    try {
      setElenco(await get<UtenteGestito[]>('/api/utenti'));
    } catch (err) {
      avvisa((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  const azione = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) avvisa(ok);
    } catch (err) {
      avvisa((err as Error).message);
    }
    await ricarica();
  };

  return (
    <div>
      <h1>Utenti</h1>
      <p className="nota">Chi può accedere alla piattaforma. Ogni utente vede solo i propri documenti e le proprie registrazioni.</p>

      <div className="elenco" style={{ margin: '16px 0 24px' }}>
        {elenco?.map((u) => (
          <div key={u.id} className="scheda riga" style={{ opacity: u.attivo ? 1 : 0.6 }}>
            <div className="principale">
              <strong>{u.nome}</strong> {u.ruolo === 'admin' && <span className="nota">· amministratore</span>}
              {!u.attivo && <span className="errore"> · disattivato</span>}
              {u.id === utente?.id && <span className="nota"> · sei tu</span>}
              <div className="nota" style={{ overflowWrap: 'anywhere' }}>
                {u.email} · ultimo accesso: {data(u.ultimo_accesso)}
              </div>
            </div>
            <Tendina
              voci={[
                {
                  testo: '✏️ Rinomina',
                  azione: async () => {
                    const n = await chiediTesto('Nome', 'Nome e cognome', u.nome);
                    if (n) await azione(() => patch(`/api/utenti/${u.id}`, { nome: n }));
                  },
                },
                {
                  testo: '🔑 Imposta una nuova password',
                  azione: async () => {
                    const p = await chiediTesto(`Nuova password per ${u.nome}`, 'Almeno 10 caratteri', '', 'Imposta');
                    if (p) await azione(() => patch(`/api/utenti/${u.id}`, { password: p }), 'Password impostata.');
                  },
                },
                {
                  testo: u.ruolo === 'admin' ? '⬇️ Togli i permessi di amministratore' : '⬆️ Rendi amministratore',
                  azione: () => void azione(() => patch(`/api/utenti/${u.id}`, { ruolo: u.ruolo === 'admin' ? 'utente' : 'admin' })),
                },
                ...(u.id !== utente?.id
                  ? [
                      {
                        testo: u.attivo ? '⏸ Disattiva l’accesso' : '▶︎ Riattiva l’accesso',
                        azione: () => void azione(() => patch(`/api/utenti/${u.id}`, { attivo: !u.attivo })),
                      },
                      'separatore' as const,
                      {
                        testo: '🗑️ Elimina',
                        pericolo: true,
                        azione: async () => {
                          if (await conferma('Eliminare l’utente?', `${u.nome} (${u.email}) non potrà più accedere.`, { conferma: 'Elimina', pericolo: true }))
                            await azione(() => del(`/api/utenti/${u.id}`), 'Utente eliminato.');
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ))}
      </div>

      <section className="scheda sezione">
        <h2>Aggiungi un utente</h2>
        <form
          style={{ display: 'grid', gap: 12, maxWidth: 420 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setErrore(null);
            try {
              await post('/api/utenti', { nome: nuovo.nome, email: nuovo.email, password: nuovo.password, ruolo: nuovo.admin ? 'admin' : 'utente' });
              setNuovo({ nome: '', email: '', password: '', admin: false });
              avvisa('Utente aggiunto.');
              await ricarica();
            } catch (err) {
              setErrore((err as Error).message);
            }
          }}
        >
          <label className="campo">
            <span>Nome e cognome</span>
            <input value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} required />
          </label>
          <label className="campo">
            <span>Email</span>
            <input type="email" autoCapitalize="none" value={nuovo.email} onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })} required />
          </label>
          <label className="campo">
            <span>Password iniziale (almeno 10 caratteri)</span>
            <input type="text" autoComplete="off" value={nuovo.password} onChange={(e) => setNuovo({ ...nuovo, password: e.target.value })} required minLength={10} />
          </label>
          <label className="interruttore" style={{ padding: 0 }}>
            <input type="checkbox" checked={nuovo.admin} onChange={(e) => setNuovo({ ...nuovo, admin: e.target.checked })} />
            <span>Amministratore (gestisce utenti e archivi)</span>
          </label>
          {errore && <div className="errore">{errore}</div>}
          <div>
            <button type="submit" className="pulsante primario">
              Aggiungi
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
