#!/usr/bin/env bash
# Sets up the Aveon collaboration server on an Oracle Cloud Always Free Ubuntu VM.
#
#   sudo bash setup.sh <domain> <git-repo-url>
#   sudo bash setup.sh aveon-collab.duckdns.org https://github.com/you/aveon-editor.git
#
# Safe to run again: later runs pull the latest code and restart the server.
set -euo pipefail

DOMAIN="${1:?usage: sudo bash setup.sh <domain> <git-repo-url>}"
REPO="${2:?usage: sudo bash setup.sh <domain> <git-repo-url>}"
APP_DIR=/opt/aveon
DATA_DIR=/var/lib/aveon-collab

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

echo "==> Installing Node.js 22, git and Caddy"
apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> Opening ports 80 and 443 (Oracle Ubuntu images block them in iptables)"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

echo "==> Getting the code"
id aveon >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin aveon
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
# The server only needs its own dependency (ws).
(cd "$APP_DIR/packages/collab-server" && npm install --omit=dev --no-audit --no-fund)
mkdir -p "$DATA_DIR"
chown -R aveon:aveon "$APP_DIR" "$DATA_DIR"

echo "==> Starting the server"
cp "$APP_DIR/deploy/oracle/aveon-collab.service" /etc/systemd/system/aveon-collab.service
CORES="$(nproc)"
sed -i "s/AVEON_COLLAB_WORKERS=.*/AVEON_COLLAB_WORKERS=$CORES/" /etc/systemd/system/aveon-collab.service
systemctl daemon-reload
systemctl enable aveon-collab
systemctl restart aveon-collab

echo "==> Configuring HTTPS for $DOMAIN"
sed "s/COLLAB_DOMAIN/$DOMAIN/" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo
echo "Done. The collaboration server is at wss://$DOMAIN"
echo "Logs:   journalctl -u aveon-collab -f"
echo "Status: systemctl status aveon-collab"
