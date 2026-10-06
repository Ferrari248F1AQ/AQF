import { api, post } from '../api';

/**
 * Registra la voce durante la lezione e la manda al Raspberry mentre parla.
 *
 * MediaRecorder consegna un blocco ogni pochi secondi; ogni blocco parte
 * subito, in ordine e con il suo numero, così il server lo accoda al file.
 * Se la rete cade, i blocchi aspettano in memoria e ripartono appena torna:
 * a fine lezione la registrazione è già quasi tutta sul disco.
 *
 * Safari (iPad) registra in AAC dentro MP4 frammentato, Chrome e Firefox in
 * Opus dentro WebM: entrambi si possono concatenare a blocchi.
 */
const BLOCCO_MS = 5000;

function formatoMigliore(): string {
  const candidati = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidati.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export function registrazioneSupportata(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

export class Registratore {
  private flusso: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private coda: Blob[] = [];
  private inviati = 0;
  private numero = 0;
  private invio: Promise<void> | null = null;
  private inizio = 0;
  private pagine: { t: number; pagina: number }[] = [];
  id: string | null = null;
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
      throw new Error('Questo browser non può registrare (serve HTTPS: apri la piattaforma dal tunnel o da localhost).');
    }
    this.flusso = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mime = formatoMigliore();
    this.recorder = new MediaRecorder(this.flusso, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    const r = await post<{ id: string }>('/api/registrazioni', { documento_id: documentoId, mime: this.recorder.mimeType || mime || 'audio/webm' });
    this.id = r.id;
    this.coda = [];
    this.inviati = 0;
    this.numero = 0;
    this.pagine = [{ t: 0, pagina }];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.coda.push(e.data);
        this.svuota();
      }
    };
    this.recorder.onstop = () => this.onCambio(false);
    this.recorder.start(BLOCCO_MS);
    this.inizio = performance.now();
    this.onCambio(true);
  }

  segnaPagina(pagina: number): void {
    if (!this.attivo) return;
    const ultima = this.pagine[this.pagine.length - 1];
    if (ultima?.pagina === pagina) return;
    this.pagine.push({ t: Math.round(this.secondi * 10) / 10, pagina });
  }

  private svuota(): void {
    if (this.invio) return;
    this.invio = (async () => {
      let attesa = 1000;
      while (this.coda.length > 0 && this.id) {
        const blocco = this.coda[0]!;
        try {
          const risposta = await fetch(`/api/registrazioni/${this.id}/pezzi/${this.numero}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'x-aqf': '1', 'content-type': 'application/octet-stream' },
            body: blocco,
          });
          if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
          this.coda.shift();
          this.numero++;
          this.inviati++;
          attesa = 1000;
        } catch {
          // Rete assente: si riprova con calma, senza perdere il blocco.
          await new Promise((ok) => setTimeout(ok, attesa));
          attesa = Math.min(attesa * 2, 15_000);
        }
      }
    })().finally(() => {
      this.invio = null;
      if (this.coda.length > 0) this.svuota();
    });
  }

  async ferma(): Promise<void> {
    const rec = this.recorder;
    if (!rec || !this.id) return;
    const durata = this.secondi;
    if (rec.state !== 'inactive') {
      await new Promise<void>((ok) => {
        rec.addEventListener('stop', () => ok(), { once: true });
        rec.stop();
      });
    }
    this.flusso?.getTracks().forEach((t) => t.stop());
    this.flusso = null;
    // Gli ultimi blocchi: si aspetta che arrivino, ma non all'infinito.
    const limite = Date.now() + 20_000;
    while ((this.coda.length > 0 || this.invio) && Date.now() < limite) {
      await (this.invio ?? new Promise((ok) => setTimeout(ok, 200)));
    }
    const id = this.id;
    this.id = null;
    this.inizio = 0;
    this.recorder = null;
    await api('POST', `/api/registrazioni/${id}/fine`, { durata_s: durata, pagine: this.pagine }, { keepalive: true });
  }
}
