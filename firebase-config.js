// Configurazione Firebase per il relay verso i telefoni degli ospiti.
// Non è un segreto: identifica il progetto; la protezione sta nelle regole del
// Realtime Database (scrittura solo con accesso anonimo autenticato) e in Authentication.
// Per spegnere il relay: window.FIREBASE_CONFIG = null;

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCFde1GoXyJQW_GFYFWfJ7tvKAtNhLrA50",
  authDomain: "interprete-live-ai-lama.firebaseapp.com",
  databaseURL: "https://interprete-live-ai-lama-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "interprete-live-ai-lama",
  storageBucket: "interprete-live-ai-lama.firebasestorage.app",
  messagingSenderId: "331030762807",
  appId: "1:331030762807:web:55b1a524ada6326975f6b2",
};
