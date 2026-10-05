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

export async function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) return null;
  if (!window.firebase) {
    await loadScript(`${SDK}/firebase-app-compat.js`);
    await loadScript(`${SDK}/firebase-database-compat.js`);
  }
  if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
  db = window.firebase.database();
  return db;
}

export class Relay {
  constructor(eventId) {
    this.eventId = eventId || 'evento';
    this.enabled = !!db;
    this.lastPartial = 0;
  }

  base(lang) { return db.ref(`eventi/${this.eventId}/${lang}`); }

  /** Riga in corso: la scriviamo al massimo ~4 volte al secondo per non intasare. */
  partial(lang, text) {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - this.lastPartial < 250) return;
    this.lastPartial = now;
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

/** Lato telefono: ascolta una lingua. */
export function subscribe(eventId, lang, { onCurrent, onLine }) {
  if (!db) throw new Error('Firebase non configurato');
  const base = db.ref(`eventi/${eventId}/${lang}`);
  base.child('current').on('value', (snap) => onCurrent((snap.val() || {}).text || ''));
  base.child('lines').limitToLast(30).on('child_added', (snap) => onLine(snap.val()));
  return () => base.off();
}
