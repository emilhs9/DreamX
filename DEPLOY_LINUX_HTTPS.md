# LaunchPad Linux Production Deploy

These steps assume Linux Mint or Ubuntu 22.04/24.04 and a domain such as `yourdomain.com`.

## 1. DNS

Create records:

```text
A      launchpad.yourdomain.com    SERVER_IP
A      *.yourdomain.com            SERVER_IP
```

`launchpad.yourdomain.com` opens the platform. `project.yourdomain.com` opens user projects.

## 2. Install server packages

```bash
sudo apt update
sudo apt install -y git curl unzip nginx postgresql postgresql-contrib redis-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 3. PostgreSQL

```bash
sudo -u postgres psql
```

```sql
CREATE USER launchpad WITH PASSWORD 'change_me';
CREATE DATABASE launchpad OWNER launchpad;
\q
```

## 4. App setup

```bash
git clone <your-repo> /var/www/launchpad
cd /var/www/launchpad
npm install
cp .env.example .env
nano .env
```

Set:

```text
NODE_ENV=production
PORT=3000
BASE_URL=https://launchpad.yourdomain.com
PUBLIC_DOMAIN=yourdomain.com
DATABASE_URL=postgresql://launchpad:change_me@127.0.0.1:5432/launchpad
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=<long random string>
JWT_REFRESH_SECRET=<long random string>
ADMIN_JWT_SECRET=<long random string>
ADMIN_USERNAME=dream
ADMIN_PASSWORD=<change this>
```

Then:

```bash
npm run migrate
npm run seed
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 5. Nginx reverse proxy

Create `/etc/nginx/sites-available/launchpad`:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  server_name launchpad.yourdomain.com *.yourdomain.com;

  client_max_body_size 120M;

  location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/launchpad /etc/nginx/sites-enabled/launchpad
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS with Certbot wildcard

Wildcard certificates need DNS challenge:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d launchpad.yourdomain.com -d "*.yourdomain.com"
```

If your DNS provider requires API-based DNS challenge, use the matching Certbot DNS plugin.

## 7. Caddy alternative

Caddy can manage HTTPS automatically:

```caddy
launchpad.yourdomain.com, *.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

Wildcard TLS with Caddy also needs DNS provider configuration.

## 8. Operations

```bash
pm2 status
pm2 logs launchpad
pm2 restart launchpad
npm run migrate
```

Back up:

```bash
pg_dump launchpad > launchpad.sql
tar -czf launchpad-deployments.tar.gz deployments uploads
```

## 9. Hardening

- Change `/dream` admin password immediately.
- Use long JWT secrets.
- Keep `ENABLE_NODE_RUNTIME=false` unless user projects run in containers.
- Run LaunchPad as a non-root user.
- Add firewall rules for ports 22, 80, 443 only.
- Keep PostgreSQL and Redis bound to localhost.
