# Lezioni di disegno

Piattaforma web per proiettare e annotare a lezione i PDF e i PowerPoint del
corso di disegno. Gira su un **Raspberry Pi 5**, in locale, ed è raggiungibile
dall'esterno attraverso il tunnel Cloudflare già attivo sul dispositivo.
Installazione: **[`deploy/README.md`](deploy/README.md)**.

## Cosa fa

- **Libreria** con cartelle annidate: carica (anche trascinando), rinomina,
  sposta, cerca, scarica, elimina. PDF, PPTX, PPT, ODP e KEY; le presentazioni
  sono convertite in PDF una volta sola, sul Raspberry, con LibreOffice.
- **Presentazione a schermo intero**: la pagina e nient'altro. Si sfoglia con
  uno scorrimento del dito, toccando i bordi, con le frecce o un telecomando
  da presentazione; due dita ingrandiscono. Riprende dall'ultima pagina vista.
- **Annotazioni** con Apple Pencil: penna sensibile alla pressione,
  evidenziatore, linea, freccia, rettangolo, ellisse, laser, gomma, sei colori,
  tre spessori, annulla/ripeti. Salvate per pagina sul Raspberry, vettoriali.
  La barra compare **solo avvicinando la Pencil al bordo sinistro** e sparisce
  tornando sul foglio (stessa logica di drAwQ); il palmo appoggiato non lascia segni.
- **Registrazione della voce** durante la presentazione, senza nulla a
  schermo (a meno di chiedere un puntino nelle impostazioni). L'audio arriva al
  Raspberry a blocchi di 5 secondi mentre si parla, con i segni di quando si
  è cambiata pagina; si riascolta e scarica da **Registrazioni**.
- **Lavagna bianca**: dal pulsante in cima alla barra degli strumenti (o dai
  comandi, o col tasto L) si passa a un foglio bianco, ci si disegna e con un
  altro tocco si torna alla slide dov'eri. Avanti/indietro scorrono i fogli
  della lavagna; dopo l'ultimo, se è stato usato, se ne apre uno nuovo. I fogli
  restano salvati con il documento e compaiono anche sullo specchio.
- **Specchio per il proiettore**: sul PC dell'aula apri **📽 Specchio** dalla
  libreria (stesso account) e segue l'iPad in tempo reale: documento, pagina,
  ingrandimento, tratti mentre li disegni, laser. Si apre una volta sola e
  segue anche il cambio di documento; sul proiettore non compare nessun
  comando (muovi il mouse per vederli, F per lo schermo intero).
- **Cronometro della pausa**: minuti da quando si è in presentazione,
  quasi invisibili all'inizio, sempre più evidenti verso la soglia (45′ di
  default, modificabile dalle impostazioni o toccando il cronometro), rosso a
  tempo scaduto. «Pausa fatta» lo azzera.
- **Accesso** con email e password, **gestione utenti** per l'amministratore,
  **scelta del disco** dove salvare i dati fra quelli montati sul Raspberry.

## Sviluppo

```bash
npm ci
npm run build
AQF_DATA_DIR=./dati node server/dist/cli.js crea --email io@esempio.it --nome "Io" --admin
AQF_DATA_DIR=./dati npm start        # http://IP-della-macchina:8790
# oppure, con ricaricamento: npm run dev  (web su :5180)
```

`server/` è Fastify 5 + SQLite; `web/` è React 19 + Vite, con pdf.js per le
pagine e perfect-freehand per il tratto.
