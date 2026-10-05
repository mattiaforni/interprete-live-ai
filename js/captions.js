// Sottotitoli "roll-up" come Meet / TV: le parole restano dove sono state scritte,
// le righe si riempiono da sinistra e quando il riquadro è pieno tutto sale di una riga.
//
// Perché funziona: l'impaginazione è "greedy" (riempi la riga finché c'è spazio, poi vai a capo).
// Se il testo cresce solo in coda, le righe già composte non cambiano mai. Il vecchio testo
// si toglie solo a righe intere dalla testa, che non altera le righe successive.

const KEEP_LINES = 8;      // righe tenute in memoria (ne mostriamo meno)
const PAUSE_MS = 2500;     // dopo una pausa il nuovo intervento parte a capo
const ROLL_MS = 220;       // durata dell'animazione di salita

export class Captions {
  /**
   * @param {HTMLElement} track  contiene .vp > .lines
   * @param {() => number} visibleLines
   */
  constructor(track, visibleLines) {
    this.track = track;
    this.vp = track.querySelector('.vp');
    this.box = track.querySelector('.lines');
    this.visibleLines = visibleLines;
    this.committed = [];          // parole concluse (e marcatori '\n')
    this.partials = new Map();    // sorgente → parole della riga in corso
    this.dropped = 0;             // righe tolte dalla testa (per contare le righe assolute)
    this.lastAbs = 0;             // indice assoluto dell'ultima riga mostrata
    this.lastText = 0;
    this.ctx = document.createElement('canvas').getContext('2d');
    this.fontKey = '';
    this.cache = new Map();
    this.space = 0;
  }

  get empty() { return !this.committed.length && !this.partials.size; }

  static words(t) { return (t || '').trim().split(/\s+/).filter(Boolean); }

  /** text '' con final=false ritira la riga in corso di quella sorgente. */
  push(src, text, final) {
    const now = Date.now();
    if (final && text === '\n') {             // a capo esplicito (cambio di lingua)
      const last = this.committed[this.committed.length - 1];
      if (this.committed.length && last !== '\n') this.committed.push('\n');
      this.render();
      return;
    }
    if (!final && text === '') {
      this.partials.delete(src);
    } else {
      const startsUtterance = !this.partials.size;
      const last = this.committed[this.committed.length - 1];
      if (startsUtterance && this.committed.length && last !== '\n' && now - this.lastText > PAUSE_MS) {
        this.committed.push('\n');
      }
      if (final) {
        this.committed.push(...Captions.words(text));
        this.partials.delete(src);
      } else {
        this.partials.set(src, Captions.words(text));
      }
      this.lastText = now;
    }
    this.render();
  }

  clear() {
    this.dropped += this.currentLines || 0;
    this.committed = [];
    this.partials.clear();
    this.render();
  }

  /** Da chiamare quando cambiano font, dimensione o larghezza. */
  invalidate() { this.fontKey = ''; this.render(true); }

  setupFont() {
    const cs = getComputedStyle(this.box);
    const key = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}|${cs.letterSpacing}`;
    if (key === this.fontKey) return;
    this.fontKey = key;
    this.ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in this.ctx) this.ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    this.cache.clear();
    this.space = this.ctx.measureText(' ').width;
    this.lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
  }

  measure(w) {
    let v = this.cache.get(w);
    if (v === undefined) { v = this.ctx.measureText(w).width; this.cache.set(w, v); }
    return v;
  }

  layout(width) {
    const items = this.committed.map((w) => ({ w, p: false }));
    for (const ws of this.partials.values()) for (const w of ws) items.push({ w, p: true });
    const lines = [];
    let cur = [], curW = 0, start = 0;
    items.forEach((it, i) => {
      if (it.w === '\n') {
        if (cur.length) { lines.push({ items: cur, start }); cur = []; curW = 0; }
        start = i + 1;
        return;
      }
      const ww = this.measure(it.w);
      const add = cur.length ? this.space + ww : ww;
      if (cur.length && curW + add > width) {
        lines.push({ items: cur, start });
        cur = [it]; curW = ww; start = i;
      } else {
        if (!cur.length) start = i;
        cur.push(it); curW += add;
      }
    });
    if (cur.length) lines.push({ items: cur, start });
    return lines;
  }

  render(force = false) {
    this.setupFont();
    const width = this.vp.clientWidth * 0.985;
    if (!width) return;
    let lines = this.layout(width);

    // Togli dalla testa righe intere già uscite dalla vista (solo testo concluso).
    const n = this.visibleLines();
    const keep = Math.max(KEEP_LINES, n + 2);
    if (lines.length > keep) {
      const k = lines.length - keep;
      const cut = lines[k].start;
      if (cut <= this.committed.length) {
        this.committed.splice(0, cut);
        this.dropped += k;
        lines = lines.slice(k);
      }
    }
    this.currentLines = lines.length;

    // Mostriamo N righe + 1 nascosta sopra, che serve all'animazione di salita.
    const show = lines.slice(-(n + 1));
    const frag = document.createDocumentFragment();
    for (const ln of show) {
      const div = document.createElement('div');
      div.className = 'ln';
      let run = null, runP = null;
      ln.items.forEach((it, j) => {
        const txt = (j ? ' ' : '') + it.w;
        if (run && runP === it.p) { run.textContent += txt; return; }
        run = document.createElement('span');
        if (it.p) run.className = 'p';
        run.textContent = txt; runP = it.p;
        div.appendChild(run);
      });
      frag.appendChild(div);
    }
    this.box.replaceChildren(frag);

    // Salita animata quando nasce una nuova riga in fondo.
    const abs = this.dropped + lines.length;
    const delta = abs - this.lastAbs;
    this.lastAbs = abs;
    if (!force && delta > 0 && delta <= 2 && lines.length) {
      const box = this.box;
      box.style.transition = 'none';
      box.style.transform = `translateY(${delta * this.lineH}px)`;
      void box.offsetHeight;
      box.style.transition = `transform ${ROLL_MS}ms ease-out`;
      box.style.transform = 'translateY(0)';
    }
  }
}
