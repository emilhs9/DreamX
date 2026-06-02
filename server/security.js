const crypto = require("crypto");
const IORedis = require("ioredis");

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

class LoginLockout {
  constructor(redisUrl = "", { maxAttempts = 5, lockMs = 15 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.lockMs = lockMs;
    this.entries = new Map();
    this.redis = redisUrl ? new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : null;
    this.redis?.on("error", () => {});
  }

  key(scope, identifier, ip) {
    return `${scope}:${String(identifier || "unknown").toLowerCase()}:${ip || "unknown"}`;
  }

  async check(scope, identifier, ip) {
    const key = this.key(scope, identifier, ip);
    if (this.redis) {
      try {
        const lockedUntil = Number(await this.redis.get(`${key}:locked`));
        if (lockedUntil && lockedUntil > Date.now()) return { locked: true, remainingMs: lockedUntil - Date.now() };
        return { locked: false, remainingMs: 0 };
      } catch {
        return this.checkMemory(key);
      }
    }
    return this.checkMemory(key);
  }

  checkMemory(key) {
    const entry = this.entries.get(key);
    if (!entry) return { locked: false, remainingMs: 0 };
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      return { locked: true, remainingMs: entry.lockedUntil - Date.now() };
    }
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) this.entries.delete(key);
    return { locked: false, remainingMs: 0 };
  }

  async fail(scope, identifier, ip) {
    const key = this.key(scope, identifier, ip);
    if (this.redis) {
      try {
        const attemptsKey = `${key}:attempts`;
        const lockedKey = `${key}:locked`;
        const attempts = await this.redis.incr(attemptsKey);
        await this.redis.pexpire(attemptsKey, this.lockMs);
        if (attempts >= this.maxAttempts) {
          const lockedUntil = Date.now() + this.lockMs;
          await this.redis.set(lockedKey, String(lockedUntil), "PX", this.lockMs);
          await this.redis.del(attemptsKey);
          return { attempts: 0, lockedUntil };
        }
        return { attempts, lockedUntil: 0 };
      } catch {
        return this.failMemory(key);
      }
    }
    return this.failMemory(key);
  }

  failMemory(key) {
    const entry = this.entries.get(key) || { attempts: 0, lockedUntil: 0 };
    entry.attempts += 1;
    if (entry.attempts >= this.maxAttempts) {
      entry.lockedUntil = Date.now() + this.lockMs;
      entry.attempts = 0;
    }
    this.entries.set(key, entry);
    return entry;
  }

  async success(scope, identifier, ip) {
    const key = this.key(scope, identifier, ip);
    if (this.redis) {
      try {
        await this.redis.del(`${key}:attempts`, `${key}:locked`);
      } catch {
        this.entries.delete(key);
      }
      return;
    }
    this.entries.delete(key);
  }
}

function createCsrfToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function attachCsrfCookie(req, res, next) {
  if (!req.cookies.lp_csrf) {
    res.cookie("lp_csrf", createCsrfToken(), {
      httpOnly: false,
      sameSite: "lax",
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      maxAge: 24 * 60 * 60 * 1000
    });
  }
  next();
}

function csrfProtection(req, res, next) {
  if (!unsafeMethods.has(req.method)) return next();
  if (!req.path.startsWith("/api/")) return next();

  const publicAuthRoutes = [
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/forgot-password",
    "/api/v1/admin/login",
    "/api/admin/login"
  ];
  if (publicAuthRoutes.some((route) => req.path.startsWith(route))) return next();

  const authorization = req.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return next();

  const hasAuthCookie = Boolean(req.cookies.lp_access || req.cookies.lp_admin_access || req.cookies.lp_refresh || req.cookies.lp_admin_refresh);
  if (!hasAuthCookie) return next();

  const csrfCookie = req.cookies.lp_csrf;
  const csrfHeader = req.get("x-csrf-token");
  if (csrfCookie && csrfHeader && csrfCookie === csrfHeader) return next();

  return res.status(403).json({ success: false, error: "CSRF token is missing or invalid." });
}

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

function staticCacheHeaders(res, filePath) {
  if (/\.html?$/i.test(filePath)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return;
  }
  if (/\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(filePath)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
}

function noStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

async function adminLog(store, req, action, targetType = "", targetId = "", metadata = {}) {
  return store.createAdminLog({
    adminId: req.admin?.id || null,
    action,
    targetType,
    targetId,
    metadata: {
      ...metadata,
      ip: clientIp(req),
      userAgent: req.get("user-agent") || ""
    }
  });
}

module.exports = {
  LoginLockout,
  attachCsrfCookie,
  csrfProtection,
  securityHeaders,
  staticCacheHeaders,
  noStoreHeaders,
  clientIp,
  adminLog
};
