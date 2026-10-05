// Instradamento dei sottotitoli: decide quale sessione alimenta quale canale.
//
// Problema: ogni sessione (IT, FR, …) riceve lo stesso audio. Quella la cui lingua di
// destinazione coincide con la lingua parlata dovrebbe tacere, ma il modello in preview
// a volte ripete l'originale. Se due sessioni scrivono nello stesso canale, le parole
// si spingono a vicenda e il sottotitolo "scorre".
//
// Soluzione: riconosciamo la lingua parlata dalla trascrizione originale (parole funzionali
// tipiche di ciascuna lingua) e:
//   - il canale di una lingua tace quando si parla quella lingua (salvo "echo" attivo);
//   - il canale 'auto' riceve UNA sola sessione: quella nella lingua che non si sta parlando.
// Se la lingua non è ancora nota si ricade sul confronto per somiglianza con l'originale.

const STOP = {
  it: 'che di del della delle dei degli nel nella nei con non per una sono questo questa questi quello anche come più molto abbiamo siamo stato essere perché quindi allora cosa già gli lo ed e è ci mi ti io noi voi loro hanno ha ho fatto fare tutti tutto ogni dove quando oggi sempre ancora proprio bene grazie',
  fr: 'de des du et est que qui pas pour une dans nous vous je ce cette ces sur avec mais plus au aux sont avons très aussi donc alors oui être ça on elle ils leur notre nos votre fait faire tous tout chaque où quand aujourd hui été toujours encore vraiment bien merci',
  en: 'the and of to is that we you this with for are not have was be our they what so there which would about thank',
};
const SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
const HINTS = { fr: /[çêôûëïœ]/g, it: /[òì]/g };

/** @returns {{lang: string|null, scores: object}} */
export function detectLang(text) {
  const toks = (text || '').toLowerCase().split(/[^a-zà-ÿœ]+/).filter(Boolean);
  const scores = { it: 0, fr: 0, en: 0 };
  for (const t of toks) for (const k of Object.keys(SETS)) if (SETS[k].has(t)) scores[k]++;
  for (const [k, re] of Object.entries(HINTS)) scores[k] += ((text || '').toLowerCase().match(re) || []).length;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const lang = (best[1] >= 3 && best[1] >= 2 * second[1]) || (best[1] >= 2 && second[1] === 0) ? best[0] : null;
  return { lang, scores };
}

const words4 = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{4,}/g) || [];
/** La "traduzione" ripete l'originale? (≥ 60% delle parole lunghe in comune) */
export function isEcho(out, inText) {
  const o = words4(out), i = new Set(words4(inText));
  if (o.length < 2 || i.size < 2) return false;
  return o.filter((w) => i.has(w)).length / o.length >= 0.6;
}

const AUTO_PREF = { it: ['fr', 'en'], fr: ['it', 'en'], en: ['it', 'fr'] };
// Una riga in uscita si mostra solo da qui in su: prima non si può giudicare se è un'eco,
// e mostrarla per poi ritirarla farebbe saltare il testo.
const MIN_WORDS = 3;
const nWords = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;

export class Router {
  /**
   * @param {object} o
   * @param {string[]} o.langs           lingue delle sessioni attive, la prima fornisce l'originale
   * @param {(ch:string, text:string, final:boolean)=>void} o.emit   ch ∈ langs ∪ {'orig','auto'}; text '' e final=false = ritira
   * @param {() => boolean} o.echo       echo attivo: nessun canale viene zittito
   * @param {() => boolean} o.filter     filtro lingua parlata attivo
   * @param {(spoken:string)=>void} [o.onSpoken]
   * @param {(m:string)=>void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.spoken = null;
    this.out = {};        // sessione → riga in corso
    this.inBuf = {};      // sessione → trascrizione originale in corso
    this.origUtter = '';  // intervento in corso (dalla prima sessione)
    this.origTail = '';   // coda dell'intervento precedente, per avere contesto
    this.shown = {};      // canale → c'è una riga parziale visibile
    this.autoSticky = null;
    this.lastOut = {};    // ultima riga conclusa per sessione (per giudicare l'eco sulle righe finali)
    this.lastIn = {};
  }

  allowed(lang) {
    if (this.o.echo() || !this.o.filter()) return true;
    if (this.spoken && lang === this.spoken) return false;
    return !isEcho(this.out[lang] || this.lastOut[lang], this.inBuf[lang] || this.lastIn[lang]);
  }

  /** Abbastanza testo per decidere? Le righe concluse si giudicano sempre. */
  ready(text, final) { return final || !this.o.filter() || this.o.echo() || nWords(text) >= MIN_WORDS; }

  autoSource() {
    if (this.spoken) {
      const pref = (AUTO_PREF[this.spoken] || []).filter((l) => this.o.langs.includes(l));
      return pref.find((l) => this.allowed(l)) || null;
    }
    return this.autoSticky && this.allowed(this.autoSticky) ? this.autoSticky : null;
  }

  /** Canale auto: quando cambia la lingua mostrata, la nuova parte a capo ('\n' = a capo). */
  sendAuto(src, text, final) {
    if (this.lastAutoSrc && this.lastAutoSrc !== src) { this.retract('auto'); this.o.emit('auto', '\n', true); }
    this.lastAutoSrc = src;
    this.send('auto', text, final);
  }

  send(ch, text, final) { this.o.emit(ch, text, final); this.shown[ch] = !final && text !== ''; }
  retract(ch) { if (this.shown[ch]) { this.o.emit(ch, '', false); this.shown[ch] = false; } }

  onInput(lang, text, final) {
    this.inBuf[lang] = final ? '' : text;
    if (final) this.lastIn[lang] = text;
    if (lang !== this.o.langs[0]) return;
    this.send('orig', text, final);
    // Prima l'intervento in corso da solo (cambio di oratore più rapido), poi con il contesto.
    // Solo l'intervento in corso: il contesto precedente rallenterebbe il cambio di oratore.
    // All'avvio (lingua ancora ignota) usiamo anche la coda precedente.
    let d = detectLang(text);
    if (!d.lang && !this.spoken) d = detectLang(this.origTail + ' ' + text);
    if (final) { this.origTail = text.split(/\s+/).slice(-20).join(' '); }
    if (d.lang && d.lang !== this.spoken) {
      const prev = this.spoken;
      this.spoken = d.lang;
      if (this.o.log) this.o.log(`lingua parlata: ${d.lang.toUpperCase()}${prev ? ' (era ' + prev.toUpperCase() + ')' : ''}`);
      if (this.o.onSpoken) this.o.onSpoken(d.lang);
      this.refresh();
    }
  }

  onOutput(lang, text, final) {
    this.out[lang] = final ? '' : text;
    if (final) this.lastOut[lang] = text;
    if (!this.ready(text, final)) return;           // troppo presto per giudicare: aspettiamo
    if (!this.spoken && !this.autoSticky && this.allowed(lang)) this.autoSticky = lang;
    if (this.allowed(lang)) this.send(lang, text, final);
    else { this.retract(lang); if (final && this.o.log) this.o.log(`[${lang}] scartata ripetizione dell'originale`); }
    if (this.autoSource() === lang) this.sendAuto(lang, text, final);
    else if (final) { /* nulla: il canale auto segue un'altra sessione */ }
    if (final && this.autoSticky === lang) this.autoSticky = null;
    if (final) { delete this.lastOut[lang]; }
  }

  /** Dopo un cambio di lingua parlata: ritira ciò che ora è vietato, mostra ciò che ora è ammesso. */
  refresh() {
    for (const l of this.o.langs) {
      if (!this.allowed(l)) this.retract(l);
      else if (this.out[l] && this.ready(this.out[l], false)) this.send(l, this.out[l], false);
    }
    const src = this.autoSource();
    if (src && this.out[src] && this.ready(this.out[src], false)) this.sendAuto(src, this.out[src], false);
    else this.retract('auto');
  }

  reset() {
    this.spoken = null; this.out = {}; this.inBuf = {}; this.origUtter = ''; this.origTail = ''; this.shown = {}; this.autoSticky = null;
    this.lastOut = {}; this.lastIn = {}; this.lastAutoSrc = null;
  }
}
