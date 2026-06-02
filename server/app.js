const path = require("path");
const fs = require("fs/promises");
const fss = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const si = require("systeminformation");
const sharp = require("sharp");
const { z } = require("zod");
const { config, ensureDir } = require("./config");
const { LaunchPadStore } = require("./store");
const {
  Deployer,
  slugify,
  projectUrl,
  productionProjectUrl,
  runningProcesses,
  encryptSecret,
  decryptSecret,
  exchangeGitHubOAuthCode,
  exchangeGitLabOAuthCode,
  detectSourceProvider
} = require("./deployer");
const { createDeployQueue } = require("./queue");
const { sendMail } = require("./mailer");
const { translateError } = require("./i18n");
const {
  LoginLockout,
  attachCsrfCookie,
  csrfProtection,
  securityHeaders,
  staticCacheHeaders,
  clientIp,
  adminLog
} = require("./security");
const {
  registerSchema,
  loginSchema,
  randomToken,
  hashToken,
  publicUser,
  issueUserTokens,
  setUserCookies,
  setAdminCookies,
  clearUserCookies,
  clearAdminCookies,
  requireUser,
  optionalUser,
  requireAdmin,
  verifyPassword,
  hashPassword,
  normalizeEmail
} = require("./auth");

const avatarUpload = multer({
  dest: path.join(config.paths.uploads, "avatars"),
  limits: { fileSize: 2 * 1024 * 1024 }
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ok(res, data = {}) {
  res.json({ success: true, ...data });
}

function fail(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseBool(value) {
  return value === true || value === "true" || value === "1";
}

const envVarSchema = z.object({
  key: z.string().trim().max(80),
  value: z.string().max(5000)
});

const deployBodySchema = z.object({
  repoUrl: z.string().trim().url().refine((value) => Boolean(detectSourceProvider(value)), "Only GitHub and GitLab repository URLs are supported."),
  branch: z.string().trim().min(1).max(120).default("main"),
  name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9._ -]+$/).optional(),
  customDomain: z.string().trim().max(253).regex(/^$|^[a-zA-Z0-9.-]+$/).optional(),
  buildCommand: z.string().trim().max(200).optional(),
  outputDir: z.string().trim().max(160).optional(),
  rootDir: z.string().trim().max(200).optional(),
  githubToken: z.string().trim().max(500).optional(),
  envVars: z.array(envVarSchema).max(50).optional()
});

function safePublicUser(user) {
  const value = publicUser(user);
  if (!value) return null;
  delete value.banned;
  return value;
}

function safeProject(project) {
  if (!project) return project;
  const value = { ...project };
  delete value.githubTokenEncrypted;
  delete value.githubWebhookSecret;
  value.previewUrl = `${config.baseUrl}/preview/${project.slug}/`;
  value.productionUrl = productionProjectUrl(project.slug);
  if (value.productionUrl) value.url = value.productionUrl;
  return value;
}

function safeProjects(payload) {
  return { ...payload, items: (payload.items || []).map(safeProject) };
}

const supportedSourceProviders = new Set(["github", "gitlab"]);

function normalizeSourceProvider(provider) {
  const value = String(provider || "github").toLowerCase();
  if (!supportedSourceProviders.has(value)) throw fail(400, "This source provider is not supported yet.");
  return value;
}

function allSourceConnections(user) {
  const connections = { ...(user?.sourceConnections || {}) };
  if (user?.githubAccessTokenEncrypted && !connections.github) {
    connections.github = {
      accessTokenEncrypted: user.githubAccessTokenEncrypted,
      login: user.githubLogin || "",
      avatarUrl: user.githubAvatarUrl || "",
      connectedAt: user.githubConnectedAt || null
    };
  }
  return connections;
}

function sourceConnection(user, provider) {
  const source = normalizeSourceProvider(provider);
  const connection = allSourceConnections(user)[source] || {};
  return {
    provider: source,
    connected: Boolean(connection.accessTokenEncrypted),
    login: connection.login || "",
    avatarUrl: connection.avatarUrl || "",
    htmlUrl: connection.htmlUrl || "",
    connectedAt: connection.connectedAt || null
  };
}

function githubConnection(user) {
  return sourceConnection(user, "github");
}

function sourceTokenForUser(user, provider, fallback = "") {
  const source = normalizeSourceProvider(provider);
  const connection = allSourceConnections(user)[source] || {};
  return fallback || decryptSecret(connection.accessTokenEncrypted || "");
}

function githubTokenForUser(user, fallback = "") {
  return sourceTokenForUser(user, "github", fallback);
}

async function saveSourceConnection(store, user, provider, result) {
  const source = normalizeSourceProvider(provider);
  const sourceConnections = allSourceConnections(user);
  sourceConnections[source] = {
    accessTokenEncrypted: encryptSecret(result.accessToken),
    login: result.user.login,
    avatarUrl: result.user.avatarUrl,
    htmlUrl: result.user.htmlUrl,
    connectedAt: new Date().toISOString()
  };
  const patch = { sourceConnections };
  if (source === "github") {
    patch.githubAccessTokenEncrypted = sourceConnections.github.accessTokenEncrypted;
    patch.githubLogin = sourceConnections.github.login;
    patch.githubAvatarUrl = sourceConnections.github.avatarUrl;
    patch.githubConnectedAt = sourceConnections.github.connectedAt;
  }
  return store.updateUser(user.id, patch);
}

async function clearSourceConnection(store, user, provider) {
  const source = normalizeSourceProvider(provider);
  const sourceConnections = allSourceConnections(user);
  delete sourceConnections[source];
  const patch = { sourceConnections };
  if (source === "github") {
    patch.githubAccessTokenEncrypted = "";
    patch.githubLogin = "";
    patch.githubAvatarUrl = "";
    patch.githubConnectedAt = null;
  }
  return store.updateUser(user.id, patch);
}

function oauthConfigForProvider(provider) {
  const source = normalizeSourceProvider(provider);
  if (source === "gitlab") return { ...config.gitlabOAuth, authorizeUrl: "https://gitlab.com/oauth/authorize", scope: "read_user read_api read_repository" };
  return { ...config.githubOAuth, authorizeUrl: "https://github.com/login/oauth/authorize", scope: "repo read:user" };
}

async function exchangeOAuthCode(provider, code) {
  const source = normalizeSourceProvider(provider);
  if (source === "gitlab") return exchangeGitLabOAuthCode(code);
  return exchangeGitHubOAuthCode(code);
}

async function removeDeploymentDirectory(deployPath) {
  if (!deployPath) return;
  const root = path.resolve(config.paths.deployments);
  const target = path.resolve(deployPath);
  if (!isInside(root, target)) throw fail(400, "Refusing to remove a path outside deployments.");
  await fs.rm(target, { recursive: true, force: true });
}

async function createApp() {
  const store = new LaunchPadStore();
  await store.init();
  const deployer = new Deployer(store);
  const deployQueue = createDeployQueue(async (payload) => {
    if (payload.kind === "redeploy") {
      const project = await store.findProjectById(payload.projectId);
      if (!project) throw new Error("Project not found.");
      return deployer.deployExistingProject(project, { user: payload.user, commitSha: payload.commitSha || "" });
    }
    return deployer.deployGitHub(payload);
  });
  const userLoginLockout = new LoginLockout(config.redisUrl);
  const adminLoginLockout = new LoginLockout(config.redisUrl, { maxAttempts: 3, lockMs: 10 * 60 * 1000 });
  const githubOAuthStates = new Map();
  const app = express();
  app.locals.deployQueue = deployQueue;

  app.set("trust proxy", 1);
  if (config.env === "production") app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'unsafe-eval'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "font-src": ["'self'", "data:"],
          "img-src": ["'self'", "data:", "blob:", "https://avatars.githubusercontent.com", "https://secure.gravatar.com", "https://gitlab.com"],
          "media-src": ["'self'"],
          "connect-src": ["'self'", "ws:", "wss:"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  const corsWhitelist = config.corsOrigin
    ? config.corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  app.use((req, res, next) => {
    const sameOrigin = `${req.protocol}://${req.get("host")}`;
    cors({
      origin(origin, callback) {
        // Sir, Emil: module assets send Origin headers, so same-origin builds must pass on any local port.
        if (!origin || origin === sameOrigin || corsWhitelist.length === 0 || corsWhitelist.includes(origin)) return callback(null, true);
        return callback(new Error("CORS origin is not allowed."));
      },
      credentials: true
    })(req, res, next);
  });
  app.use(cookieParser());
  app.use(compression());
  app.use(securityHeaders);
  app.use((req, res, next) => {
    if (req.path === "/dream" || req.path.startsWith("/dream/")) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
    next();
  });
  app.use(attachCsrfCookie);
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfProtection);

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
  const deployLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.use("/api/", apiLimiter);

  app.use("/api/admin", (req, res, next) => {
    if (req.__launchpadAdminAlias) return next();
    req.__launchpadAdminAlias = true;
    req.url = `/api/v1/admin${req.url}`;
    app.handle(req, res, next);
  });

  app.get("/health", (_req, res) => ok(res, { status: "ok", name: "DreamX" }));

  app.use("/uploads", express.static(config.paths.uploads, { maxAge: "30d", immutable: true, setHeaders: staticCacheHeaders }));

  app.get(
    "/api/v1/public/stats",
    asyncHandler(async (_req, res) => {
      const overview = await store.overview();
      ok(res, {
        stats: {
          users: overview.users,
          deployments: overview.deployments,
          uptime: process.uptime()
        },
        notifications: await store.listNotifications(3)
      });
    })
  );

  app.get(
    "/api/v1/settings/public",
    asyncHandler(async (_req, res) => {
      const settings = await store.settings();
      ok(res, {
        settings: {
          siteName: settings.siteName,
          logoUrl: settings.logoUrl,
          faviconUrl: settings.faviconUrl,
          maintenanceMode: settings.maintenanceMode,
          announcement: settings.announcement
        }
      });
    })
  );

  app.use(
    "/api/v1",
    asyncHandler(async (req, res, next) => {
      const settings = await store.settings();
      const allowed =
        req.path.startsWith("/admin") ||
        req.path.startsWith("/auth/login") ||
        req.path.startsWith("/auth/register") ||
        req.path.startsWith("/auth/refresh") ||
        req.path.startsWith("/settings/public") ||
        req.path.startsWith("/public");
      if (settings.maintenanceMode && !allowed) {
        return res.status(503).json({ success: false, error: "DreamX is in maintenance mode." });
      }
      next();
    })
  );

  app.post(
    "/api/v1/auth/register",
    authLimiter,
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const email = normalizeEmail(input.email);
      if (await store.findUserByEmail(email)) throw fail(409, "An account with this email already exists.");
      const verificationToken = randomToken();
      const user = await store.createUser({
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        emailVerified: false,
        verificationTokenHash: hashToken(verificationToken)
      });
      const verifyUrl = `${config.baseUrl}/api/v1/auth/verify-email/${verificationToken}`;
      await sendMail(store, {
        to: user.email,
        subject: "Verify your DreamX account",
        text: `Open this link to verify your account: ${verifyUrl}`
      });
      const tokens = await issueUserTokens(store, user, req, Boolean(input.remember));
      setUserCookies(res, tokens, Boolean(input.remember));
      ok(res, { user: safePublicUser(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    })
  );

  app.post(
    "/api/v1/auth/login",
    authLimiter,
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const lock = await userLoginLockout.check("user", input.email, clientIp(req));
      if (lock.locked) throw fail(429, `Too many login attempts. Try again in ${Math.ceil(lock.remainingMs / 60000)} minutes.`);
      const user = await store.findUserByEmail(input.email);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        const failed = await userLoginLockout.fail("user", input.email, clientIp(req));
        if (failed.lockedUntil) {
          throw fail(429, `Too many login attempts. Try again in ${Math.ceil((failed.lockedUntil - Date.now()) / 60000)} minutes.`, {
            retryAfterSeconds: Math.ceil((failed.lockedUntil - Date.now()) / 1000)
          });
        }
        throw fail(401, "Invalid email or password.");
      }
      if (user.banned) throw fail(403, "This account is banned.");
      await userLoginLockout.success("user", input.email, clientIp(req));
      const tokens = await issueUserTokens(store, user, req, Boolean(input.remember));
      setUserCookies(res, tokens, Boolean(input.remember));
      ok(res, { user: safePublicUser(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    })
  );

  app.post(
    "/api/v1/auth/refresh",
    authLimiter,
    asyncHandler(async (req, res) => {
      const refreshToken = req.body.refreshToken || req.cookies.lp_refresh;
      if (!refreshToken) throw fail(401, "Refresh token required.");
      const session = await store.findSessionByRefreshHash(hashToken(refreshToken), "user");
      if (!session) throw fail(401, "Invalid refresh token.");
      const user = await store.findUserById(session.userId);
      if (!user || user.banned) throw fail(401, "Account unavailable.");
      const tokens = await issueUserTokens(store, user, req, true);
      await store.revokeSession(session.id);
      setUserCookies(res, tokens, true);
      ok(res, { user: safePublicUser(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    })
  );

  app.post(
    "/api/v1/auth/logout",
    asyncHandler(async (req, res) => {
      const refreshToken = req.body?.refreshToken || req.cookies.lp_refresh;
      if (refreshToken) {
        const session = await store.findSessionByRefreshHash(hashToken(refreshToken), "user");
        if (session) await store.revokeSession(session.id);
      }
      clearUserCookies(res);
      ok(res);
    })
  );

  app.get(
    "/api/v1/auth/me",
    optionalUser(store),
    asyncHandler(async (req, res) => {
      ok(res, { authenticated: Boolean(req.user), user: safePublicUser(req.user) });
    })
  );

  app.get(
    "/api/v1/auth/verify-email/:token",
    asyncHandler(async (req, res) => {
      const tokenHash = hashToken(req.params.token);
      const user = await store.findUserByVerificationHash(tokenHash);
      if (user) await store.updateUser(user.id, { emailVerified: true, verificationTokenHash: null });
      res.redirect("/login?verified=1");
    })
  );

  app.get(
    "/api/v1/auth/verify-email",
    asyncHandler(async (req, res) => {
      const token = String(req.query.token || "");
      if (!token) throw fail(400, "Verification token is required.");
      const user = await store.findUserByVerificationHash(hashToken(token));
      if (user) await store.updateUser(user.id, { emailVerified: true, verificationTokenHash: null });
      ok(res, { verified: Boolean(user) });
    })
  );

  app.post(
    "/api/v1/auth/forgot-password",
    authLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({ email: z.string().email() });
      const { email } = schema.parse(req.body);
      const user = await store.findUserByEmail(email);
      if (user) {
        const token = randomToken();
        const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await store.updateUser(user.id, { resetTokenHash: hashToken(token), resetTokenExpiresAt: expires });
        await sendMail(store, {
          to: user.email,
          subject: "Reset your DreamX password",
          text: `Reset password: ${config.baseUrl}/reset-password/${token}`
        });
      }
      ok(res, { message: "If the email exists, a reset link was sent." });
    })
  );

  app.post(
    "/api/v1/auth/reset-password/:token",
    authLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({ password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/) });
      const { password } = schema.parse(req.body);
      const tokenHash = hashToken(req.params.token);
      const user = await store.findUserByResetHash(tokenHash);
      if (!user) throw fail(400, "Reset token is invalid or expired.");
      await store.updateUser(user.id, {
        passwordHash: await hashPassword(password),
        resetTokenHash: null,
        resetTokenExpiresAt: null
      });
      await store.revokeUserSessions(user.id, "user");
      ok(res);
    })
  );

  app.post(
    "/api/v1/auth/reset-password",
    authLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({
        token: z.string().min(10),
        password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/)
      });
      const { token, password } = schema.parse(req.body);
      const user = await store.findUserByResetHash(hashToken(token));
      if (!user) throw fail(400, "Reset token is invalid or expired.");
      await store.updateUser(user.id, {
        passwordHash: await hashPassword(password),
        resetTokenHash: null,
        resetTokenExpiresAt: null
      });
      await store.revokeUserSessions(user.id, "user");
      ok(res);
    })
  );

  app.post(
    "/api/v1/auth/resend-verification",
    authLimiter,
    optionalUser(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({ email: z.string().email().optional() });
      const { email } = schema.parse(req.body || {});
      const user = req.user || (email ? await store.findUserByEmail(email) : null);
      if (user && !user.emailVerified) {
        const token = randomToken();
        await store.updateUser(user.id, { verificationTokenHash: hashToken(token) });
        await sendMail(store, {
          to: user.email,
          subject: "Verify your DreamX account",
          text: `Open this link to verify your account: ${config.baseUrl}/api/v1/auth/verify-email/${token}`
        });
      }
      ok(res, { message: "If verification is pending, a new email was sent." });
    })
  );

  app.patch(
    "/api/v1/profile",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({
        name: z.string().min(2).max(80).optional(),
        email: z.string().email().optional()
      });
      const input = schema.parse(req.body);
      if (input.email && normalizeEmail(input.email) !== req.user.email && (await store.findUserByEmail(input.email))) {
        throw fail(409, "Email is already in use.");
      }
      const user = await store.updateUser(req.user.id, { ...input, email: input.email ? normalizeEmail(input.email) : undefined });
      ok(res, { user: safePublicUser(user) });
    })
  );

  app.patch(
    "/api/v1/profile/password",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/)
      });
      const input = schema.parse(req.body);
      if (!(await verifyPassword(input.currentPassword, req.user.passwordHash))) throw fail(401, "Current password is incorrect.");
      await store.updateUser(req.user.id, { passwordHash: await hashPassword(input.newPassword) });
      ok(res);
    })
  );

  app.post(
    "/api/v1/profile/avatar",
    requireUser(store),
    avatarUpload.single("avatar"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw fail(400, "Avatar file is required.");
      const ext = path.extname(req.file.originalname || "").toLowerCase() || ".png";
      if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) throw fail(400, "Unsupported avatar file type.");
      const finalName = `${req.user.id}-${Date.now()}.webp`;
      const finalPath = path.join(config.paths.uploads, "avatars", finalName);
      await sharp(req.file.path)
        .rotate()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(finalPath);
      await fs.rm(req.file.path, { force: true });
      const avatarUrl = `/uploads/avatars/${finalName}`;
      const user = await store.updateUser(req.user.id, { avatarUrl });
      ok(res, { user: safePublicUser(user) });
    })
  );

  app.delete(
    "/api/v1/profile",
    requireUser(store),
    asyncHandler(async (req, res) => {
      await store.deleteUser(req.user.id);
      clearUserCookies(res);
      ok(res);
    })
  );

  app.get(
    "/api/v1/source/:provider/status",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      ok(res, { connection: sourceConnection(req.user, provider) });
    })
  );

  app.get(
    "/api/v1/source/:provider/oauth/start",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      const oauth = oauthConfigForProvider(provider);
      if (!oauth.clientId || !oauth.clientSecret) {
        return res.redirect(`/deploy?source=${provider}&connection=missing_config`);
      }
      const state = randomToken(32);
      githubOAuthStates.set(state, { provider, userId: req.user.id, expiresAt: Date.now() + 10 * 60 * 1000 });
      const authUrl = new URL(oauth.authorizeUrl);
      authUrl.searchParams.set("client_id", oauth.clientId);
      authUrl.searchParams.set("redirect_uri", oauth.callbackUrl);
      authUrl.searchParams.set("scope", oauth.scope);
      authUrl.searchParams.set("state", state);
      if (provider === "gitlab") authUrl.searchParams.set("response_type", "code");
      res.redirect(authUrl.toString());
    })
  );

  app.get(
    "/api/v1/source/:provider/oauth/callback",
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      const entry = githubOAuthStates.get(state);
      githubOAuthStates.delete(state);
      if (!code || !entry || entry.provider !== provider || entry.expiresAt < Date.now()) {
        return res.redirect(`/deploy?source=${provider}&connection=failed`);
      }
      const result = await exchangeOAuthCode(provider, code);
      const user = await store.findUserById(entry.userId);
      if (!user) return res.redirect(`/deploy?source=${provider}&connection=failed`);
      await saveSourceConnection(store, user, provider, result);
      res.redirect(`/deploy?source=${provider}&connection=connected`);
    })
  );

  app.post(
    "/api/v1/source/:provider/connect",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      const schema = z.object({ search: z.string().trim().max(120).optional() });
      const input = schema.parse(req.body || {});
      const accessToken = sourceTokenForUser(req.user, provider);
      const data = await deployer.listRepositories({ provider, accessToken, search: input.search || "" });
      ok(res, { ...data, connection: sourceConnection(req.user, provider) });
    })
  );

  app.post(
    "/api/v1/source/:provider/disconnect",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      const user = await clearSourceConnection(store, req.user, provider);
      ok(res, { connection: sourceConnection(user, provider) });
    })
  );

  app.post(
    "/api/v1/source/:provider/branches",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const provider = normalizeSourceProvider(req.params.provider);
      const schema = z.object({ repoUrl: deployBodySchema.shape.repoUrl });
      const input = schema.parse(req.body || {});
      const data = await deployer.listBranches({ provider, repoUrl: input.repoUrl, accessToken: sourceTokenForUser(req.user, provider) });
      ok(res, data);
    })
  );

  app.get(
    "/api/v1/github/status",
    requireUser(store),
    asyncHandler(async (req, res) => {
      ok(res, { github: githubConnection(req.user) });
    })
  );

  app.get(
    "/api/v1/github/oauth/start",
    requireUser(store),
    asyncHandler(async (req, res) => {
      if (!config.githubOAuth.clientId || !config.githubOAuth.clientSecret) {
        return res.redirect("/deploy?github=missing_config");
      }
      const state = randomToken(32);
      githubOAuthStates.set(state, { userId: req.user.id, expiresAt: Date.now() + 10 * 60 * 1000 });
      const authUrl = new URL("https://github.com/login/oauth/authorize");
      authUrl.searchParams.set("client_id", config.githubOAuth.clientId);
      authUrl.searchParams.set("redirect_uri", config.githubOAuth.callbackUrl);
      authUrl.searchParams.set("scope", "repo read:user");
      authUrl.searchParams.set("state", state);
      res.redirect(authUrl.toString());
    })
  );

  app.get(
    "/api/v1/github/oauth/callback",
    asyncHandler(async (req, res) => {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      const entry = githubOAuthStates.get(state);
      githubOAuthStates.delete(state);
      if (!code || !entry || entry.expiresAt < Date.now()) {
        return res.redirect("/deploy?github=failed");
      }
      const result = await exchangeGitHubOAuthCode(code);
      const user = await store.findUserById(entry.userId);
      if (user) await saveSourceConnection(store, user, "github", result);
      res.redirect("/deploy?github=connected");
    })
  );

  app.post(
    "/api/v1/github/connect",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({
        githubToken: z.string().trim().max(500).optional(),
        search: z.string().trim().max(120).optional()
      });
      const input = schema.parse(req.body || {});
      const githubToken = githubTokenForUser(req.user, input.githubToken || "");
      const data = await deployer.listGitHubRepositories({ githubToken, search: input.search || "" });
      if (input.githubToken) {
        await store.updateUser(req.user.id, {
          githubAccessTokenEncrypted: encryptSecret(input.githubToken),
          githubLogin: data.user.login,
          githubAvatarUrl: data.user.avatarUrl,
          githubConnectedAt: new Date().toISOString()
        });
      }
      ok(res, { ...data, github: githubConnection(await store.findUserById(req.user.id)) });
    })
  );

  app.post(
    "/api/v1/github/disconnect",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const user = await store.updateUser(req.user.id, {
        githubAccessTokenEncrypted: "",
        githubLogin: "",
        githubAvatarUrl: "",
        githubConnectedAt: null
      });
      ok(res, { github: githubConnection(user) });
    })
  );

  app.post(
    "/api/v1/github/branches",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({
        repoUrl: deployBodySchema.shape.repoUrl,
        githubToken: z.string().trim().max(500).optional()
      });
      const input = schema.parse(req.body || {});
      const data = await deployer.listGitHubBranches({ ...input, githubToken: githubTokenForUser(req.user, input.githubToken || "") });
      ok(res, data);
    })
  );

  app.post(
    "/api/v1/deployments/analyze",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const schema = deployBodySchema.pick({ repoUrl: true, branch: true, rootDir: true, githubToken: true });
      const input = schema.parse({ branch: "main", ...req.body });
      const provider = detectSourceProvider(input.repoUrl) || "github";
      const metadata = await deployer.analyzeRepository({ ...input, githubToken: sourceTokenForUser(req.user, provider, input.githubToken || "") });
      ok(res, metadata);
    })
  );

  app.post(
    "/api/v1/deployments",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const body = deployBodySchema.parse(req.body);
      const provider = detectSourceProvider(body.repoUrl) || "github";
      const result = await deployQueue.run("deploy", {
        user: req.user,
        repoUrl: body.repoUrl,
        branch: body.branch,
        name: body.name,
        customDomain: body.customDomain || "",
        buildCommand: body.buildCommand,
        outputDir: body.outputDir,
        rootDir: body.rootDir,
        envVars: body.envVars || [],
        githubToken: sourceTokenForUser(req.user, provider, body.githubToken || "")
      });
      ok(res, { project: safeProject(result.project), deployment: result.deployment, webhookSecret: result.webhookSecret });
    })
  );

  app.post(
    "/deploy",
    requireUser(store),
    deployLimiter,
    asyncHandler(async (req, res) => {
      const body = deployBodySchema.parse(req.body);
      const provider = detectSourceProvider(body.repoUrl) || "github";
      const result = await deployQueue.run("deploy", {
        user: req.user,
        repoUrl: body.repoUrl,
        branch: body.branch,
        name: body.name,
        customDomain: body.customDomain || "",
        buildCommand: body.buildCommand,
        outputDir: body.outputDir,
        rootDir: body.rootDir,
        envVars: body.envVars || [],
        githubToken: sourceTokenForUser(req.user, provider, body.githubToken || "")
      });
      ok(res, { project: safeProject(result.project), deployment: result.deployment, webhookSecret: result.webhookSecret });
    })
  );

  app.get(
    "/api/v1/projects",
    requireUser(store),
    asyncHandler(async (req, res) => {
      ok(res, safeProjects(await store.listProjects({ userId: req.user.id, search: req.query.search || "", status: req.query.status || "" })));
    })
  );

  app.get(
    "/api/v1/projects/:id",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project || project.userId !== req.user.id) throw fail(404, "Project not found.");
      const deployment = await store.latestDeployment(project.id);
      const deployments = await store.listDeployments({ projectId: project.id, limit: 10 });
      const logs = await store.listDeployLogs({ projectId: project.id, limit: 100 });
      ok(res, { project: safeProject(project), deployment, deployments, logs });
    })
  );

  app.post(
    "/api/v1/projects/:id/stop",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project || project.userId !== req.user.id) throw fail(404, "Project not found.");
      const proc = runningProcesses.get(project.id);
      if (proc) proc.kill("SIGTERM");
      const updated = await store.updateProject(project.id, { active: false, status: "stopped" });
      ok(res, { project: safeProject(updated) });
    })
  );

  app.post(
    "/api/v1/projects/:id/redeploy",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project || project.userId !== req.user.id) throw fail(404, "Project not found.");
      const schema = z.object({ commitSha: z.string().trim().max(80).optional() });
      const { commitSha } = schema.parse(req.body || {});
      const result = await deployQueue.run("redeploy", { kind: "redeploy", projectId: project.id, user: req.user, commitSha: commitSha || "" });
      ok(res, { project: safeProject(result.project), deployment: result.deployment });
    })
  );

  app.delete(
    "/api/v1/projects/:id",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project || project.userId !== req.user.id) throw fail(404, "Project not found.");
      await removeDeploymentDirectory(project.deployPath);
      await store.deleteProject(project.id);
      ok(res);
    })
  );

  app.get(
    "/api/v1/projects/:id/logs",
    requireUser(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project || project.userId !== req.user.id) throw fail(404, "Project not found.");
      ok(res, { logs: await store.listDeployLogs({ projectId: project.id, limit: 200 }) });
    })
  );

  app.post(
    "/api/v1/webhooks/github/:projectId",
    deployLimiter,
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.projectId);
      if (!project || !project.githubWebhookSecret) throw fail(404, "Project not found.");
      const signature = req.get("x-hub-signature-256") || "";
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const expected = `sha256=${crypto.createHmac("sha256", project.githubWebhookSecret).update(rawBody).digest("hex")}`;
      const valid =
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) throw fail(401, "Invalid webhook signature.");
      const ref = String(req.body?.ref || "");
      const branch = ref.replace("refs/heads/", "");
      if (branch !== project.branch) return ok(res, { ignored: true, reason: "Branch does not match deployment branch." });
      const commitSha = req.body?.after || "";
      const result = await deployQueue.run("redeploy", { kind: "redeploy", projectId: project.id, commitSha });
      ok(res, { project: safeProject(result.project), deployment: result.deployment });
    })
  );

  app.post(
    "/api/v1/admin/login",
    authLimiter,
    asyncHandler(async (req, res) => {
      const schema = z.object({ username: z.string(), password: z.string() });
      const { username, password } = schema.parse(req.body);
      const genericAdminError = "Invalid credentials.";
      const lock = await adminLoginLockout.check("admin", username, clientIp(req));
      if (lock.locked) throw fail(429, genericAdminError, { retryAfterSeconds: Math.ceil(lock.remainingMs / 1000) });
      if (username !== config.adminUsername) {
        const failed = await adminLoginLockout.fail("admin", username, clientIp(req));
        if (failed.lockedUntil) throw fail(429, genericAdminError, { retryAfterSeconds: Math.ceil((failed.lockedUntil - Date.now()) / 1000) });
        throw fail(401, genericAdminError);
      }
      const user = await store.findUserByEmail("dream@launchpad.local");
      if (!user || user.role !== "admin") throw fail(401, genericAdminError);
      const validPassword = password === config.adminPassword || (await verifyPassword(password, user.passwordHash));
      if (!validPassword) {
        const failed = await adminLoginLockout.fail("admin", username, clientIp(req));
        if (failed.lockedUntil) throw fail(429, genericAdminError, { retryAfterSeconds: Math.ceil((failed.lockedUntil - Date.now()) / 1000) });
        throw fail(401, genericAdminError);
      }
      await adminLoginLockout.success("admin", username, clientIp(req));
      const tokens = await issueUserTokens(store, user, req, false, "admin");
      setAdminCookies(res, tokens);
      req.admin = user;
      await adminLog(store, req, "admin.login");
      ok(res, { admin: publicUser(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    })
  );

  app.post(
    "/api/v1/admin/logout",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const refreshToken = req.body?.refreshToken || req.cookies.lp_admin_refresh;
      if (refreshToken) {
        const session = await store.findSessionByRefreshHash(hashToken(refreshToken), "admin");
        if (session) await store.revokeSession(session.id);
      }
      await adminLog(store, req, "admin.logout");
      clearAdminCookies(res);
      ok(res);
    })
  );

  app.get(
    "/api/v1/admin/me",
    requireAdmin(store),
    asyncHandler(async (req, res) => ok(res, { admin: publicUser(req.admin) }))
  );

  app.get(
    "/api/v1/admin/overview",
    requireAdmin(store),
    asyncHandler(async (_req, res) => {
      const [load, mem, disk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize().catch(() => [])]);
      const overview = await store.overview();
      ok(res, {
        overview,
        resources: {
          cpu: Math.round(load.currentLoad || 0),
          ram: Math.round((mem.used / mem.total) * 100),
          disk: disk[0] ? Math.round((disk[0].used / disk[0].size) * 100) : 0,
          websocketConnections: app.locals.socketHub?.stats().connections || 0
        },
        activity: await store.listAdminLogs(10),
        queue: app.locals.deployQueue ? await app.locals.deployQueue.status() : { waiting: 0, active: 0, completed: overview.deployments }
      });
    })
  );

  app.get(
    "/api/v1/admin/users",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      ok(
        res,
        await store.listUsers({
          page: Number(req.query.page || 1),
          limit: Number(req.query.limit || 25),
          search: req.query.search || "",
          role: req.query.role || "",
          plan: req.query.plan || "",
          status: req.query.status || ""
        })
      );
    })
  );

  app.get(
    "/api/v1/admin/users/:id",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const user = await store.findUserById(req.params.id);
      if (!user) throw fail(404, "User not found.");
      const projects = await store.listProjects({ userId: user.id });
      ok(res, { user: safePublicUser(user), projects: projects.items.map(safeProject) });
    })
  );

  app.patch(
    "/api/v1/admin/users/:id",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({
        banned: z.boolean().optional(),
        role: z.enum(["admin", "user"]).optional(),
        plan: z.string().optional(),
        name: z.string().min(2).optional()
      });
      const patch = schema.parse(req.body);
      const user = await store.updateUser(req.params.id, patch);
      if (!user) throw fail(404, "User not found.");
      await adminLog(store, req, "user.update", "user", user.id, patch);
      ok(res, { user: safePublicUser(user) });
    })
  );

  app.post(
    "/api/v1/admin/users/:id/reset-password",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({ password: z.string().min(8) });
      const { password } = schema.parse(req.body);
      const user = await store.updateUser(req.params.id, { passwordHash: await hashPassword(password) });
      if (!user) throw fail(404, "User not found.");
      await adminLog(store, req, "user.reset_password", "user", user.id);
      ok(res);
    })
  );

  app.post(
    "/api/v1/admin/users/:id/impersonate",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const user = await store.findUserById(req.params.id);
      if (!user || user.banned) throw fail(404, "User not found.");
      const tokens = await issueUserTokens(store, user, req, false, "user");
      setUserCookies(res, tokens, false);
      await adminLog(store, req, "user.impersonate", "user", user.id);
      ok(res, { user: safePublicUser(user), accessToken: tokens.accessToken });
    })
  );

  app.delete(
    "/api/v1/admin/users/:id",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const user = await store.findUserById(req.params.id);
      if (!user) throw fail(404, "User not found.");
      const projects = await store.listProjects({ userId: user.id });
      for (const project of projects.items) await removeDeploymentDirectory(project.deployPath);
      await store.deleteUser(user.id);
      await adminLog(store, req, "user.delete", "user", user.id);
      ok(res);
    })
  );

  app.get(
    "/api/v1/admin/projects",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      ok(
        res,
        safeProjects(await store.listProjects({
          page: Number(req.query.page || 1),
          limit: Number(req.query.limit || 50),
          status: req.query.status || "",
          search: req.query.search || ""
        }))
      );
    })
  );

  app.get(
    "/api/v1/admin/projects/:id/logs",
    requireAdmin(store),
    asyncHandler(async (req, res) => ok(res, { logs: await store.listDeployLogs({ projectId: req.params.id, limit: 300 }) }))
  );

  app.post(
    "/api/v1/admin/projects/:id/stop",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const project = await store.updateProject(req.params.id, { active: false, status: "stopped" });
      if (!project) throw fail(404, "Project not found.");
      const proc = runningProcesses.get(project.id);
      if (proc) proc.kill("SIGTERM");
      await adminLog(store, req, "project.stop", "project", project.id);
      ok(res, { project: safeProject(project) });
    })
  );

  app.post(
    "/api/v1/admin/projects/:id/restart",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const project = await store.updateProject(req.params.id, { active: true, status: "live" });
      if (!project) throw fail(404, "Project not found.");
      await adminLog(store, req, "project.restart", "project", project.id);
      ok(res, { project: safeProject(project) });
    })
  );

  app.post(
    "/api/v1/admin/projects/:id/redeploy",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project) throw fail(404, "Project not found.");
      const result = await deployQueue.run("redeploy", { kind: "redeploy", projectId: project.id, user: req.admin });
      await adminLog(store, req, "project.redeploy", "project", project.id);
      ok(res, { project: safeProject(result.project), deployment: result.deployment });
    })
  );

  app.delete(
    "/api/v1/admin/projects/:id",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const project = await store.findProjectById(req.params.id);
      if (!project) throw fail(404, "Project not found.");
      await removeDeploymentDirectory(project.deployPath);
      await store.deleteProject(project.id);
      await adminLog(store, req, "project.delete", "project", project.id);
      ok(res);
    })
  );

  app.get(
    "/api/v1/admin/settings",
    requireAdmin(store),
    asyncHandler(async (_req, res) => ok(res, { settings: await store.settings() }))
  );

  app.patch(
    "/api/v1/admin/settings",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({
        siteName: z.string().min(1).optional(),
        logoUrl: z.string().optional(),
        faviconUrl: z.string().optional(),
        deploymentLimit: z.number().int().min(1).max(100).optional(),
        maintenanceMode: z.boolean().optional(),
        maxBuildTimeSeconds: z.number().int().min(10).max(3600).optional(),
        smtp: z.record(z.any()).optional(),
        announcement: z.string().max(2000).optional()
      });
      const settings = await store.updateSettings(schema.parse(req.body));
      await adminLog(store, req, "settings.update", "", "", req.body);
      ok(res, { settings });
    })
  );

  app.post(
    "/api/v1/admin/password",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) });
      const input = schema.parse(req.body);
      if (input.currentPassword !== config.adminPassword && !(await bcrypt.compare(input.currentPassword, req.admin.passwordHash))) {
        throw fail(401, "Current password is incorrect.");
      }
      await store.updateUser(req.admin.id, { passwordHash: await hashPassword(input.newPassword) });
      await adminLog(store, req, "admin.change_password");
      ok(res);
    })
  );

  app.get(
    "/api/v1/admin/logs",
    requireAdmin(store),
    asyncHandler(async (_req, res) => {
      const [serverLog, errorLog] = await Promise.all([
        fs.readFile(path.join(config.paths.root, "server.log"), "utf8").catch(() => ""),
        fs.readFile(path.join(config.paths.root, "server-error.log"), "utf8").catch(() => "")
      ]);
      ok(res, {
        adminLogs: await store.listAdminLogs(100),
        serverLog: serverLog.split(/\r?\n/).slice(-300),
        errorLog: errorLog.split(/\r?\n/).slice(-300),
        websocketConnections: app.locals.socketHub?.stats().connections || 0
      });
    })
  );

  app.post(
    "/api/v1/admin/notifications",
    requireAdmin(store),
    asyncHandler(async (req, res) => {
      const schema = z.object({ title: z.string().min(1), message: z.string().min(1), emailBlast: z.boolean().optional() });
      const input = schema.parse(req.body);
      const notification = await store.createNotification({ ...input, createdBy: req.admin.id });
      if (input.emailBlast) {
        const users = await store.listUsers({ limit: 5000 });
        for (const user of users.items.filter((item) => item.role === "user" && !item.banned)) {
          await sendMail(store, { to: user.email, subject: input.title, text: input.message });
        }
      }
      await store.updateSettings({ announcement: `${input.title}: ${input.message}` });
      await adminLog(store, req, "notification.send", "notification", notification.id);
      ok(res, { notification });
    })
  );

  app.get(
    "/api/v1/admin/notifications",
    requireAdmin(store),
    asyncHandler(async (_req, res) => ok(res, { notifications: await store.listNotifications(100) }))
  );

  app.get("/@:slug", asyncHandler((req, res) => serveProject(store, req, res)));
  app.get("/@:slug/*", asyncHandler((req, res) => serveProject(store, req, res)));
  app.get("/preview/:slug", asyncHandler((req, res) => serveProject(store, req, res)));
  app.get("/preview/:slug/*", asyncHandler((req, res) => serveProject(store, req, res)));
  app.use(asyncHandler((req, res, next) => serveSubdomainProject(store, req, res, next)));

  if (fss.existsSync(config.paths.publicDist)) {
    app.use(express.static(config.paths.publicDist, { maxAge: "1y", immutable: true, setHeaders: staticCacheHeaders }));
  }

  app.get("*", async (_req, res) => {
    const indexPath = path.join(config.paths.publicDist, "index.html");
    if (fss.existsSync(indexPath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.sendFile(indexPath);
    }
    res.status(200).send(`<html><body><h1>DreamX</h1><p>Run <code>cd ../front-end && npm run build</code> to build the React client.</p></body></html>`);
  });

  app.use((error, req, res, _next) => {
    if (error instanceof z.ZodError) {
      const messages = [...new Set(error.errors.map((item) => translateError(req, item.message)))];
      return res.status(400).json({ success: false, error: messages.join(" ") });
    }
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, error: translateError(req, "Uploaded file is too large.") });
    const payload = { success: false, error: translateError(req, error.message || "Internal server error.") };
    if (error.retryAfterSeconds) payload.retryAfterSeconds = error.retryAfterSeconds;
    res.status(error.status || 500).json(payload);
  });

  return { app, store, deployer };
}

async function serveSubdomainProject(store, req, res, next) {
  const host = (req.headers.host || "").split(":")[0];
  const suffix = `.${config.publicDomain}`;
  if (!config.publicDomain || host === config.publicDomain || !host.endsWith(suffix)) return next();
  const slug = host.slice(0, -suffix.length);
  const project = await store.findProjectBySlug(slug);
  if (!project || !project.active) return next();
  return sendProjectFile(project, req, res);
}

async function serveProject(store, req, res) {
  const project = await store.findProjectBySlug(req.params.slug);
  if (!project || !project.active) throw fail(404, "Project not found.");
  return sendProjectFile(project, req, res);
}

async function sendProjectFile(project, req, res) {
  const base = path.resolve(project.deployPath || "");
  if (!base || !isInside(config.paths.deployments, base)) throw fail(404, "Project is not available.");
  const raw = projectRequestPath(req, project);
  const requested = raw === "/" || raw === "" ? "index.html" : decodeURIComponent(raw).replace(/^\/+/, "");
  const target = path.resolve(base, requested);
  if (!isInside(base, target)) throw fail(403, "Invalid path.");
  if (fss.existsSync(target) && fss.statSync(target).isFile()) {
    if (path.basename(target).toLowerCase() === "index.html") {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    return res.sendFile(target);
  }
  const spaMarker = path.join(base, ".launchpad-spa");
  const indexPath = path.join(base, "index.html");
  if (fss.existsSync(spaMarker) && fss.existsSync(indexPath)) {
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(indexPath);
  }
  throw fail(404, "File not found.");
}

function projectRequestPath(req, project) {
  if (typeof req.params?.[0] === "string") return req.params[0] || "/";
  const atPrefix = `/@${project.slug}`;
  const previewPrefix = `/preview/${project.slug}`;
  if (req.path === atPrefix || req.path === previewPrefix) return "/";
  if (req.path.startsWith(`${atPrefix}/`)) return req.path.slice(atPrefix.length);
  if (req.path.startsWith(`${previewPrefix}/`)) return req.path.slice(previewPrefix.length);
  return req.path || "/";
}

module.exports = { createApp };
