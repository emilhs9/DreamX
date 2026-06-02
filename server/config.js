const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
const runtimeEnv = process.env.NODE_ENV || "development";

dotenv.config({ path: path.join(rootDir, `.env.${runtimeEnv}`) });
dotenv.config({ path: path.join(rootDir, ".env") });

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const resolvePath = (value, fallback) => path.resolve(value || fallback);

const paths = {
  root: rootDir,
  data: resolvePath(process.env.DATA_DIR, path.join(rootDir, "data")),
  uploads: resolvePath(process.env.UPLOADS_DIR, path.join(rootDir, "uploads")),
  tmp: resolvePath(process.env.TMP_DIR, path.join(rootDir, "tmp")),
  builds: resolvePath(process.env.BUILDS_DIR, path.join(rootDir, "tmp", "builds")),
  deployments: resolvePath(process.env.DEPLOYMENTS_DIR, path.join(rootDir, "deployments")),
  publicDist: path.join(rootDir, "dist", "client"),
  clientIndex: path.join(rootDir, "..", "front-end", "index.html")
};

Object.values(paths).forEach((value) => {
  if (!path.extname(value)) ensureDir(value);
});

const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`),
  publicDomain: process.env.PUBLIC_DOMAIN || process.env.DOMAIN || "dream.x",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || "dev-admin-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "dream",
  adminPassword: process.env.ADMIN_PASSWORD || "dream",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  accessTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  rememberRefreshTtlDays: Number(process.env.REMEMBER_REFRESH_TOKEN_DAYS || 90),
  buildTimeoutSeconds: Number(process.env.BUILD_TIMEOUT_SECONDS || 120),
  deployQueueConcurrency: Number(process.env.DEPLOY_QUEUE_CONCURRENCY || 3),
  enableNodeRuntime: process.env.ENABLE_NODE_RUNTIME === "true",
  corsOrigin: process.env.CORS_ORIGIN || "",
  githubOAuth: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    callbackUrl:
      process.env.GITHUB_CALLBACK_URL ||
      `${process.env.BASE_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)}/api/v1/github/oauth/callback`
  },
  gitlabOAuth: {
    clientId: process.env.GITLAB_CLIENT_ID || "",
    clientSecret: process.env.GITLAB_CLIENT_SECRET || "",
    callbackUrl:
      process.env.GITLAB_CALLBACK_URL ||
      `${process.env.BASE_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)}/api/v1/source/gitlab/oauth/callback`
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "DreamX <no-reply@dreamx.local>"
  },
  paths
};

module.exports = { config, paths, ensureDir };
