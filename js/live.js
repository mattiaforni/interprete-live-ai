// Una sessione Live API (WebSocket BidiGenerateContent) con il modello di traduzione.
// Riceve PCM 16 kHz, restituisce testo: la trascrizione dell'originale (inputTranscription)
// e la trascrizione della traduzione (outputTranscription). L'audio prodotto dal modello
// viene ignorato: a noi servono solo i sottotitoli.
//
// Gestisce: riconnessione con session resumption (la connessione dura ~10 min),
// goAway, compressione del contesto per sessioni lunghe, log degli errori.

import { int16ToBase64 } from './audio.js';

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview';

export class LiveSession {
  /**
   * @param {object} o
   * @param {string} o.apiKey
   * @param {string} o.target   codice BCP-47 della lingua di destinazione ("it", "fr", "en")
   * @param {string} [o.model]
   * @param {boolean} [o.echo]  se true, chi parla già nella lingua target viene "ripetuto" tale e quale
   * @param {boolean} [o.resumption]
   * @param {boolean} [o.compression]
   * @param {(kind:'in'|'out', text:string, final:boolean)=>void} o.onText
   * @param {(status:string)=>void} [o.onStatus]
   * @param {(msg:string)=>void} [o.onLog]
   */
  constructor(o) {
    this.o = { model: DEFAULT_MODEL, echo: true, resumption: true, compression: true, ...o };
    this.ws = null;
    this.ready = false;
    this.closing = false;
    this.handle = null;        // session resumption handle
    this.bufIn = '';
    this.bufOut = '';
    this.retries = 0;
    this.bytesSent = 0;
    this.openedAt = null;
  }

  get target() { return this.o.target; }

  log(m) { if (this.o.onLog) this.o.onLog(`[${this.o.target}] ${m}`); }
  status(s) { if (this.o.onStatus) this.o.onStatus(s); }

  connect() {
    this.closing = false;
    this.ready = false;
    this.status('connecting');
    const url = `${WS_BASE}?key=${encodeURIComponent(this.o.apiKey)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.openedAt = Date.now();
      const generationConfig = {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: this.o.target,
          echoTargetLanguage: !!this.o.echo,
        },
      };
      const setup = { model: `models/${this.o.model}`, generationConfig };
      if (this.o.resumption) setup.sessionResumption = this.handle ? { handle: this.handle } : {};
      if (this.o.compression) setup.contextWindowCompression = { slidingWindow: {} };
      ws.send(JSON.stringify({ setup }));
      this.log(`WebSocket aperto, setup inviato${this.handle ? ' (ripresa sessione)' : ''}`);
    };

    ws.onmessage = async (ev) => {
      let data = ev.data;
      if (data instanceof Blob) data = await data.text();
      let msg;
      try { msg = JSON.parse(data); } catch { this.log('messaggio non JSON ignorato'); return; }
      this.handleMessage(msg);
    };

    ws.onerror = () => { this.log('errore WebSocket'); };

    ws.onclose = (ev) => {
      const wasReady = this.ready;
      this.ready = false;
      this.log(`chiuso (code ${ev.code}${ev.reason ? ': ' + ev.reason : ''})`);
      if (this.closing) { this.status('closed'); return; }
      // Riconnessione automatica. Se avevamo un handle, riprendiamo la sessione.
      const delay = wasReady ? 300 : Math.min(8000, 1000 * 2 ** this.retries++);
      this.status('reconnecting');
      setTimeout(() => { if (!this.closing) this.connect(); }, delay);
    };
  }

  handleMessage(msg) {
    if (msg.setupComplete) {
      this.ready = true;
      this.retries = 0;
      this.status('ready');
      this.log('setup completato');
      return;
    }
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) this.handle = u.newHandle;
      return;
    }
    if (msg.goAway) {
      this.log(`goAway: il server chiude tra ${msg.goAway.timeLeft || '?'} — riconnessione`);
      // Apriamo subito una nuova connessione con l'handle; la vecchia verrà chiusa dal server.
      return;
    }
    if (msg.usageMetadata) return;
    const sc = msg.serverContent;
    if (!sc) {
      if (msg.error) this.log('errore: ' + JSON.stringify(msg.error));
      return;
    }
    if (sc.inputTranscription && sc.inputTranscription.text) {
      this.bufIn += sc.inputTranscription.text;
      this.o.onText('in', this.bufIn, false);
    }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      this.bufOut += sc.outputTranscription.text;
      this.o.onText('out', this.bufOut, false);
    }
    if (sc.interrupted) {
      // Il modello è stato interrotto: chiudiamo la riga corrente così com'è.
      this.finalize();
    }
    if (sc.turnComplete || sc.generationComplete) {
      this.finalize();
    }
  }

  finalize() {
    if (this.bufIn.trim()) this.o.onText('in', this.bufIn.trim(), true);
    if (this.bufOut.trim()) this.o.onText('out', this.bufOut.trim(), true);
    this.bufIn = '';
    this.bufOut = '';
  }

  /** @param {Int16Array} pcm */
  sendAudio(pcm) {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const data = int16ToBase64(pcm);
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }));
    this.bytesSent += pcm.byteLength;
  }

  /** Segnala una pausa del microfono così il server svuota il buffer. */
  endAudioStream() {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    }
  }

  close() {
    this.closing = true;
    this.finalize();
    if (this.ws) { try { this.ws.close(1000, 'stop'); } catch { /* ignore */ } }
    this.ws = null;
    this.ready = false;
    this.status('closed');
  }
}
