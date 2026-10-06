import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ErroreApi, get, patch, post, quandoNonAutenticato, type Impostazioni, type Profilo } from './api';

interface Sessione {
  utente: Profilo | null;
  caricata: boolean;
  entra: (email: string, password: string) => Promise<void>;
  esci: () => Promise<void>;
  aggiornaImpostazioni: (modifica: DeepPartial<Impostazioni>) => Promise<void>;
  ricarica: () => Promise<void>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const Contesto = createContext<Sessione | null>(null);

export function FornitoreSessione({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<Profilo | null>(null);
  const [caricata, setCaricata] = useState(false);

  const ricarica = useCallback(async () => {
    try {
      setUtente(await get<Profilo>('/api/io'));
    } catch (err) {
      if (err instanceof ErroreApi && err.stato === 401) setUtente(null);
    } finally {
      setCaricata(true);
    }
  }, []);

  useEffect(() => {
    quandoNonAutenticato(() => setUtente(null));
    void ricarica();
  }, [ricarica]);

  const entra = useCallback(async (email: string, password: string) => {
    setUtente(await post<Profilo>('/api/accesso', { email, password }));
  }, []);

  const esci = useCallback(async () => {
    try {
      await post('/api/uscita');
    } finally {
      setUtente(null);
    }
  }, []);

  const aggiornaImpostazioni = useCallback(async (modifica: DeepPartial<Impostazioni>) => {
    // Subito a schermo, poi sul server: il cronometro non deve aspettare la rete.
    setUtente((u) =>
      u
        ? {
            ...u,
            impostazioni: {
              ...u.impostazioni,
              ...(modifica as Partial<Impostazioni>),
              cronometro: { ...u.impostazioni.cronometro, ...(modifica.cronometro ?? {}) },
              registrazione: { ...u.impostazioni.registrazione, ...(modifica.registrazione ?? {}) },
            },
          }
        : u,
    );
    setUtente(await patch<Profilo>('/api/io', { impostazioni: modifica }));
  }, []);

  return (
    <Contesto.Provider value={{ utente, caricata, entra, esci, aggiornaImpostazioni, ricarica }}>{children}</Contesto.Provider>
  );
}

export function useSessione(): Sessione {
  const s = useContext(Contesto);
  if (!s) throw new Error('useSessione fuori dal fornitore');
  return s;
}
