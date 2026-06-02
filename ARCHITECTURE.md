# LaunchPad Architecture Overview

LaunchPad is a self-hosted deployment platform with a React client, an Express API,
PostgreSQL persistence, optional Redis-backed queue infrastructure, and Linux reverse
proxy deployment through Nginx or Caddy.

## Runtime Topology

```text
Browser
  |
  | HTTPS
  v
Nginx/Caddy (*.yourdomain.com, launchpad.yourdomain.com)
  |
  v
Node.js Express API + React static client
  |
  +-- PostgreSQL: users, refresh tokens, password resets, projects, deployments, logs, settings
  +-- Redis: BullMQ deploy queue and brute-force lockout
  +-- tmp/builds/<deploymentId>/: sandboxed build directories
  +-- deployments/: static project artifacts
  +-- uploads/: optimized avatar assets
```

## Backend

- `server.js` starts HTTP and socket.io.
- `server/app.js` owns Express routes, middleware, auth, admin APIs, deployment APIs,
  static project serving, maintenance mode, and error handling.
- `server/auth.js` implements JWT access tokens, refresh token rotation, password hashing,
  role checks, user middleware, and admin middleware.
- `server/security.js` implements login lockout, CSRF double-submit protection, security
  headers, cache headers, admin audit helper, and IP extraction. Login lockout uses
  Redis when `REDIS_URL` is configured and falls back to memory for local development.
- `server/store.js` provides a PostgreSQL-backed repository and a local JSON fallback for
  development.
- `server/deployer.js` validates GitHub repositories, clones branches into sandboxed
  build directories, blocks path traversal, detects frameworks, runs builds, emits logs,
  and publishes static files.
- `server/queue.js` provides Redis/BullMQ queue integration with max 3 concurrent
  deployment builds and an in-memory fallback for local development.

## Frontend

- React + Vite + TypeScript.
- Minimal card system using Plus Jakarta Sans for UI text and JetBrains Mono only for logs/code.
- CSS-variable light/dark theme with persisted user preference and system preference fallback.
- Server-room video playlist backgrounds on landing hero, auth, admin login, 404, and maintenance pages. The playlist crossfades between multiple Pexels clips and reuses one component across pages.
- i18next/react-i18next localization for English, Azerbaijani, Russian, Turkish, German, French, Spanish, Arabic, Chinese, and Japanese. Arabic dynamically sets `dir="rtl"` and flips the admin sidebar.
- Framer Motion micro-animations.
- Recharts is lazy-loaded from `client/src/Charts.tsx` for admin analytics.
- Pages include landing, auth, password reset, dashboard, projects, deploy, profile,
  admin `/dream`, admin overview, users, projects, settings, logs, notifications, 404, and maintenance.

## Security Model

- User JWT and admin JWT are separate.
- Admin panel is only reachable from `/dream` and `/dream/*`.
- The `/dream` route is not linked from public navigation or footer, returns `X-Robots-Tag: noindex, nofollow, noarchive`, shows a blank decoy page for 2 seconds, and uses generic credential errors.
- Admin APIs require admin JWT and role `admin`.
- User login lockout is 5 failed attempts per identity/IP for 15 minutes. Admin login lockout is 3 failed attempts for 10 minutes with a retry countdown.
- Refresh tokens are stored hashed and rotated on refresh.
- Logout revokes the active refresh token.
- Repository root and output directories are resolved inside the cloned workspace so
  `..` traversal and publishing paths outside the sandbox are rejected.
- CSRF double-submit protects cookie-authenticated unsafe requests.
- SQL queries are parameterized.
- Admin actions are persisted with IP, user agent, timestamp, action, target, and metadata.

## Production Notes

- Production should set `DATABASE_URL`.
- Wildcard DNS should point `*.yourdomain.com` to the Linux server.
- HTTPS is terminated at Nginx or Caddy.
- Untrusted Node.js runtimes should remain disabled unless isolated with containers.
- Local Windows development skips wildcard subdomains and serves deployed projects at
  `/preview/<project-slug>/`; Linux Mint production serves the same project at
  `https://<project-slug>.<domain>`.
