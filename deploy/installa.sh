#!/usr/bin/env bash
# Installazione e aggiornamento sul Raspberry Pi 5 (idempotente).
# Da lanciare dalla radice del repository, dopo «npm ci && npm run build»:
#   sudo ./deploy/installa.sh
set -euo pipefail

ORIGINE="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/aqf

if [[ $EUID -ne 0 ]]; then echo "Serve sudo." >&2; exit 1; fi
command -v node >/dev/null || { echo "Node 22 non trovato: installalo prima (vedi deploy/README.md)." >&2; exit 1; }
[[ -f "$ORIGINE/server/dist/index.js" && -f "$ORIGINE/web/dist/index.html" ]] || {
  echo "Prima compila: npm ci && npm run build" >&2; exit 1; }

command -v soffice >/dev/null || echo "Attenzione: LibreOffice manca, i PowerPoint non verranno convertiti (sudo apt install -y libreoffice-impress)."
command -v pdftoppm >/dev/null || echo "Attenzione: poppler-utils manca, niente miniature (sudo apt install -y poppler-utils)."

id aqf >/dev/null 2>&1 || useradd --system --home-dir /var/lib/aqf --shell /usr/sbin/nologin aqf
install -d -o aqf -g aqf -m 750 /var/lib/aqf
install -d -o aqf -g aqf -m 750 /srv/aqf
install -d -m 755 /etc/aqf

install -d "$DEST"
rsync -a --delete \
  --exclude '.git' --exclude 'dati' --exclude 'node_modules' \
  "$ORIGINE/" "$DEST/"
# Dipendenze di produzione compilate per ARM direttamente sul Raspberry.
(cd "$DEST" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
chown -R root:root "$DEST"

if [[ ! -f /etc/aqf/aqf.env ]]; then
  install -m 640 -g aqf "$ORIGINE/deploy/aqf.env.example" /etc/aqf/aqf.env
  echo "Creato /etc/aqf/aqf.env"
fi
# Un aqf.env di una versione precedente teneva il servizio solo su 127.0.0.1,
# irraggiungibile dalla rete interna e quindi dal tunnel: si corregge.
if grep -q '^AQF_HOST=127\.0\.0\.1' /etc/aqf/aqf.env; then
  sed -i 's/^AQF_HOST=127\.0\.0\.1/AQF_HOST=0.0.0.0/' /etc/aqf/aqf.env
  echo "Aggiornato /etc/aqf/aqf.env: AQF_HOST=0.0.0.0 (ascolto in rete interna)"
fi
grep -q '^AQF_HOST=' /etc/aqf/aqf.env || echo 'AQF_HOST=0.0.0.0' >> /etc/aqf/aqf.env

install -m 644 "$ORIGINE/deploy/aqf.service" /etc/systemd/system/aqf.service
systemctl daemon-reload
systemctl enable aqf.service >/dev/null
systemctl restart aqf.service
sleep 2
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
# La prova si fa sull'IP di rete, non su 127.0.0.1: è da lì che arriva il tunnel.
if curl -fsS "http://${IP:-127.0.0.1}:8790/api/salute" >/dev/null; then
  echo "Servizio attivo su http://${IP}:8790 (rete interna)"
  echo "Nel tunnel Cloudflare usa come servizio: http://${IP}:8790"
elif curl -fsS http://127.0.0.1:8790/api/salute >/dev/null; then
  echo "Il servizio risponde solo su 127.0.0.1: controlla AQF_HOST in /etc/aqf/aqf.env" >&2
  exit 1
else
  echo "Il servizio non risponde: journalctl -u aqf -n 50" >&2
  exit 1
fi

N=$(sudo -u aqf env AQF_DATA_DIR=/var/lib/aqf node "$DEST/server/dist/cli.js" elenco 2>/dev/null | grep -c @ || true)
if [[ "$N" == "0" ]]; then
  echo
  echo "Nessun utente ancora. Crea il tuo account amministratore con:"
  echo "  sudo -u aqf AQF_DATA_DIR=/var/lib/aqf node $DEST/server/dist/cli.js crea --email TUA@EMAIL --nome \"Nome Cognome\" --admin"
fi
