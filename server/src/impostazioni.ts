/**
 * Le preferenze di ogni utente. Stanno sul server, non nel browser: si
 * ritrovano uguali dall'iPad, dal portatile e dopo aver svuotato la cache.
 */
export interface Impostazioni {
  cronometro: {
    /** Mostra il cronometro durante la presentazione. */
    attivo: boolean;
    /** Dopo quanti minuti fare la pausa. */
    minuti: number;
    /** Sempre ben visibile, invece di farsi notare man mano che ci si avvicina alla pausa. */
    sempreVisibile: boolean;
  };
  registrazione: {
    /** Parte da sola entrando nella presentazione. */
    automatica: boolean;
    /** Un puntino discreto mentre registra. Spento: sullo schermo non compare nulla. */
    indicatore: boolean;
  };
  /** Con il dito si disegna (utile senza Apple Pencil); altrimenti il dito sfoglia. */
  ditoDisegna: boolean;
}

export const PREDEFINITE: Impostazioni = {
  cronometro: { attivo: true, minuti: 45, sempreVisibile: false },
  registrazione: { automatica: false, indicatore: false },
  ditoDisegna: false,
};

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function normalizza(grezze: unknown): Impostazioni {
  const g = (grezze && typeof grezze === 'object' ? grezze : {}) as Record<string, any>;
  const c = g.cronometro ?? {};
  const r = g.registrazione ?? {};
  const minuti = Number(c.minuti);
  return {
    cronometro: {
      attivo: bool(c.attivo, PREDEFINITE.cronometro.attivo),
      minuti: Number.isFinite(minuti) ? Math.min(240, Math.max(5, Math.round(minuti))) : PREDEFINITE.cronometro.minuti,
      sempreVisibile: bool(c.sempreVisibile, PREDEFINITE.cronometro.sempreVisibile),
    },
    registrazione: {
      automatica: bool(r.automatica, PREDEFINITE.registrazione.automatica),
      indicatore: bool(r.indicatore, PREDEFINITE.registrazione.indicatore),
    },
    ditoDisegna: bool(g.ditoDisegna, PREDEFINITE.ditoDisegna),
  };
}

export function unisci(attuali: Impostazioni, modifica: unknown): Impostazioni {
  const m = (modifica && typeof modifica === 'object' ? modifica : {}) as Record<string, any>;
  return normalizza({
    ...attuali,
    ...m,
    cronometro: { ...attuali.cronometro, ...(m.cronometro ?? {}) },
    registrazione: { ...attuali.registrazione, ...(m.registrazione ?? {}) },
  });
}
