# DreamX

DreamX is a self-hosted web deployment platform: users register, connect GitHub or GitLab repositories,
review automatic project analysis, deploy to public URLs, and manage projects. Admins use
the separate `/dream` panel.

## Architecture Overview

```text
Browser
  -> HTTPS Nginx/Caddy wildcard proxy (*.yourdomain.com)
  -> Frontend Nginx static container or Express-served React/Vite client
  -> Node.js Express API (/api/v1 and /api/admin)
  -> PostgreSQL for users, tokens, projects, deployments, logs, settings
  -> Redis for brute-force lockout and BullMQ deploy queue
  -> tmp/builds/<deploymentId>/ sandboxed build directories
  -> deployments/<slug>/ public project artifacts
  -> socket.io for live deployment logs
```

DreamX uses short-lived JWT access tokens, hashed rotating refresh tokens, logout
revocation, CSRF double-submit protection for cookie-authenticated unsafe requests,
Redis-backed brute-force lockout, parameterized SQL queries, sandboxed GitHub cloning,
and admin audit logs with IP/user-agent.

## Features

- React + Vite + TypeScript frontend with a minimal card system, light/dark themes, local video backgrounds, Recharts, Tailwind, Framer Motion, and i18next
- Node.js + Express REST API under `/api/v1`, with separate admin aliases under `/api/admin`
- JWT access + refresh tokens, remember me, bcrypt password hashing
- User register/login/logout, forgot/reset password, profile, avatar upload, delete account
- Hidden separate admin auth at `/dream` with default `dream / dream`, noindex headers, delayed blank screen, and generic lockout errors
- Admin dashboard, users, projects, settings, logs, notifications
- PostgreSQL schema with users, sessions, refresh_tokens, password_resets, projects, deployments, deploy_logs, settings, admin_logs, announcements, and notifications
- GitHub and GitLab deployment through OAuth account connection; private repo access tokens are encrypted server-side
- Repository validation through provider REST APIs, branch discovery, commit metadata, and framework detection
- Sandboxed deploy builds under `tmp/builds/<deploymentId>/`
- Framework analysis for static HTML, React, Vue, Svelte, Next.js, Node.js
- Static build execution with `npm install` and detected build command
- Project limit enforcement, default 3 active deployments per user
- BullMQ deploy queue with max 3 concurrent builds when Redis is enabled
- Deployment logs persisted and streamed with socket.io
- Linux-ready PM2, Nginx/Caddy, PostgreSQL, Redis documentation
- Full frontend language switcher for English, Azerbaijani, Russian, Turkish, German, French, Spanish, Arabic with RTL, Chinese, and Japanese
- Locale-aware dates/numbers and `Accept-Language` API error responses for supported backend messages

Background video playlist sources:

- https://videos.pexels.com/video-files/5028622/5028622-hd_1920_1080_25fps.mp4
- https://videos.pexels.com/video-files/9034508/9034508-hd_1920_1080_24fps.mp4
- https://videos.pexels.com/video-files/3209828/3209828-hd_1920_1080_25fps.mp4
- https://videos.pexels.com/video-files/3255275/3255275-hd_1920_1080_25fps.mp4
- https://videos.pexels.com/video-files/18069232/18069232-hd_1920_1080_24fps.mp4

## Quick Start

```bash
npm install
cp .env.example .env
npm run build
npm start
```

For GitHub/GitLab account connection, create OAuth apps and set:

```env
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/github/oauth/callback
GITLAB_CLIENT_ID=your_gitlab_client_id
GITLAB_CLIENT_SECRET=your_gitlab_client_secret
GITLAB_CALLBACK_URL=http://localhost:3000/api/v1/source/gitlab/oauth/callback
```

Open:

```text
http://localhost:3000
```

Admin:

```text
http://localhost:3000/dream
username: dream
password: dream
```

## Development

```bash
npm run dev
```

Vite runs on port `5173` and proxies API requests to Express on port `3000`.

## PostgreSQL

Production should use PostgreSQL:

```bash
docker compose up -d postgres redis
npm run migrate
npm run seed
```

If `DATABASE_URL` is empty, DreamX uses `data/launchpad.json` for local testing only.

## Docker Compose

The compose file includes PostgreSQL, Redis, backend, and frontend services:

```bash
cp .env.example .env
docker compose up --build -d
```

Open the frontend container at:

```text
http://localhost:4173
```

The backend API is also exposed at:

```text
http://localhost:3000
```

## Windows Development With Docker Databases

On Windows, run only PostgreSQL and Redis in Docker and run Node/Vite directly on the
host so file paths, Git, and build logs remain easy to inspect:

```powershell
docker compose -f docker-compose.windows.yml up -d
$env:DATABASE_URL="postgresql://dreamx:password@127.0.0.1:5432/dreamx_db"
$env:REDIS_URL="redis://127.0.0.1:6379"
npm install
npm run migrate
npm run dev
```

If `DATABASE_URL` is left empty, development falls back to `data/launchpad.json`.
In local dev, subdomains are skipped and deployed projects are served at:

```text
http://localhost:3000/preview/project-slug/
```

Production on Linux Mint uses real wildcard subdomains:

```text
https://project-slug.your-duckdns-domain.duckdns.org
```

## Linux Mint Desktop-as-Server Setup

Linux Mint is Ubuntu-based and uses `apt` plus `systemd`, so the app runs the same way
as on Ubuntu. Set a static local IP from Network Manager first, forward ports `80` and
`443` on your router to that machine, then run:

```bash
sudo apt update
sudo apt install -y git
git clone <your-repo-url> ~/dreamx
cd ~/dreamx
bash setup.sh
```

The setup script installs Node.js 20, PostgreSQL, Redis, Git, PM2, Caddy with DuckDNS
DNS-challenge support, creates a random `dreamx-xxxxxx.duckdns.org` domain, writes
`/opt/dreamx/.env.production`, copies the app into `/opt/dreamx`, runs migrations,
builds the frontend, and starts PM2.

You can provide values non-interactively:

```bash
DUCKDNS_TOKEN=your_token DUCKDNS_SUBDOMAIN=my-dreamx ACME_EMAIL=you@example.com bash setup.sh
```

After setup:

```text
https://my-dreamx.duckdns.org
https://my-dreamx.duckdns.org/dream
```

Start or restart:

```bash
cd /opt/dreamx
pm2 restart dreamx-backend
pm2 save
sudo systemctl reload caddy
```

Project URLs use wildcard subdomains such as `https://project.my-dreamx.duckdns.org`.
Caddy handles HTTPS automatically through the DuckDNS DNS plugin.

## Deploy API

Analyze:

```bash
curl -X POST http://localhost:3000/api/v1/deployments/analyze \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/mdn/beginner-html-site-styled",
    "branch": "main",
    "rootDir": ""
  }'
```

Deploy:

```bash
curl -X POST http://localhost:3000/api/v1/deployments \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/mdn/beginner-html-site-styled",
    "branch": "main",
    "name": "my-site",
    "buildCommand": "",
    "outputDir": ".",
    "rootDir": "",
    "envVars": []
  }'
```

Private repositories are available after the user connects GitHub through OAuth.
The GitHub access token is encrypted before persistence and never returned by API responses.

Admin API examples use `/api/admin`:

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"dream","password":"dream"}'
```

Public local URL:

```text
http://localhost:3000/preview/my-site/
```

Production wildcard URL:

```text
https://my-site.yourdomain.com
```

## Important Security Notes

- Change all JWT secrets and admin password before production.
- Run builds in a restricted Linux user or container for untrusted repositories.
- Keep `ENABLE_NODE_RUNTIME=false` unless you isolate Node apps with containers/PM2 users.
- Put Nginx or Caddy in front of the app for HTTPS, upload limits, and wildcard domains.
- Back up PostgreSQL and the `deployments/` directory.

## Deliverable Files

```text
server.js
server/app.js
server/auth.js
server/config.js
server/deployer.js
server/mailer.js
server/migrate.js
server/queue.js
server/schema.sql
server/security.js
server/seed.js
server/socketHub.js
server/store.js
client/index.html
client/src/App.tsx
client/src/Charts.tsx
client/src/main.tsx
client/src/styles.css
Dockerfile
docker/frontend-nginx.conf
migrations/001_initial_schema.sql
docker-compose.yml
docker-compose.windows.yml
nginx.launchpad.conf
Caddyfile
.env.example
.env.development
setup.sh
ecosystem.config.js
vite.config.ts
tailwind.config.js
postcss.config.js
tsconfig.json
ARCHITECTURE.md
FOLDER_STRUCTURE.md
DEPLOY_LINUX_HTTPS.md
```
