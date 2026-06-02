const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { config } = require("./config");
const { normalizeEmail } = require("./store");

const strongPasswordSchema = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value), {
    message: "Password must include uppercase, lowercase, and a number."
  });

const registerSchema = z.object({
  name: z.string({ required_error: "Name is required." }).trim().min(2, "Name must be at least 2 characters.").max(80, "Name is too long."),
  email: z.string({ required_error: "Email is required." }).trim().email("Enter a valid email address.").max(180, "Email is too long."),
  password: strongPasswordSchema,
  remember: z.boolean().optional()
});

const loginSchema = z.object({
  email: z.string({ required_error: "Email is required." }).trim().email("Enter a valid email address."),
  password: z.string({ required_error: "Password is required." }).min(1, "Password is required."),
  remember: z.boolean().optional()
});

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenExpires(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || "",
    role: user.role,
    plan: user.plan,
    banned: Boolean(user.banned),
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt
  };
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, type: "user" }, config.jwtAccessSecret, {
    expiresIn: config.accessTtl
  });
}

function signAdminToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: "admin", type: "admin" }, config.adminJwtSecret, {
    expiresIn: config.accessTtl
  });
}

async function issueUserTokens(store, user, req, remember = false, type = "user") {
  const refreshToken = randomToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshDays = remember ? config.rememberRefreshTtlDays : config.refreshTtlDays;
  const session = await store.createSession({
    userId: user.id,
    refreshTokenHash,
    type,
    userAgent: req.get("user-agent") || "",
    ip: req.ip,
    expiresAt: tokenExpires(refreshDays)
  });
  const accessToken = type === "admin" ? signAdminToken(user) : signAccessToken(user);
  return { accessToken, refreshToken, session, user: publicUser(user) };
}

function setUserCookies(res, tokens, remember = false) {
  const maxAge = (remember ? config.rememberRefreshTtlDays : config.refreshTtlDays) * 24 * 60 * 60 * 1000;
  const secure = config.env === "production";
  res.cookie("lp_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", secure, maxAge: 15 * 60 * 1000 });
  res.cookie("lp_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", secure, maxAge });
}

function setAdminCookies(res, tokens) {
  res.cookie("lp_admin_access", tokens.accessToken, { httpOnly: true, sameSite: "strict", secure: true, maxAge: 15 * 60 * 1000 });
  res.cookie("lp_admin_refresh", tokens.refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000
  });
}

function clearUserCookies(res) {
  res.clearCookie("lp_access");
  res.clearCookie("lp_refresh");
}

function clearAdminCookies(res) {
  res.clearCookie("lp_admin_access");
  res.clearCookie("lp_admin_refresh");
}

function bearer(req, cookieName) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[cookieName] || "";
}

function requireUser(store) {
  return async (req, res, next) => {
    try {
      const token = bearer(req, "lp_access");
      if (!token) return res.status(401).json({ success: false, error: "Authentication required." });
      const payload = jwt.verify(token, config.jwtAccessSecret);
      if (payload.type !== "user") return res.status(401).json({ success: false, error: "Invalid token type." });
      const user = await store.findUserById(payload.sub);
      if (!user || user.banned) return res.status(401).json({ success: false, error: "Account unavailable." });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ success: false, error: "Session expired." });
    }
  };
}

function optionalUser(store) {
  return async (req, _res, next) => {
    try {
      const token = bearer(req, "lp_access");
      if (token) {
        const payload = jwt.verify(token, config.jwtAccessSecret);
        const user = await store.findUserById(payload.sub);
        if (user && !user.banned) req.user = user;
      }
    } catch {
      // Optional auth intentionally ignores expired tokens.
    }
    next();
  };
}

function requireAdminAuthenticated(store) {
  return async (req, res, next) => {
    try {
      const token = bearer(req, "lp_admin_access");
      if (!token) return res.status(404).json({ success: false, error: "Not found." });
      const payload = jwt.verify(token, config.adminJwtSecret);
      const user = await store.findUserById(payload.sub);
      if (!user || user.banned) return res.status(404).json({ success: false, error: "Not found." });
      req.admin = user;
      next();
    } catch {
      res.status(404).json({ success: false, error: "Not found." });
    }
  };
}

function requireAdminRole(req, res, next) {
  if (!req.admin || req.admin.role !== "admin") return res.status(404).json({ success: false, error: "Not found." });
  next();
}

function requireAdmin(store) {
  return [requireAdminAuthenticated(store), requireAdminRole];
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash || "");
}

async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptRounds);
}

module.exports = {
  registerSchema,
  loginSchema,
  randomToken,
  hashToken,
  tokenExpires,
  publicUser,
  issueUserTokens,
  setUserCookies,
  setAdminCookies,
  clearUserCookies,
  clearAdminCookies,
  requireUser,
  optionalUser,
  requireAdminAuthenticated,
  requireAdminRole,
  requireAdmin,
  verifyPassword,
  hashPassword,
  normalizeEmail
};
