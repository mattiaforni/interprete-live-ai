# Interprete live AI

Sottotitoli tradotti in tempo reale per un evento in sala, con la Gemini Live API
(modello `gemini-3.5-live-translate-preview`). Nessun backend: tre pagine statiche
pubblicate su GitHub Pages.

| Pagina | A cosa serve | Dove gira |
|---|---|---|
| `index.html` | **Operatore**: riceve l'audio dal mixer, apre le sessioni AI, mostra anteprima e log | PC in regia |
| `schermo.html?lang=it` | **Maxischermo**: solo il testo, a tutto schermo | Stesso PC, seconda finestra sul proiettore |
| `telefono.html?lang=fr` | **Ospiti**: sottotitoli in francese (schede Français / Italiano / V.O.), stile TEST, testo regolabile A−/A+, tema chiaro/scuro | Telefoni, tramite relay Firebase |

Come funziona: il PC operatore cattura l'audio (PCM 16 kHz) e lo manda in parallelo a una
sessione Live per ogni lingua scelta. Il modello restituisce audio tradotto (che ignoriamo)
e la trascrizione testuale della traduzione, che diventa il sottotitolo. Lo schermo riceve
il testo via `BroadcastChannel` (stesso browser, nessuna rete); i telefoni lo ricevono via
Firebase Realtime Database.

Ogni schermo mostra solo le traduzioni: la sessione IT traduce i francesi e resta muta
quando parla un italiano (che il pubblico capisce già); la sessione FR fa il contrario.
La direzione si inverte da sola. L'opzione "echo lingua target" (spenta di default) fa
trascrivere anche chi parla già nella lingua di destinazione, utile per l'accessibilità.

## Setup

### 1. Chiave API e fatturazione (una volta)
1. [Google AI Studio](https://aistudio.google.com) → *Get API key* → crea una chiave collegata a un progetto Google Cloud.
2. Nel progetto Cloud attiva la **fatturazione**: il tier a pagamento ha limiti più alti e non usa i dati inviati per l'addestramento.
3. Costo indicativo del modello di traduzione: ~0,037 $ al minuto per stream. Con IT + FR sono due stream: 30 minuti ≈ 2,5 $.

La chiave si incolla nella pagina operatore e resta nel `localStorage` di quel browser. Non va mai committata.

### 2. GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / root. L'URL sarà
`https://mattiaforni.github.io/interprete-live-ai/`. Serve HTTPS per l'accesso al microfono.

### 3. Audio in sala
- Chiedere al service un **aux / line out con i soli microfoni dei relatori** (niente playback, niente musica).
- Entrare nel PC con un'interfaccia audio USB (o il mixer stesso se ha uscita USB).
- Nella pagina operatore scegliere quell'ingresso. Il browser disattiva già cancellazione eco, soppressione rumore e gain automatico.
- Il VU-meter deve muoversi bene senza stare sempre al massimo.

### 4. Relay Firebase (solo per i telefoni degli ospiti)
1. [Firebase console](https://console.firebase.google.com) → nuovo progetto (Analytics non serve).
2. **Build → Realtime Database** → crea, regione Europa (`europe-west1`), **modalità di blocco**.
3. **Build → Authentication** → *Inizia* → *Metodo di accesso* → **Anonimo** → Abilita.
   La pagina operatore si autentica da sola all'avvio; i telefoni leggono senza login.
4. Realtime Database → tab **Regole**, sostituisci tutto e pubblica:
   ```json
   {
     "rules": {
       "eventi": {
         "$evento": {
           ".read": true,
           ".write": "auth != null",
           "$lang": {
             "current": { ".validate": "newData.hasChildren(['text','t']) && newData.child('text').isString() && newData.child('text').val().length < 2000" },
             "lines": { "$id": { ".validate": "newData.hasChildren(['text','t']) && newData.child('text').isString() && newData.child('text').val().length < 2000" } }
           }
         }
       }
     }
   }
   ```
   Lettura pubblica (serve ai telefoni), scrittura solo da utenti autenticati, testo validato.
5. *Impostazioni progetto → Le tue app → Web* (`</>`): registra l'app e copia l'oggetto `firebaseConfig` in `firebase-config.js`.
   Non è un segreto: identifica il progetto, la protezione sta nelle regole e in Authentication.
6. Authentication → *Impostazioni → Domini autorizzati*: aggiungi `mattiaforni.github.io` se non c'è.
7. Stampare un QR verso `https://…/telefono.html?evento=evento-finale&lang=fr`.

Le trascrizioni non restano nel database: la pagina operatore le cancella quando si preme **Avvia** e quando si preme **Ferma**. I telefoni partono vuoti, mostrano solo ciò che viene detto da quando si apre la pagina e tengono a video le ultime 8 righe.

Dopo l'evento basta disattivare il metodo Anonimo (o cancellare il progetto).

## Il giorno dell'evento
1. Aprire `index.html` su Chrome, incollare la chiave, scegliere l'ingresso audio e le lingue.
2. **Avvia**. Attendere che tutte le sessioni siano verdi ("in ascolto").
3. **Schermo IT** (o **Schermo doppio**) → trascinare la finestra sul proiettore → `F` tutto schermo, `S` pannello impostazioni:
   - **Fascia principale / secondaria**: traduzione IT, FR, EN, *automatica IT↔FR* (mostra sempre la lingua che non si sta parlando) oppure *originale* (lingua parlata). La secondaria è più piccola, sopra o sotto. Schermo doppio tipico: secondaria = originale, principale = automatica.
   - **Posizione** bassa/media/alta (frecce ↑↓ per regolare a vista), **righe** 1–3, **dimensione**, **tema** (varianti TEST azzurro/mattone/corallo o neutro), fascia a riquadro o a tutta larghezza, sempre visibile o solo quando c'è parlato.
   - Sottotitoli "roll-up" come Meet: le parole restano dove sono scritte, le righe si riempiono e quando il riquadro è pieno tutto sale di una riga. Dopo una pausa il nuovo intervento parte a capo.
   - Le impostazioni restano nel browser e si possono fissare nell'URL, es. `schermo.html?lang=auto&lang2=orig&theme=test-mattone&pos=alta&lines=2`.
4. A fine intervento **Ferma**: i minuti si pagano finché le sessioni sono aperte.

## Prova generale (da fare prima)
1. Senza mixer: scegliere come ingresso il microfono del PC e far riprodurre da un altro dispositivo un video in francese (un TG, un'intervista). Verificare latenza e qualità.
2. Con il mixer e un relatore vero, nella sala dell'evento, con le luci e i microfoni dell'evento.
3. Provare un italiano che parla: lo schermo IT deve mostrare l'italiano, il telefono FR la traduzione.
4. Lasciare acceso per più di 10 minuti per verificare che la riconnessione automatica (ripresa sessione) funzioni senza perdere testo.

## Limiti noti
- Il modello è in *preview*: sul forum Google sono segnalati casi di output in inglese anziché nella lingua configurata e troncature delle ultime parole. La prova generale serve a vedere se ci capitano.
- Latenza tipica 1–3 secondi.
- Voci sovrapposte o chiacchiericcio di fondo degradano molto la qualità: un solo microfono aperto alla volta.
- Con "echo lingua target" spento il modello a volte ripete comunque l'originale invece di tacere. Il "filtro lingua parlata" (`js/router.js`) riconosce la lingua dalla trascrizione originale e zittisce il canale in quella lingua; in più scarta le righe che coincidono con l'originale. Lo stesso modulo calcola il canale "automatico IT↔FR", alimentato da una sola sessione alla volta. Una riga tradotta compare da 3 parole in su (circa mezzo secondo in più), così non appare e scompare. La lingua riconosciuta è mostrata in alto nella pagina operatore.
- Le pagine mostrano il numero di versione (in alto a destra nell'operatore, nel suggerimento dello schermo): se non corrisponde all'ultima, ricaricare con Ctrl+Shift+R.
- Nessun glossario: nomi propri e sigle possono uscire storpiati.
- La connessione WebSocket dura ~10 minuti; la pagina riconnette da sola con l'handle di sessione. Se "Ripresa sessione" o "Compressione contesto" dessero errore col modello di traduzione, disattivarle nelle opzioni avanzate e riavviare.
- Piano B già pronto: Google Meet con sottotitoli tradotti, oppure LiveVoice.

## Struttura
```
index.html          pagina operatore
schermo.html        vista maxischermo
telefono.html       vista ospiti (Firebase)
firebase-config.js  config Firebase (null = relay spento)
js/audio.js         cattura microfono → PCM 16 kHz
js/live.js          sessione Live API (WebSocket, trascrizioni, riconnessione)
js/relay.js         scrittura/lettura Firebase
js/captions.js      impaginazione dei sottotitoli roll-up
js/router.js        lingua parlata, filtro eco, canale automatico
```
