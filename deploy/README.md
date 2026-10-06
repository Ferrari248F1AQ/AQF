# Messa in esercizio sul Raspberry Pi 5

| file | a cosa serve |
| --- | --- |
| `installa.sh` | installa o aggiorna (idempotente) |
| `aqf.service` | unità systemd, compartimentata come quella di drAwQ |
| `aqf.env.example` | configurazione, finisce in `/etc/aqf/aqf.env` |
| `cloudflared-aqf.yml` | regola da aggiungere al tunnel Cloudflare già attivo |

## 1. Prerequisiti (una volta)

Raspberry Pi OS **64 bit**, Node 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs rsync poppler-utils libreoffice-impress
```

- `libreoffice-impress` converte PPTX/PPT/ODP/KEY in PDF (una volta, al caricamento).
- `poppler-utils` fa le miniature e conta le pagine.

## 2. Installazione e aggiornamenti

```bash
git clone https://github.com/Ferrari248F1AQ/AQF.git && cd AQF
npm ci && npm run build
sudo ./deploy/installa.sh
```

Per aggiornare: `git pull && npm ci && npm run build && sudo ./deploy/installa.sh`.

Il servizio ascolta su `127.0.0.1:8790` (drAwQ usa 8787: non si pestano i piedi).

## 3. Il tuo account

L'amministratore si crea da terminale, non dal web (una pagina «crea il primo
utente» esposta sul tunnel sarebbe di chi la trova per primo):

```bash
sudo -u aqf AQF_DATA_DIR=/var/lib/aqf node /opt/aqf/server/dist/cli.js \
  crea --email emanuele.guardiani@univaq.it --nome "Emanuele Guardiani" --admin
```

Altri utenti si aggiungono poi dalla pagina **Utenti**. Password dimenticata:

```bash
sudo -u aqf AQF_DATA_DIR=/var/lib/aqf node /opt/aqf/server/dist/cli.js password --email ...
```

## 4. Tunnel Cloudflare

Aggiungi la regola di `cloudflared-aqf.yml` al file del tunnel esistente,
crea il record DNS e riavvia `cloudflared`. Il microfono funziona solo in
HTTPS, quindi le registrazioni vanno fatte dall'indirizzo del tunnel.

## 5. Scegliere il disco dei dati

Di default tutto va in `/var/lib/aqf` (disco interno). Da **Impostazioni →
Dove salvare i dati** vedi i dischi montati, ne aggiungi uno e lo rendi
attivo, con la scelta di spostarci anche i file già caricati. Il database
resta sempre sul disco interno.

Il servizio può scrivere solo sotto `/var/lib/aqf`, `/srv/aqf`, `/media` e
`/mnt`, e solo dove l'utente `aqf` ha i permessi. Il modo più pulito per un
disco esterno è montarlo sotto `/srv/aqf` con una riga in `/etc/fstab`:

```bash
sudo blkid                              # trova l'UUID del disco
sudo mkdir -p /srv/aqf/disco1
# ext4:
echo 'UUID=xxxx  /srv/aqf/disco1  ext4  defaults,nofail  0 2' | sudo tee -a /etc/fstab
# exFAT / FAT (chiavette): i permessi si danno al montaggio
# UUID=xxxx  /srv/aqf/disco1  exfat  defaults,nofail,uid=aqf,gid=aqf  0 0
sudo mount -a && sudo chown aqf:aqf /srv/aqf/disco1   # (solo per ext4)
```

Poi dalla pagina: **Aggiungi** accanto a `/srv/aqf/disco1` → **Usa questo**.

## 6. iPad

Apri l'indirizzo del tunnel in Safari → Condividi → **Aggiungi alla schermata
Home**. Aperta dall'icona la piattaforma è già a schermo intero, senza barre
e senza il gesto di Safari che fa uscire dallo schermo intero.

## 7. Copie di sicurezza

Tutto quello che conta sta in `/var/lib/aqf` (database + disco interno) e
nelle cartelle `aqf-dati` dei dischi aggiunti. Per il database a servizio acceso:

```bash
sudo -u aqf sqlite3 /var/lib/aqf/aqf.sqlite ".backup '/srv/aqf/disco1/aqf-backup.sqlite'"
```
