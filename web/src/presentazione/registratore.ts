import { api, del, post } from '../api';

/**
 * Registra la voce durante la lezione e la manda al Raspberry mentre parla.
 *
 * MediaRecorder consegna un blocco ogni pochi secondi; ogni blocco parte
 * subito, in ordine e con il suo numero, così il server lo accoda al file.
 * Se la rete cade, i blocchi aspettano in memoria e ripartono appena torna.
 *
 * **Il formato si verifica, non si presume.** Safari su iPad dichiara di saper
 * registrare in WebM, ma con l'audio può consegnare blocchi vuoti: la lezione
 * risultava registrata, e il file era di 0 KB. Ora su Safari si prova prima
 * l'MP4 (il suo formato nativo), e un controllo dopo pochi secondi verifica che
 * l'audio arrivi davvero; se non arriva si passa al formato successivo, e se
 * nessuno funziona lo si dice subito, non a fine lezione.
 */
const BLOCCO_MS = 4000;
/** Entro quanto deve arrivare il primo audio. */
const PRIMO_AUDIO_MS = 9000;

function suWebKit(): boolean {
  const ua = navigator.userAgent;
  // Su iPad ogni browser è WebKit (anche Chrome, «CriOS»).
  if (/iPad|iPhone|iPod|CriOS|FxiOS|EdgiOS/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
}

/** I formati da provare, nell'ordine; '' = quello predefinito del browser. */
export function formatiDaProvare(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const mp4 = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  const webm = ['audio/webm;codecs=opus', 'audio/webm'];
  const ordine = suWebKit() ? [...mp4, ...webm] : [...webm, ...mp4];
  return [...ordine.filter((m) => MediaRecorder.isTypeSupported(m)), ''];
}

export function registrazioneSupportata(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

export class Registratore {
  private flusso: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private coda: Blob[] = [];
  private numero = 0;
  private invio: Promise<void> | null = null;
  private inizio = 0;
  private pagine: { t: number; pagina: number }[] = [];
  private controllo: ReturnType<typeof setTimeout> | undefined;
  private formati: string[] = [];
  private mime = '';
  id: string | null = null;
  /** Byte prodotti dal microfono e byte già arrivati al Raspberry. */
  byteRegistrati = 0;
  byteInviati = 0;
  onCambio: (attivo: boolean) => void = () => undefined;
  onErrore: (m: string) => void = () => undefined;

  get attivo(): boolean {
    return this.recorder?.state === 'recording';
  }

  get secondi(): number {
    return this.inizio ? (performance.now() - this.inizio) / 1000 : 0;
  }

  async avvia(documentoId: string | null, pagina: number): Promise<void> {
    if (this.attivo) return;
    if (!registrazioneSupportata()) {
      throw new Error('Questo browser non può registrare (serve HTTPS: apri la piattaforma dall’indirizzo del tunnel).');
    }
    this.flusso = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const traccia = this.flusso.getAudioTracks()[0];
    if (traccia) {
      traccia.onended = () => {
        if (this.recorder) this.onErrore('Il microfono è stato interrotto dal sistema: la registrazione si è fermata.');
      };
    }
    this.formati = formatiDaProvare();
    this.pagine = [{ t: 0, pagina }];
    this.inizio = performance.now();
    await this.provaFormato(documentoId);
  }

  /** Avvia il registratore con il prossimo formato della lista. */
  private async provaFormato(documentoId: string | null): Promise<void> {
    const mime = this.formati.shift();
    if (mime === undefined || !this.flusso) {
      this.chiudiFlusso();
      this.onCambio(false);
      throw new Error(
        'Il microfono non produce audio in nessun formato. Su iPad: Impostazioni → Safari → Microfono → Consenti, poi ricarica la pagina.',
      );
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.flusso, mime ? { mimeType: mime } : undefined);
    } catch {
      return this.provaFormato(documentoId);
    }
    this.mime = recorder.mimeType || mime || 'audio/mp4';
    const r = await post<{ id: string }>('/api/registrazioni', { documento_id: documentoId, mime: this.mime });
    this.id = r.id;
    this.recorder = recorder;
    this.coda = [];
    this.numero = 0;
    this.byteRegistrati = 0;
    this.byteInviati = 0;
    recorder.ondataavailable = (e) => {
      if (this.recorder !== recorder || e.data.size === 0) return;
      this.byteRegistrati += e.data.size;
      this.coda.push(e.data);
      this.svuota();
    };
    recorder.onerror = () => this.onErrore('Errore del registratore del browser.');
    recorder.onstop = () => {
      if (this.recorder === recorder) this.onCambio(false);
    };
    recorder.start(BLOCCO_MS);
    this.onCambio(true);

    // Il controllo: entro pochi secondi deve essere arrivato dell'audio vero.
    clearTimeout(this.controllo);
    this.controllo = setTimeout(() => {
      if (this.recorder !== recorder || this.byteRegistrati > 0) return;
      // Alcuni Safari consegnano solo su richiesta esplicita.
      try {
        recorder.requestData();
      } catch {
        /* già fermo */
      }
      this.controllo = setTimeout(() => {
        if (this.recorder !== recorder || this.byteRegistrati > 0) return;
        void this.scartaEPassaOltre(recorder, documentoId);
      }, 2500);
    }, PRIMO_AUDIO_MS);
  }

  private async scartaEPassaOltre(recorder: MediaRecorder, documentoId: string | null): Promise<void> {
    const vuota = this.id;
    this.recorder = null;
    this.id = null;
    recorder.ondataavailable = null;
    try {
      recorder.stop();
    } catch {
      /* niente */
    }
    if (vuota) await del(`/api/registrazioni/${vuota}`).catch(() => undefined);
    this.onErrore(
      this.formati.length > 0
        ? 'Dal microfono non arriva audio: riprovo con un altro formato…'
        : 'Dal microfono non arriva audio.',
    );
    try {
      await this.provaFormato(documentoId);
    } catch (err) {
      this.onErrore((err as Error).message);
    }
  }

  segnaPagina(pagina: number): void {
    if (!this.attivo) return;
    const ultima = this.pagine[this.pagine.length - 1];
    if (ultima?.pagina === pagina) return;
    this.pagine.push({ t: Math.round(this.secondi * 10) / 10, pagina });
  }

  private svuota(): void {
    if (this.invio) return;
    const id = this.id;
    this.invio = (async () => {
      let attesa = 1000;
      let avvisato = false;
      while (this.coda.length > 0 && id && this.id === id) {
        const blocco = this.coda[0]!;
        try {
          const risposta = await fetch(`/api/registrazioni/${id}/pezzi/${this.numero}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'x-aqf': '1', 'content-type': 'application/octet-stream' },
            body: blocco,
          });
          if (risposta.status === 401) {
            this.onErrore('Sessione scaduta: l’audio resta sull’iPad finché non rientri.');
            throw new Error('401');
          }
          if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
          this.coda.shift();
          this.numero++;
          this.byteInviati += blocco.size;
          attesa = 1000;
        } catch {
          // Rete assente: si riprova con calma, senza perdere il blocco.
          if (!avvisato && this.coda.length > 3) {
            avvisato = true;
            this.onErrore('Il Raspberry non risponde: l’audio è conservato e verrà inviato appena torna la rete.');
          }
          await new Promise((ok) => setTimeout(ok, attesa));
          attesa = Math.min(attesa * 2, 15_000);
        }
      }
    })().finally(() => {
      this.invio = null;
      if (this.coda.length > 0 && this.id) this.svuota();
    });
  }

  private chiudiFlusso(): void {
    this.flusso?.getTracks().forEach((t) => t.stop());
    this.flusso = null;
  }

  /** Ferma e chiude. Restituisce false se non è arrivato audio (e la registrazione vuota è stata tolta). */
  async ferma(): Promise<boolean> {
    clearTimeout(this.controllo);
    const rec = this.recorder;
    const id = this.id;
    if (!rec || !id) {
      this.chiudiFlusso();
      return false;
    }
    const durata = this.secondi;
    if (rec.state !== 'inactive') {
      await new Promise<void>((ok) => {
        rec.addEventListener('stop', () => ok(), { once: true });
        rec.stop();
      });
    }
    this.chiudiFlusso();
    // Gli ultimi blocchi: si aspetta che arrivino, ma non all'infinito.
    const limite = Date.now() + 20_000;
    while ((this.coda.length > 0 || this.invio) && Date.now() < limite) {
      await (this.invio ?? new Promise((ok) => setTimeout(ok, 200)));
    }
    this.id = null;
    this.inizio = 0;
    this.recorder = null;
    const r = await api<{ vuota?: boolean }>(
      'POST',
      `/api/registrazioni/${id}/fine`,
      {
        durata_s: durata,
        pagine: this.pagine,
        diagnostica: { mime: this.mime, registrati: this.byteRegistrati, inviati: this.byteInviati, ua: navigator.userAgent },
      },
      { keepalive: true },
    );
    return !r?.vuota;
  }
}
