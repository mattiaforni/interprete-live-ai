// Relay dei sottotitoli verso i telefoni degli ospiti tramite Firebase Realtime Database.
// Struttura: eventi/{eventId}/{lang}/current = { text, t }   (riga in corso)
//            eventi/{eventId}/{lang}/lines/{pushId} = { text, t }  (righe concluse)
//
// Il PC operatore scrive, i telefoni leggono. Se window.FIREBASE_CONFIG è null il relay è spento.

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

let db = null;

async function loadScript(src) {
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('impossibile caricare ' + src));
    document.head.appendChild(s);
  });
}

/**
 * @param {{auth?: boolean}} [opts]  auth: true → accesso anonimo, necessario per scrivere
 *   (le regole del database permettono la scrittura solo a utenti autenticati).
 */
export async function initFirebase(opts = {}) {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) return null;
  if (!window.firebase) {
    await loadScript(`${SDK}/firebase-app-compat.js`);
    await loadScript(`${SDK}/firebase-database-compat.js`);
    if (opts.auth) await loadScript(`${SDK}/firebase-auth-compat.js`);
  }
  if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
  if (opts.auth) {
    const auth = window.firebase.auth();
    if (!auth.currentUser) await auth.signInAnonymously();
  }
  db = window.firebase.database();
  return db;
}

export class Relay {
  constructor(eventId) {
    this.eventId = eventId || 'evento';
    this.enabled = !!db;
    this.lastPartial = {}; // per lingua: originale, IT e FR scrivono in parallelo
  }

  base(lang) { return db.ref(`eventi/${this.eventId}/${lang}`); }

  /** Riga in corso: la scriviamo al massimo ~4 volte al secondo per non intasare. */
  partial(lang, text) {
    if (!this.enabled) return;
    const now = Date.now();
    if (text !== '' && now - (this.lastPartial[lang] || 0) < 250) return;
    this.lastPartial[lang] = now;
    this.base(lang).child('current').set({ text, t: now });
  }

  final(lang, text) {
    if (!this.enabled) return;
    const now = Date.now();
    this.base(lang).child('lines').push({ text, t: now });
    this.base(lang).child('current').set({ text: '', t: now });
  }

  /** Pulisce le righe di una lingua (da usare prima dell'evento). */
  async clear(lang) {
    if (!this.enabled) return;
    await this.base(lang).remove();
  }
}

/**
 * Ascolta una lingua (telefono, schermo in modalità Firebase).
 * @param {{history?: number}} [opts]  history: quante righe passate caricare (0 = solo da adesso in poi)
 */
export function subscribe(eventId, lang, { onCurrent, onLine }, { history = 30 } = {}) {
  if (!db) throw new Error('Firebase non configurato');
  const base = db.ref(`eventi/${eventId}/${lang}`);
  const cur = base.child('current');
  const lines = base.child('lines');
  let first = true;
  const curCb = cur.on('value', (snap) => {
    // Con history 0 ignoriamo il valore già presente (riga rimasta a metà da una sessione precedente).
    if (first && history === 0) { first = false; return; }
    first = false;
    onCurrent((snap.val() || {}).text || '');
  });
  let q = null, cb = null, cancelled = false;
  const attach = (query) => { q = query; cb = q.on('child_added', (snap) => onLine(snap.val())); };
  if (history > 0) attach(lines.limitToLast(history));
  else lines.orderByKey().limitToLast(1).once('value').then((snap) => {
    if (cancelled) return;
    let last = null; snap.forEach((c) => { last = c.key; });
    attach(last ? lines.orderByKey().startAfter(last) : lines.orderByKey());
  });
  return () => { cancelled = true; cur.off('value', curCb); if (q) q.off('child_added', cb); };
}
