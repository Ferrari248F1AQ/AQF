import { useCallback, useEffect, useState } from 'react';

/**
 * Schermo intero vero, senza barra degli indirizzi.
 *
 * `position: fixed` copre la pagina ma non il browser: su un tablet la barra
 * degli indirizzi e le schede restano lì a rubare il foglio. Serve la
 * Fullscreen API, che Safari su iPad espone ancora col prefisso `webkit`, e
 * che il browser concede solo dentro un gesto dell'utente — per questo si
 * chiama dal clic che apre la correzione, prima di qualunque `await`.
 *
 * Su iPhone Safari non la concede alle pagine: lì lo schermo intero si ottiene
 * solo aggiungendo la piattaforma alla schermata Home (vedi il manifest), e da lì la
 * pagina si apre già senza barra.
 */
type ConPrefisso = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type ElementoConPrefisso = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = (): ConPrefisso => document as ConPrefisso;

export function schermoInteroSupportato(): boolean {
  return Boolean(document.fullscreenEnabled || doc().webkitFullscreenEnabled);
}

export function inSchermoIntero(): boolean {
  return Boolean(document.fullscreenElement || doc().webkitFullscreenElement);
}

/** Aperta dalla schermata Home: il browser non ha barre da togliere. */
export function inAppInstallata(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iPad e iPhone, in Safari e non dall'icona della schermata Home.
 *
 * Lì lo schermo intero della Fullscreen API è una trappola: Safari ci aggiunge
 * un suo gesto, «scorri verso il basso per uscire», che scatta al primo palmo
 * appoggiato o al primo tocco un po' trascinato, e nessuna pagina può
 * impedirlo. Su questi dispositivi non lo si chiede affatto: lo schermo intero
 * vero è la piattaforma aperto dall'icona sulla schermata Home, che non ha barre e non
 * ha gesti per uscire.
 */
export function suIosNelBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && !inAppInstallata();
}

/**
 * `ancheIos`: per le pagine che nessuno tocca — il
 * gesto di Safari che fa uscire non è un rischio, e lo schermo intero serve.
 */
export function entraSchermoIntero(opzioni: { ancheIos?: boolean } = {}): void {
  if (inSchermoIntero() || inAppInstallata() || (!opzioni.ancheIos && suIosNelBrowser())) return;
  const el = document.documentElement as ElementoConPrefisso;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    // Rifiutata (niente gesto, o browser che non vuole): si resta come si è.
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
  } catch {
    /* idem */
  }
}

export function esciSchermoIntero(): void {
  if (!inSchermoIntero()) return;
  try {
    const r = document.exitFullscreen ? document.exitFullscreen() : doc().webkitExitFullscreen?.();
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
  } catch {
    /* idem */
  }
}

/** Stato e interruttore, aggiornati anche quando si esce con Esc o col gesto del sistema. */
export function useSchermoIntero(opzioni: { ancheIos?: boolean } = {}): {
  attivo: boolean;
  supportato: boolean;
  alterna: () => void;
} {
  const ancheIos = opzioni.ancheIos === true;
  const [attivo, setAttivo] = useState(inSchermoIntero);
  useEffect(() => {
    const aggiorna = (): void => setAttivo(inSchermoIntero());
    document.addEventListener('fullscreenchange', aggiorna);
    document.addEventListener('webkitfullscreenchange', aggiorna);
    return () => {
      document.removeEventListener('fullscreenchange', aggiorna);
      document.removeEventListener('webkitfullscreenchange', aggiorna);
    };
  }, []);
  const alterna = useCallback(
    () => (inSchermoIntero() ? esciSchermoIntero() : entraSchermoIntero({ ancheIos })),
    [ancheIos],
  );
  return {
    attivo,
    supportato: schermoInteroSupportato() && !inAppInstallata() && (ancheIos || !suIosNelBrowser()),
    alterna,
  };
}
