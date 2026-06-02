const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { config } = require("./config");
const { migrate } = require("./migrate");

const dataFile = path.join(config.paths.data, "launchpad.json");

const defaultSettings = {
  siteName: "DreamX",
  logoUrl: "",
  faviconUrl: "",
  deploymentLimit: 3,
  maintenanceMode: false,
  maxBuildTimeSeconds: config.buildTimeoutSeconds,
  smtp: config.smtp,
  announcement: ""
};

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function camel(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function decamel(value) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function copyPatch(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

class LaunchPadStore {
  constructor() {
    this.pool = null;
    this.data = null;
    this.usingPostgres = Boolean(config.databaseUrl);
  }

  async init() {
    if (this.usingPostgres) {
      this.pool = new Pool({ connectionString: config.databaseUrl });
      await migrate(this.pool);
      await this.seedDefaults();
      return;
    }
    await this.loadFile();
    await this.seedDefaults();
  }

  async loadFile() {
    try {
      this.data = JSON.parse(await fs.readFile(dataFile, "utf8"));
    } catch {
      this.data = {
        users: [],
        sessions: [],
        projects: [],
        deployments: [],
        deployLogs: [],
        notifications: [],
        settings: defaultSettings,
        adminLogs: []
      };
      await this.saveFile();
    }
  }

  async saveFile() {
    if (!this.usingPostgres) {
      await fs.writeFile(dataFile, JSON.stringify(this.data, null, 2));
    }
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows.map(camel);
  }

  async seedDefaults() {
    const adminEmail = "dream@launchpad.local";
    const adminPasswordHash = await bcrypt.hash(config.adminPassword, config.bcryptRounds);
    if (this.usingPostgres) {
      const settingRows = await this.query("SELECT key FROM settings WHERE key = 'platform'");
      if (!settingRows.length) {
        await this.pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ["platform", JSON.stringify(defaultSettings)]);
      }
      const adminRows = await this.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
      if (!adminRows.length) {
        await this.pool.query(
          "INSERT INTO users (name, email, password_hash, role, email_verified, banned, is_banned) VALUES ($1, $2, $3, 'admin', TRUE, FALSE, FALSE)",
          ["Dream Admin", adminEmail, adminPasswordHash]
        );
      } else {
        await this.pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [adminEmail]);
      }
      return;
    }
    this.data.settings = { ...defaultSettings, ...(this.data.settings || {}) };
    const admin = this.data.users.find((user) => user.email === adminEmail);
    if (!admin) {
      this.data.users.push({
        id: id(),
        name: "Dream Admin",
        email: adminEmail,
        passwordHash: adminPasswordHash,
        avatarUrl: "",
        role: "admin",
        plan: "enterprise",
        banned: false,
        emailVerified: true,
        createdAt: now(),
        updatedAt: now()
      });
    } else {
      admin.role = "admin";
      admin.updatedAt = now();
    }
    await this.saveFile();
  }

  async settings() {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT value FROM settings WHERE key = 'platform'");
      return { ...defaultSettings, ...(rows[0]?.value || {}) };
    }
    return { ...defaultSettings, ...(this.data.settings || {}) };
  }

  async updateSettings(patch) {
    const value = { ...(await this.settings()), ...copyPatch(patch) };
    if (this.usingPostgres) {
      await this.pool.query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('platform', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
        [JSON.stringify(value)]
      );
      return value;
    }
    this.data.settings = value;
    await this.saveFile();
    return value;
  }

  async createUser(input) {
    const user = {
      id: id(),
      name: input.name,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      avatarUrl: input.avatarUrl || "",
      role: input.role || "user",
      plan: input.plan || "free",
      banned: false,
      emailVerified: Boolean(input.emailVerified),
      verificationTokenHash: input.verificationTokenHash || null,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      githubAccessTokenEncrypted: "",
      githubLogin: "",
      githubAvatarUrl: "",
      githubConnectedAt: null,
      sourceConnections: {},
      createdAt: now(),
      updatedAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        `INSERT INTO users
          (id, name, email, password_hash, avatar_url, role, plan, banned, is_banned, email_verified, verification_token_hash, github_access_token_encrypted, github_login, github_avatar_url, github_connected_at, source_connections)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.avatarUrl,
          user.role,
          user.plan,
          user.banned,
          user.emailVerified,
          user.verificationTokenHash,
          user.githubAccessTokenEncrypted,
          user.githubLogin,
          user.githubAvatarUrl,
          user.githubConnectedAt,
          JSON.stringify(user.sourceConnections)
        ]
      );
      return rows[0];
    }
    this.data.users.push(user);
    await this.saveFile();
    return user;
  }

  async findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM users WHERE email = $1", [normalized]);
      return rows[0] || null;
    }
    return this.data.users.find((user) => user.email === normalized) || null;
  }

  async findUserById(userId) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM users WHERE id = $1", [userId]);
      return rows[0] || null;
    }
    return this.data.users.find((user) => user.id === userId) || null;
  }

  async findUserByVerificationHash(tokenHash) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM users WHERE verification_token_hash = $1", [tokenHash]);
      return rows[0] || null;
    }
    return this.data.users.find((user) => user.verificationTokenHash === tokenHash) || null;
  }

  async findUserByResetHash(tokenHash) {
    if (this.usingPostgres) {
      const rows = await this.query(
        "SELECT * FROM users WHERE reset_token_hash = $1 AND reset_token_expires_at > NOW()",
        [tokenHash]
      );
      return rows[0] || null;
    }
    return (
      this.data.users.find(
        (user) => user.resetTokenHash === tokenHash && user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) > new Date()
      ) || null
    );
  }

  async updateUser(userId, patch) {
      const data = copyPatch(patch);
      if (Object.prototype.hasOwnProperty.call(data, "banned")) data.isBanned = data.banned;
    data.updatedAt = now();
    if (this.usingPostgres) {
      const entries = Object.entries(data);
      const sets = entries.map(([key], index) => `${decamel(key)} = $${index + 2}`);
      const rows = await this.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, [
        userId,
        ...entries.map(([, value]) => value)
      ]);
      return rows[0] || null;
    }
    const user = await this.findUserById(userId);
    if (!user) return null;
    Object.assign(user, data);
    await this.saveFile();
    return user;
  }

  async deleteUser(userId) {
    if (this.usingPostgres) {
      await this.pool.query("DELETE FROM users WHERE id = $1", [userId]);
      return;
    }
    const userProjects = this.data.projects.filter((project) => project.userId === userId).map((project) => project.id);
    this.data.users = this.data.users.filter((user) => user.id !== userId);
    this.data.sessions = this.data.sessions.filter((session) => session.userId !== userId);
    this.data.projects = this.data.projects.filter((project) => project.userId !== userId);
    this.data.deployments = this.data.deployments.filter((deployment) => deployment.userId !== userId);
    this.data.deployLogs = this.data.deployLogs.filter((log) => !userProjects.includes(log.projectId));
    await this.saveFile();
  }

  async listUsers({ page = 1, limit = 20, search = "", role = "", plan = "", status = "" } = {}) {
    const offset = (page - 1) * limit;
    if (this.usingPostgres) {
      const clauses = [];
      const params = [];
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        clauses.push(`(LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
      }
      if (role) {
        params.push(role);
        clauses.push(`role = $${params.length}`);
      }
      if (plan) {
        params.push(plan);
        clauses.push(`plan = $${params.length}`);
      }
      if (status === "banned" || status === "active") {
        params.push(status === "banned");
        clauses.push(`banned = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const totalRows = await this.query(`SELECT COUNT(*)::int AS count FROM users ${where}`, params);
      params.push(limit, offset);
      const rows = await this.query(
        `SELECT id, name, email, avatar_url, role, plan, banned, email_verified, created_at, updated_at,
          (SELECT COUNT(*)::int FROM projects p WHERE p.user_id = users.id) AS projects_count
         FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return { items: rows, total: totalRows[0]?.count || 0 };
    }
    let items = [...this.data.users];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((user) => user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q));
    }
    if (role) items = items.filter((user) => user.role === role);
    if (plan) items = items.filter((user) => user.plan === plan);
    if (status === "banned" || status === "active") items = items.filter((user) => Boolean(user.banned) === (status === "banned"));
    items = items.map((user) => ({
      ...user,
      projectsCount: this.data.projects.filter((project) => project.userId === user.id).length
    }));
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async createSession(input) {
    const session = {
      id: id(),
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      type: input.type || "user",
      userAgent: input.userAgent || "",
      ip: input.ip || "",
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, type, user_agent, ip, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [session.id, session.userId, session.refreshTokenHash, session.type, session.userAgent, session.ip, session.expiresAt]
      );
      return rows[0];
    }
    this.data.sessions.push(session);
    await this.saveFile();
    return session;
  }

  async findSessionByRefreshHash(refreshTokenHash, type = "user") {
    if (this.usingPostgres) {
      const rows = await this.query(
        "SELECT * FROM sessions WHERE refresh_token_hash = $1 AND type = $2 AND revoked_at IS NULL AND expires_at > NOW()",
        [refreshTokenHash, type]
      );
      return rows[0] || null;
    }
    return (
      this.data.sessions.find(
        (session) =>
          session.refreshTokenHash === refreshTokenHash &&
          session.type === type &&
          !session.revokedAt &&
          new Date(session.expiresAt) > new Date()
      ) || null
    );
  }

  async revokeSession(sessionId) {
    if (this.usingPostgres) {
      await this.pool.query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1", [sessionId]);
      return;
    }
    const session = this.data.sessions.find((item) => item.id === sessionId);
    if (session) session.revokedAt = now();
    await this.saveFile();
  }

  async revokeUserSessions(userId, type = "user") {
    if (this.usingPostgres) {
      await this.pool.query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND type = $2 AND revoked_at IS NULL", [userId, type]);
      return;
    }
    for (const session of this.data.sessions) {
      if (session.userId === userId && session.type === type && !session.revokedAt) session.revokedAt = now();
    }
    await this.saveFile();
  }

  async activeProjectCount(userId) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND active = TRUE", [userId]);
      return rows[0]?.count || 0;
    }
    return this.data.projects.filter((project) => project.userId === userId && project.active).length;
  }

  async createProject(input) {
    const project = {
      id: id(),
      userId: input.userId,
      name: input.name,
      slug: input.slug,
      customDomain: input.customDomain || "",
      framework: input.framework || "Static",
      entryPoint: input.entryPoint || "",
      buildCommand: input.buildCommand || "",
      outputDir: input.outputDir || "",
      status: input.status || "building",
      active: input.active !== false,
      url: input.url || "",
      deployPath: input.deployPath || "",
      runtimePort: input.runtimePort || null,
      sourceType: input.sourceType || "github",
      repoUrl: input.repoUrl || "",
      repoOwner: input.repoOwner || "",
      repoName: input.repoName || "",
      branch: input.branch || "main",
      rootDir: input.rootDir || "",
      githubTokenEncrypted: input.githubTokenEncrypted || "",
      githubWebhookSecret: input.githubWebhookSecret || "",
      envVars: input.envVars || [],
      lastCommitSha: input.lastCommitSha || "",
      lastCommitMessage: input.lastCommitMessage || "",
      repoMeta: input.repoMeta || {},
      createdAt: now(),
      updatedAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        `INSERT INTO projects
         (id, user_id, name, slug, custom_domain, framework, entry_point, build_command, output_dir, status, active, url, deploy_path, runtime_port,
          source_type, repo_url, repo_owner, repo_name, branch, root_dir, github_token_encrypted, github_webhook_secret, env_vars,
          last_commit_sha, last_commit_message, repo_meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
        [
          project.id,
          project.userId,
          project.name,
          project.slug,
          project.customDomain,
          project.framework,
          project.entryPoint,
          project.buildCommand,
          project.outputDir,
          project.status,
          project.active,
          project.url,
          project.deployPath,
          project.runtimePort,
          project.sourceType,
          project.repoUrl,
          project.repoOwner,
          project.repoName,
          project.branch,
          project.rootDir,
          project.githubTokenEncrypted,
          project.githubWebhookSecret,
          JSON.stringify(project.envVars),
          project.lastCommitSha,
          project.lastCommitMessage,
          JSON.stringify(project.repoMeta)
        ]
      );
      return rows[0];
    }
    this.data.projects.push(project);
    await this.saveFile();
    return project;
  }

  async updateProject(projectId, patch) {
    const data = copyPatch(patch);
    data.updatedAt = now();
    if (this.usingPostgres) {
      const entries = Object.entries(data);
      const sets = entries.map(([key], index) => `${decamel(key)} = $${index + 2}`);
      const rows = await this.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, [
        projectId,
        ...entries.map(([, value]) => value)
      ]);
      return rows[0] || null;
    }
    const project = await this.findProjectById(projectId);
    if (!project) return null;
    Object.assign(project, data);
    await this.saveFile();
    return project;
  }

  async findProjectById(projectId) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM projects WHERE id = $1", [projectId]);
      return rows[0] || null;
    }
    return this.data.projects.find((project) => project.id === projectId) || null;
  }

  async findProjectBySlug(slug) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM projects WHERE slug = $1", [slug]);
      return rows[0] || null;
    }
    return this.data.projects.find((project) => project.slug === slug) || null;
  }

  async listProjects({ userId, page = 1, limit = 50, status = "", search = "" } = {}) {
    const offset = (page - 1) * limit;
    if (this.usingPostgres) {
      const clauses = [];
      const params = [];
      if (userId) {
        params.push(userId);
        clauses.push(`p.user_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        clauses.push(`p.status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        clauses.push(`(LOWER(p.name) LIKE $${params.length} OR LOWER(p.slug) LIKE $${params.length})`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = await this.query(`SELECT COUNT(*)::int AS count FROM projects p ${where}`, params);
      params.push(limit, offset);
      const rows = await this.query(
        `SELECT p.*, u.email AS user_email, u.name AS user_name
         FROM projects p JOIN users u ON u.id = p.user_id
         ${where} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return { items: rows, total: total[0]?.count || 0 };
    }
    let items = [...this.data.projects].map((project) => {
      const user = this.data.users.find((item) => item.id === project.userId);
      return { ...project, userEmail: user?.email || "", userName: user?.name || "" };
    });
    if (userId) items = items.filter((project) => project.userId === userId);
    if (status) items = items.filter((project) => project.status === status);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((project) => project.name.toLowerCase().includes(q) || project.slug.toLowerCase().includes(q));
    }
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async deleteProject(projectId) {
    if (this.usingPostgres) {
      await this.pool.query("DELETE FROM projects WHERE id = $1", [projectId]);
      return;
    }
    this.data.projects = this.data.projects.filter((project) => project.id !== projectId);
    this.data.deployments = this.data.deployments.filter((deployment) => deployment.projectId !== projectId);
    this.data.deployLogs = this.data.deployLogs.filter((log) => log.projectId !== projectId);
    await this.saveFile();
  }

  async createDeployment(input) {
    const deployment = {
      id: id(),
      projectId: input.projectId,
      userId: input.userId,
      status: input.status || "building",
      framework: input.framework || "",
      buildCommand: input.buildCommand || "",
      entryPoint: input.entryPoint || "",
      sourceRepo: input.sourceRepo || "",
      branch: input.branch || "",
      commitSha: input.commitSha || "",
      outputDir: input.outputDir || "",
      url: input.url || "",
      deployTimeMs: input.deployTimeMs || null,
      startedAt: now(),
      finishedAt: input.finishedAt || null
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        `INSERT INTO deployments
         (id, project_id, user_id, status, framework, build_command, entry_point, source_repo, branch, commit_sha, output_dir, url, deploy_time_ms, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          deployment.id,
          deployment.projectId,
          deployment.userId,
          deployment.status,
          deployment.framework,
          deployment.buildCommand,
          deployment.entryPoint,
          deployment.sourceRepo,
          deployment.branch,
          deployment.commitSha,
          deployment.outputDir,
          deployment.url,
          deployment.deployTimeMs,
          deployment.finishedAt
        ]
      );
      return rows[0];
    }
    this.data.deployments.push(deployment);
    await this.saveFile();
    return deployment;
  }

  async updateDeployment(deploymentId, patch) {
    const data = copyPatch(patch);
    if (this.usingPostgres) {
      const entries = Object.entries(data);
      const sets = entries.map(([key], index) => `${decamel(key)} = $${index + 2}`);
      const rows = await this.query(`UPDATE deployments SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, [
        deploymentId,
        ...entries.map(([, value]) => value)
      ]);
      return rows[0] || null;
    }
    const deployment = await this.findDeploymentById(deploymentId);
    if (!deployment) return null;
    Object.assign(deployment, data);
    await this.saveFile();
    return deployment;
  }

  async findDeploymentById(deploymentId) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM deployments WHERE id = $1", [deploymentId]);
      return rows[0] || null;
    }
    return this.data.deployments.find((deployment) => deployment.id === deploymentId) || null;
  }

  async latestDeployment(projectId) {
    if (this.usingPostgres) {
      const rows = await this.query("SELECT * FROM deployments WHERE project_id = $1 ORDER BY started_at DESC LIMIT 1", [projectId]);
      return rows[0] || null;
    }
    return this.data.deployments
      .filter((deployment) => deployment.projectId === projectId)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
  }

  async listDeployments({ projectId, limit = 10 } = {}) {
    if (this.usingPostgres) {
      const clauses = [];
      const params = [];
      if (projectId) {
        params.push(projectId);
        clauses.push(`project_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit);
      return this.query(`SELECT * FROM deployments ${where} ORDER BY started_at DESC LIMIT $${params.length}`, params);
    }
    let deployments = [...this.data.deployments];
    if (projectId) deployments = deployments.filter((deployment) => deployment.projectId === projectId);
    return deployments.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
  }

  async addDeployLog(input) {
    const log = {
      id: id(),
      deploymentId: input.deploymentId || null,
      projectId: input.projectId || null,
      userId: input.userId || null,
      level: input.level || "info",
      message: input.message,
      createdAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        "INSERT INTO deploy_logs (id, deployment_id, project_id, user_id, level, message, line) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *",
        [log.id, log.deploymentId, log.projectId, log.userId, log.level, log.message]
      );
      return rows[0];
    }
    this.data.deployLogs.push(log);
    await this.saveFile();
    return log;
  }

  async listDeployLogs({ deploymentId, projectId, limit = 200 } = {}) {
    if (this.usingPostgres) {
      const clauses = [];
      const params = [];
      if (deploymentId) {
        params.push(deploymentId);
        clauses.push(`deployment_id = $${params.length}`);
      }
      if (projectId) {
        params.push(projectId);
        clauses.push(`project_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit);
      return this.query(`SELECT * FROM deploy_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    }
    let logs = [...this.data.deployLogs];
    if (deploymentId) logs = logs.filter((log) => log.deploymentId === deploymentId);
    if (projectId) logs = logs.filter((log) => log.projectId === projectId);
    return logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  async createNotification(input) {
    const notification = {
      id: id(),
      title: input.title,
      message: input.message,
      audience: input.audience || "all",
      createdBy: input.createdBy || null,
      createdAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        "INSERT INTO notifications (id, title, message, audience, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [notification.id, notification.title, notification.message, notification.audience, notification.createdBy]
      );
      return rows[0];
    }
    this.data.notifications.push(notification);
    await this.saveFile();
    return notification;
  }

  async listNotifications(limit = 10) {
    if (this.usingPostgres) {
      return this.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1", [limit]);
    }
    return [...this.data.notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  async createAdminLog(input) {
    const log = {
      id: id(),
      adminId: input.adminId || null,
      action: input.action,
      targetType: input.targetType || "",
      targetId: input.targetId || "",
      ip: input.ip || input.metadata?.ip || "",
      metadata: input.metadata || {},
      createdAt: now()
    };
    if (this.usingPostgres) {
      const rows = await this.query(
        "INSERT INTO admin_logs (id, admin_id, action, target_type, target_id, ip, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [log.id, log.adminId, log.action, log.targetType, log.targetId, log.ip, JSON.stringify(log.metadata)]
      );
      return rows[0];
    }
    this.data.adminLogs.push(log);
    await this.saveFile();
    return log;
  }

  async listAdminLogs(limit = 100) {
    if (this.usingPostgres) {
      return this.query("SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1", [limit]);
    }
    return [...this.data.adminLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  async overview() {
    const users = this.usingPostgres
      ? (await this.query("SELECT COUNT(*)::int AS count FROM users"))[0].count
      : this.data.users.length;
    const deployments = this.usingPostgres
      ? (await this.query("SELECT COUNT(*)::int AS count FROM deployments"))[0].count
      : this.data.deployments.length;
    const activeDeployments = this.usingPostgres
      ? (await this.query("SELECT COUNT(*)::int AS count FROM projects WHERE active = TRUE"))[0].count
      : this.data.projects.filter((project) => project.active).length;
    const failedToday = this.usingPostgres
      ? (await this.query("SELECT COUNT(*)::int AS count FROM deployments WHERE status = 'failed' AND started_at >= CURRENT_DATE"))[0].count
      : this.data.deployments.filter((deployment) => deployment.status === "failed" && String(deployment.startedAt).slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    const deploymentRows = this.usingPostgres
      ? await this.query(
          "SELECT started_at AS created_at FROM deployments WHERE started_at > NOW() - INTERVAL '30 days' ORDER BY started_at ASC"
        )
      : this.data.deployments.map((item) => ({ createdAt: item.startedAt }));
    const userRows = this.usingPostgres
      ? await this.query("SELECT created_at FROM users WHERE created_at > NOW() - INTERVAL '84 days' ORDER BY created_at ASC")
      : this.data.users.map((item) => ({ createdAt: item.createdAt }));
    return {
      users,
      deployments,
      activeDeployments,
      failedToday,
      deploymentsPerDay: bucketByDay(deploymentRows, 30),
      newUsersPerWeek: bucketByWeek(userRows, 12)
    };
  }
}

function bucketByDay(rows, days) {
  const buckets = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    buckets.push({ label: key.slice(5), count: 0, key });
  }
  for (const row of rows) {
    const key = String(row.createdAt || row.created_at || "").slice(0, 10);
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function bucketByWeek(rows, weeks) {
  const buckets = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index * 7);
    const key = `${date.getFullYear()}-W${Math.ceil(((date - new Date(date.getFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
    buckets.push({ label: key.replace(`${date.getFullYear()}-`, ""), count: 0, key });
  }
  for (const row of rows) {
    const date = new Date(row.createdAt || row.created_at);
    const key = `${date.getFullYear()}-W${Math.ceil(((date - new Date(date.getFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

module.exports = { LaunchPadStore, defaultSettings, normalizeEmail };
