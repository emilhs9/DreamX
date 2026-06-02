#!/usr/bin/env bash
set -euo pipefail

echo "DreamX setup for Linux Mint"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

RUN_USER="${SUDO_USER:-$USER}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/dreamx}"
APP_PORT="${PORT:-3000}"
DB_NAME="${DB_NAME:-dreamx_db}"
DB_USER="${DB_USER:-dreamx}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"
DUCKDNS_SUBDOMAIN="${DUCKDNS_SUBDOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-admin@example.com}"

random_string() {
  local raw
  raw="$(openssl rand -hex 64)"
  printf "%s" "${raw:0:${1:-32}}"
}

random_lower() {
  local raw
  raw="$(openssl rand -hex 16)"
  printf "%s" "${raw:0:${1:-6}}"
}

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Run this script from the DreamX project root."
  exit 1
fi

sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git rsync build-essential openssl cron libcap2-bin postgresql postgresql-contrib redis-server debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo systemctl enable redis-server
sudo systemctl start redis-server
sudo systemctl enable cron
sudo systemctl start cron

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt update
  sudo apt install -y caddy
fi

if ! caddy list-modules 2>/dev/null | grep -q "dns.providers.duckdns"; then
  sudo apt install -y golang-go
  sudo env GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  CADDY_BUILD_DIR="$(mktemp -d)"
  (cd "$CADDY_BUILD_DIR" && sudo -E /usr/local/bin/xcaddy build --with github.com/caddy-dns/duckdns)
  sudo systemctl stop caddy || true
  sudo install -m 0755 "$CADDY_BUILD_DIR/caddy" /usr/bin/caddy
  sudo setcap cap_net_bind_service=+ep /usr/bin/caddy || true
  rm -rf "$CADDY_BUILD_DIR"
fi

sudo systemctl enable caddy

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

SERVER_IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
echo "Detected public IP: ${SERVER_IP}"

if [[ -z "$DUCKDNS_TOKEN" ]]; then
  read -r -p "Enter your DuckDNS token: " DUCKDNS_TOKEN
fi

if [[ -z "$DUCKDNS_SUBDOMAIN" ]]; then
  DUCKDNS_SUBDOMAIN="dreamx-$(random_lower 6)"
fi

DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"
echo "Registering DuckDNS domain: ${DOMAIN}"
DUCKDNS_RESPONSE="$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=${SERVER_IP}")"
echo "DuckDNS response: ${DUCKDNS_RESPONSE}"

DB_PASSWORD="$(random_string 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

sudo mkdir -p "$APP_DIR" /var/log/dreamx "$APP_DIR/deployments" "$APP_DIR/uploads" /tmp/dreamx-builds
sudo chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" /var/log/dreamx /tmp/dreamx-builds

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude data/launchpad.json \
  --exclude deployments \
  --exclude uploads \
  --exclude tmp \
  --exclude "*.log" \
  "$SOURCE_DIR/" "$APP_DIR/"

JWT_ACCESS_SECRET="$(random_string 64)"
JWT_REFRESH_SECRET="$(random_string 64)"
ADMIN_JWT_SECRET="$(random_string 64)"

cat > "$APP_DIR/.env.production" <<EOF
NODE_ENV=production
PORT=${APP_PORT}
DOMAIN=${DOMAIN}
BASE_URL=https://${DOMAIN}
PUBLIC_DOMAIN=${DOMAIN}
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=https://${DOMAIN}/api/v1/github/oauth/callback
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
GITLAB_CALLBACK_URL=https://${DOMAIN}/api/v1/source/gitlab/oauth/callback
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
DUCKDNS_SUBDOMAIN=${DUCKDNS_SUBDOMAIN}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
ADMIN_USERNAME=dream
ADMIN_PASSWORD=dream
BCRYPT_ROUNDS=12
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=7
REMEMBER_REFRESH_TOKEN_DAYS=90
DEPLOY_QUEUE_CONCURRENCY=3
BUILD_TIMEOUT_SECONDS=120
ENABLE_NODE_RUNTIME=false
CORS_ORIGIN=https://${DOMAIN}
DEPLOYMENTS_DIR=${APP_DIR}/deployments
BUILDS_DIR=/tmp/dreamx-builds
UPLOADS_DIR=${APP_DIR}/uploads
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=DreamX <no-reply@${DOMAIN}>
EOF

cp "$APP_DIR/.env.production" "$APP_DIR/.env"
sudo chown "$RUN_USER:$RUN_USER" "$APP_DIR/.env.production" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env.production" "$APP_DIR/.env"

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
  email ${ACME_EMAIL}
}

${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${APP_PORT}
}

*.${DOMAIN} {
  tls {
    dns duckdns ${DUCKDNS_TOKEN}
  }
  encode zstd gzip
  reverse_proxy 127.0.0.1:${APP_PORT}
}
EOF

sudo chown root:caddy /etc/caddy/Caddyfile
sudo chmod 640 /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy

(sudo -u "$RUN_USER" crontab -l 2>/dev/null; echo "*/30 * * * * curl -fsS 'https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=' >/dev/null 2>&1") | sort -u | sudo -u "$RUN_USER" crontab -

sudo -u "$RUN_USER" -H bash -lc "cd '$APP_DIR' && npm install && npm run migrate:prod && npm run seed:prod && npm run build"

sudo -u "$RUN_USER" -H bash -lc "cd '$APP_DIR' && pm2 delete dreamx-backend >/dev/null 2>&1 || true && APP_DIR='$APP_DIR' pm2 start ecosystem.config.js --env production && pm2 save"
sudo env PATH="$PATH:/usr/bin:/usr/local/bin" pm2 startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null || true

echo ""
echo "DreamX is live at: https://${DOMAIN}"
echo "Admin panel: https://${DOMAIN}/dream"
echo "Admin credentials: dream / dream"
echo "Change the admin password after first login."
