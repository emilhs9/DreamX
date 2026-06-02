const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { config, ensureDir } = require("./config");

const runningProcesses = new Map();
const githubUrlPattern = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const gitlabUrlPattern = /^https:\/\/gitlab\.com\/(.+?)(?:\.git)?\/?$/;
const supportedSourceProviders = new Set(["github", "gitlab"]);

function slugify(value) {
  const base = String(value || "site")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 46);
  return base || `site-${shortId()}`;
}

function shortId(length = 6) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectUrl(slug) {
  if (config.publicDomain) {
    return `https://${slug}.${config.publicDomain}`;
  }
  return `${config.baseUrl}/preview/${slug}/`;
}

function productionProjectUrl(slug) {
  if (config.publicDomain) {
    return `https://${slug}.${config.publicDomain}`;
  }
  return "";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRm(target) {
  if (!target) return;
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
}

async function projectRoot(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  if (visible.length === 1 && visible[0].isDirectory()) {
    const nested = path.join(dir, visible[0].name);
    const nestedFiles = await fs.readdir(nested);
    if (nestedFiles.length) return nested;
  }
  return dir;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function encryptSecret(value) {
  if (!value) return "";
  const key = crypto.createHash("sha256").update(config.jwtRefreshSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value) {
  if (!value) return "";
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return "";
  const key = crypto.createHash("sha256").update(config.jwtRefreshSecret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

function parseGitHubUrl(repoUrl) {
  const match = String(repoUrl || "").trim().match(githubUrlPattern);
  if (!match) throw new Error("Enter a valid GitHub repository URL like https://github.com/owner/repo.");
  return { provider: "github", owner: match[1], repo: match[2].replace(/\.git$/i, ""), fullPath: `${match[1]}/${match[2].replace(/\.git$/i, "")}`, normalizedUrl: `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`, gitUsername: "x-access-token" };
}

function parseGitLabUrl(repoUrl) {
  const match = String(repoUrl || "").trim().match(gitlabUrlPattern);
  if (!match) throw new Error("Enter a valid GitLab repository URL like https://gitlab.com/group/project.");
  const fullPath = match[1].replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Enter a valid GitLab repository URL like https://gitlab.com/group/project.");
  const repo = parts[parts.length - 1];
  return { provider: "gitlab", owner: parts.slice(0, -1).join("/"), repo, fullPath, normalizedUrl: `https://gitlab.com/${fullPath}.git`, htmlUrl: `https://gitlab.com/${fullPath}`, gitUsername: "oauth2" };
}

function detectSourceProvider(repoUrl) {
  const value = String(repoUrl || "").trim();
  if (githubUrlPattern.test(value)) return "github";
  if (gitlabUrlPattern.test(value)) return "gitlab";
  return "";
}

function parseRepositoryUrl(repoUrl) {
  const provider = detectSourceProvider(repoUrl);
  if (provider === "github") return parseGitHubUrl(repoUrl);
  if (provider === "gitlab") return parseGitLabUrl(repoUrl);
  throw new Error("Only GitHub and GitLab repository URLs are supported.");
}

function ensureSourceProvider(provider) {
  const value = String(provider || "github").toLowerCase();
  if (!supportedSourceProviders.has(value)) throw new Error("This source provider is not supported yet.");
  return value;
}

async function githubFetch(url, token = "") {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "DreamX-Deploy"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `GitHub request failed with status ${response.status}.`;
    throw new Error(message.includes("Not Found") ? "Repository was not found or the token cannot access it." : message);
  }
  return data;
}

function normalizeGitHubRepo(repo) {
  return {
    owner: repo.owner?.login || "",
    name: repo.name || "",
    fullName: repo.full_name || "",
    url: repo.html_url || "",
    description: repo.description || "",
    language: repo.language || "",
    stars: repo.stargazers_count || 0,
    defaultBranch: repo.default_branch || "main",
    private: Boolean(repo.private),
    visibility: repo.visibility || (repo.private ? "private" : "public"),
    updatedAt: repo.updated_at || "",
    pushedAt: repo.pushed_at || "",
    htmlUrl: repo.html_url || ""
  };
}

async function exchangeGitHubOAuthCode(code) {
  if (!config.githubOAuth.clientId || !config.githubOAuth.clientSecret) {
    throw new Error("GitHub OAuth is not configured.");
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "DreamX-Deploy"
    },
    body: JSON.stringify({
      client_id: config.githubOAuth.clientId,
      client_secret: config.githubOAuth.clientSecret,
      code,
      redirect_uri: config.githubOAuth.callbackUrl
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub OAuth failed.");
  }
  const user = await githubFetch("https://api.github.com/user", data.access_token);
  return {
    accessToken: data.access_token,
    scope: data.scope || "",
    user: {
      login: user.login || "",
      name: user.name || "",
      avatarUrl: user.avatar_url || "",
      htmlUrl: user.html_url || ""
    }
  };
}

async function gitlabFetch(url, token = "") {
  const headers = {
    Accept: "application/json",
    "User-Agent": "DreamX-Deploy"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error_description || `GitLab request failed with status ${response.status}.`;
    throw new Error(typeof message === "string" ? message : "GitLab request failed.");
  }
  return data;
}

function normalizeGitLabRepo(project) {
  const fullName = project.path_with_namespace || project.name_with_namespace || "";
  return {
    provider: "gitlab",
    owner: project.namespace?.full_path || fullName.split("/").slice(0, -1).join("/"),
    name: project.path || project.name || "",
    fullName,
    url: project.http_url_to_repo || `${project.web_url}.git`,
    htmlUrl: project.web_url || "",
    description: project.description || "",
    language: "",
    stars: project.star_count || 0,
    defaultBranch: project.default_branch || "main",
    private: project.visibility !== "public",
    visibility: project.visibility || "private",
    updatedAt: project.last_activity_at || "",
    pushedAt: project.last_activity_at || ""
  };
}

async function exchangeGitLabOAuthCode(code) {
  if (!config.gitlabOAuth.clientId || !config.gitlabOAuth.clientSecret) {
    throw new Error("GitLab OAuth is not configured.");
  }
  const body = new URLSearchParams({
    client_id: config.gitlabOAuth.clientId,
    client_secret: config.gitlabOAuth.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.gitlabOAuth.callbackUrl
  });
  const response = await fetch("https://gitlab.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "DreamX-Deploy"
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "GitLab OAuth failed.");
  }
  const user = await gitlabFetch("https://gitlab.com/api/v4/user", data.access_token);
  return {
    accessToken: data.access_token,
    scope: data.scope || "",
    user: {
      login: user.username || "",
      name: user.name || "",
      avatarUrl: user.avatar_url || "",
      htmlUrl: user.web_url || ""
    }
  };
}

async function githubContent(owner, repo, filePath, branch, token = "") {
  const encoded = filePath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return githubFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`, token);
}

function encodeGitLabProjectId(fullPath) {
  return encodeURIComponent(fullPath);
}

function encodeGitLabFilePath(filePath) {
  return encodeURIComponent(filePath).replace(/\./g, "%2E");
}

async function gitlabTree(fullPath, rootDir, branch, token = "") {
  const url = new URL(`https://gitlab.com/api/v4/projects/${encodeGitLabProjectId(fullPath)}/repository/tree`);
  url.searchParams.set("ref", branch);
  url.searchParams.set("per_page", "100");
  if (rootDir) url.searchParams.set("path", rootDir);
  return gitlabFetch(url.toString(), token);
}

async function gitlabRawFile(fullPath, filePath, branch, token = "") {
  const encodedFile = encodeGitLabFilePath(filePath);
  const url = `https://gitlab.com/api/v4/projects/${encodeGitLabProjectId(fullPath)}/repository/files/${encodedFile}/raw?ref=${encodeURIComponent(branch)}`;
  const headers = { "User-Agent": "DreamX-Deploy" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitLab file request failed with status ${response.status}.`);
  return response.text();
}

function decodeGitHubFile(file) {
  if (!file || file.type !== "file" || !file.content) return "";
  return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

function detectFromFiles(files, packageJson = null) {
  const fileSet = new Set(files);
  const scripts = packageJson?.scripts || {};
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const buildScript = scripts.build || "";
  const hasPackage = Boolean(packageJson);

  if (fileSet.has("next.config.js") || fileSet.has("next.config.mjs") || deps.next) {
    return { framework: "Next.js", packageManager: "npm", buildCommand: scripts.build ? "npm run build" : "npm run build", outputDir: ".next", entryPoint: "next.config.js", supportsStaticDeploy: false, supportsNodeRuntime: true };
  }
  if (fileSet.has("nuxt.config.js") || fileSet.has("nuxt.config.ts") || deps.nuxt) {
    return { framework: "Nuxt.js", packageManager: "npm", buildCommand: scripts.generate ? "npm run generate" : "npm run build", outputDir: "dist", entryPoint: "nuxt.config.js", supportsStaticDeploy: true, supportsNodeRuntime: true };
  }
  if (buildScript.includes("vite") || fileSet.has("vite.config.js") || fileSet.has("vite.config.ts")) {
    return { framework: deps.vue ? "Vue" : deps.react ? "React / Vite" : "Vite", packageManager: "npm", buildCommand: "npm run build", outputDir: "dist", entryPoint: "package.json", supportsStaticDeploy: true, supportsNodeRuntime: false };
  }
  if (deps.react) {
    return { framework: "React", packageManager: "npm", buildCommand: scripts.build ? "npm run build" : "", outputDir: fileSet.has("build") ? "build" : "dist", entryPoint: "package.json", supportsStaticDeploy: true, supportsNodeRuntime: false };
  }
  if (deps.vue) {
    return { framework: "Vue", packageManager: "npm", buildCommand: scripts.build ? "npm run build" : "", outputDir: "dist", entryPoint: "package.json", supportsStaticDeploy: true, supportsNodeRuntime: false };
  }
  if (hasPackage && packageJson.main && !scripts.build) {
    return { framework: "Node.js", packageManager: "npm", buildCommand: "npm install", outputDir: ".", entryPoint: packageJson.main || "server.js", supportsStaticDeploy: false, supportsNodeRuntime: true };
  }
  if (fileSet.has("index.html") && !hasPackage) {
    return { framework: "Static HTML", packageManager: "none", buildCommand: "", outputDir: ".", entryPoint: "index.html", supportsStaticDeploy: true, supportsNodeRuntime: false };
  }
  if (hasPackage && scripts.build) {
    return { framework: "JavaScript", packageManager: "npm", buildCommand: "npm run build", outputDir: "dist", entryPoint: "package.json", supportsStaticDeploy: true, supportsNodeRuntime: false };
  }
  return { framework: fileSet.has("index.html") ? "Static HTML" : "Unknown", packageManager: hasPackage ? "npm" : "none", buildCommand: "", outputDir: fileSet.has("public") ? "public" : ".", entryPoint: fileSet.has("index.html") ? "index.html" : "", supportsStaticDeploy: fileSet.has("index.html"), supportsNodeRuntime: false };
}

async function detectPackageManager(root) {
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return { manager: "pnpm", install: "pnpm install --frozen-lockfile" };
  if (await exists(path.join(root, "yarn.lock"))) return { manager: "yarn", install: "yarn install --frozen-lockfile" };
  if (await exists(path.join(root, "package-lock.json"))) return { manager: "npm", install: "npm ci" };
  if (await exists(path.join(root, "package.json"))) return { manager: "npm", install: "npm install" };
  return { manager: "none", install: "" };
}

function safeRootDir(rootDir = "") {
  const normalized = path.normalize(String(rootDir || "").trim()).replace(/\\/g, "/");
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) throw new Error("Root directory is unsafe.");
  return normalized.replace(/^\/+|\/+$/g, "");
}

function envArrayToObject(rows = []) {
  const env = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Environment variable "${key}" is invalid.`);
    env[key] = String(row?.value || "");
  }
  return env;
}

function redactRemote(remoteUrl) {
  return String(remoteUrl || "").replace(/https:\/\/[^@]+@/i, "https://***@");
}

function spawnArgs(command, args, cwd, onData, timeoutMs, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32", env: { ...process.env, ...env, CI: "true", GIT_TERMINAL_PROMPT: "0" } });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => onData("info", chunk.toString()));
    child.stderr.on("data", (chunk) => onData("warn", chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function captureArgs(command, args, cwd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
    });
  });
}

async function spawnGitHead(cwd) {
  const sha = await captureArgs("git", ["rev-parse", "HEAD"], cwd);
  const message = await captureArgs("git", ["log", "-1", "--pretty=%s"], cwd).catch(() => "");
  return { sha, message };
}

async function analyzeDirectory(dir) {
  const root = await projectRoot(dir);
  const packageJson = await readJson(path.join(root, "package.json"));
  const hasIndex = await exists(path.join(root, "index.html"));
  const hasServer = await exists(path.join(root, "server.js"));
  const scripts = packageJson?.scripts || {};
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };

  let framework = "Static HTML";
  if (deps.next) framework = "Next.js";
  else if (deps.react || deps["@vitejs/plugin-react"]) framework = "React";
  else if (deps.vue || deps["@vitejs/plugin-vue"]) framework = "Vue";
  else if (deps.svelte) framework = "Svelte";
  else if (hasServer) framework = "Node.js";

  let buildCommand = "";
  if (scripts.build) buildCommand = "npm run build";
  else if (scripts["build:prod"]) buildCommand = "npm run build:prod";

  const outputCandidates = ["dist", "build", "public", "."];
  let outputDir = ".";
  for (const candidate of outputCandidates) {
    if (candidate === "." && hasIndex) {
      outputDir = ".";
      break;
    }
    if (await exists(path.join(root, candidate, "index.html"))) {
      outputDir = candidate;
      break;
    }
  }

  let entryPoint = hasIndex ? "index.html" : "";
  if (!entryPoint && hasServer) entryPoint = "server.js";
  if (!entryPoint && packageJson?.main) entryPoint = packageJson.main;

  return {
    framework,
    packageManager: packageJson ? "npm" : "none",
    buildCommand,
    entryPoint,
    outputDir,
    hasPackageJson: Boolean(packageJson),
    supportsStaticDeploy: hasIndex || Boolean(buildCommand),
    supportsNodeRuntime: hasServer,
    root
  };
}

function spawnCommand(command, cwd, onData, timeoutMs, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, ...env, CI: "true" } });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Build timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => onData("info", chunk.toString()));
    child.stderr.on("data", (chunk) => onData("warn", chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

class Deployer {
  constructor(store) {
    this.store = store;
    this.socketHub = null;
  }

  attachSocketHub(socketHub) {
    this.socketHub = socketHub;
  }

  async log(deployment, level, message) {
    const clean = String(message || "").trim();
    if (!clean) return;
    const lines = clean.split(/\r?\n/).filter(Boolean).slice(0, 20);
    for (const line of lines) {
      const entry = await this.store.addDeployLog({
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        userId: deployment.userId,
        level,
        message: line.slice(0, 2000)
      });
      this.socketHub?.emitDeployLog(deployment.id, entry);
    }
  }

  async analyzeGitHubRepo({ repoUrl, branch = "", rootDir = "", githubToken = "" }) {
    const parsed = parseGitHubUrl(repoUrl);
    const repo = await githubFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, githubToken);
    const selectedBranch = branch || repo.default_branch || "main";
    const branchInfo = await githubFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches/${encodeURIComponent(selectedBranch)}`, githubToken);
    const branches = await githubFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`, githubToken);
    const safeRoot = safeRootDir(rootDir);
    const contents = await githubContent(parsed.owner, parsed.repo, safeRoot, selectedBranch, githubToken);
    const entries = Array.isArray(contents) ? contents : [contents];
    const files = entries.map((entry) => entry.name);
    let packageJson = null;
    if (files.includes("package.json")) {
      const packageFile = await githubContent(parsed.owner, parsed.repo, [safeRoot, "package.json"].filter(Boolean).join("/"), selectedBranch, githubToken);
      packageJson = JSON.parse(decodeGitHubFile(packageFile));
    }
    const analysis = detectFromFiles(files, packageJson);
    const lastCommit = branchInfo.commit || {};
    const commitData = await githubFetch(lastCommit.url || `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(selectedBranch)}`, githubToken);
    return {
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        fullName: repo.full_name,
        url: parsed.normalizedUrl,
        description: repo.description || "",
        language: repo.language || "",
        stars: repo.stargazers_count || 0,
        defaultBranch: repo.default_branch || "main",
        private: Boolean(repo.private),
        lastCommitSha: commitData.sha || lastCommit.sha || "",
        lastCommitMessage: commitData.commit?.message || "",
        lastCommitDate: commitData.commit?.committer?.date || "",
        htmlUrl: repo.html_url
      },
      branches: branches.map((item) => item.name),
      analysis: {
        ...analysis,
        branch: selectedBranch,
        rootDir: safeRoot,
        files
      }
    };
  }

  async analyzeGitLabRepo({ repoUrl, branch = "", rootDir = "", githubToken = "" }) {
    const parsed = parseGitLabUrl(repoUrl);
    const projectId = encodeGitLabProjectId(parsed.fullPath);
    const repo = await gitlabFetch(`https://gitlab.com/api/v4/projects/${projectId}`, githubToken);
    const selectedBranch = branch || repo.default_branch || "main";
    const branches = await gitlabFetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?per_page=100`, githubToken);
    const branchInfo = branches.find((item) => item.name === selectedBranch) || branches[0] || {};
    const safeRoot = safeRootDir(rootDir);
    const contents = await gitlabTree(parsed.fullPath, safeRoot, selectedBranch, githubToken);
    const files = contents.map((entry) => entry.name);
    let packageJson = null;
    if (files.includes("package.json")) {
      const packagePath = [safeRoot, "package.json"].filter(Boolean).join("/");
      packageJson = JSON.parse(await gitlabRawFile(parsed.fullPath, packagePath, selectedBranch, githubToken));
    }
    const analysis = detectFromFiles(files, packageJson);
    const commit = branchInfo.commit || {};
    return {
      repo: {
        provider: "gitlab",
        owner: parsed.owner,
        name: parsed.repo,
        fullName: repo.path_with_namespace || parsed.fullPath,
        url: repo.http_url_to_repo || parsed.normalizedUrl,
        htmlUrl: repo.web_url || parsed.htmlUrl,
        description: repo.description || "",
        language: "",
        stars: repo.star_count || 0,
        defaultBranch: repo.default_branch || "main",
        private: repo.visibility !== "public",
        visibility: repo.visibility || "private",
        lastCommitSha: commit.id || commit.short_id || "",
        lastCommitMessage: commit.title || commit.message || "",
        lastCommitDate: commit.committed_date || ""
      },
      branches: branches.map((item) => item.name),
      analysis: {
        ...analysis,
        branch: selectedBranch,
        rootDir: safeRoot,
        files
      }
    };
  }

  async analyzeRepository(input) {
    const provider = detectSourceProvider(input.repoUrl);
    if (provider === "gitlab") return this.analyzeGitLabRepo(input);
    return this.analyzeGitHubRepo(input);
  }

  async listRepositories({ provider = "github", accessToken = "", search = "" }) {
    const source = ensureSourceProvider(provider);
    if (source === "gitlab") return this.listGitLabRepositories({ gitlabToken: accessToken, search });
    return this.listGitHubRepositories({ githubToken: accessToken, search });
  }

  async listGitHubRepositories({ githubToken = "", search = "" }) {
    if (!githubToken) throw new Error("GitHub is not connected.");
    const user = await githubFetch("https://api.github.com/user", githubToken);
    const repositories = [];
    for (let page = 1; page <= 3; page += 1) {
      const pageItems = await githubFetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        githubToken
      );
      repositories.push(...pageItems);
      if (!Array.isArray(pageItems) || pageItems.length < 100) break;
    }
    const query = String(search || "").trim().toLowerCase();
    const normalized = repositories
      .map(normalizeGitHubRepo)
      .filter((repo) => !query || repo.fullName.toLowerCase().includes(query) || repo.description.toLowerCase().includes(query));
    return {
      user: {
        login: user.login || "",
        name: user.name || "",
        avatarUrl: user.avatar_url || "",
        htmlUrl: user.html_url || ""
      },
      repositories: normalized
    };
  }

  async listGitLabRepositories({ gitlabToken = "", search = "" }) {
    if (!gitlabToken) throw new Error("GitLab is not connected.");
    const user = await gitlabFetch("https://gitlab.com/api/v4/user", gitlabToken);
    const repositories = [];
    for (let page = 1; page <= 3; page += 1) {
      const url = new URL("https://gitlab.com/api/v4/projects");
      url.searchParams.set("membership", "true");
      url.searchParams.set("simple", "true");
      url.searchParams.set("order_by", "last_activity_at");
      url.searchParams.set("sort", "desc");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const pageItems = await gitlabFetch(url.toString(), gitlabToken);
      repositories.push(...pageItems);
      if (!Array.isArray(pageItems) || pageItems.length < 100) break;
    }
    const query = String(search || "").trim().toLowerCase();
    const normalized = repositories
      .map(normalizeGitLabRepo)
      .filter((repo) => !query || repo.fullName.toLowerCase().includes(query) || repo.description.toLowerCase().includes(query));
    return {
      user: {
        login: user.username || "",
        name: user.name || "",
        avatarUrl: user.avatar_url || "",
        htmlUrl: user.web_url || ""
      },
      repositories: normalized
    };
  }

  async listGitHubBranches({ repoUrl, githubToken = "" }) {
    const parsed = parseGitHubUrl(repoUrl);
    const branches = await githubFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`, githubToken);
    return { branches: branches.map((item) => item.name) };
  }

  async listGitLabBranches({ repoUrl, gitlabToken = "" }) {
    const parsed = parseGitLabUrl(repoUrl);
    const branches = await gitlabFetch(`https://gitlab.com/api/v4/projects/${encodeGitLabProjectId(parsed.fullPath)}/repository/branches?per_page=100`, gitlabToken);
    return { branches: branches.map((item) => item.name) };
  }

  async listBranches({ provider = "", repoUrl, accessToken = "" }) {
    const source = provider ? ensureSourceProvider(provider) : detectSourceProvider(repoUrl);
    if (source === "gitlab") return this.listGitLabBranches({ repoUrl, gitlabToken: accessToken });
    return this.listGitHubBranches({ repoUrl, githubToken: accessToken });
  }

  async deployGitHub({ user, repoUrl, branch = "main", name = "", customDomain = "", buildCommand = "", outputDir = "", rootDir = "", envVars = [], githubToken = "" }) {
    const settings = await this.store.settings();
    const activeCount = await this.store.activeProjectCount(user.id);
    if (activeCount >= Number(settings.deploymentLimit || 3)) {
      throw new Error(`Project limit reached. Your account allows ${settings.deploymentLimit || 3} active deployments.`);
    }
    const metadata = await this.analyzeRepository({ repoUrl, branch, rootDir, githubToken });
    const projectName = name || metadata.repo.name;
    let slug = slugify(projectName);
    while (await this.store.findProjectBySlug(slug)) slug = `${slugify(projectName)}-${shortId(5)}`;
    const deployPath = path.join(config.paths.deployments, slug);
    const webhookSecret = crypto.randomBytes(24).toString("base64url");
    const project = await this.store.createProject({
      userId: user.id,
      name: projectName,
      slug,
      customDomain,
      status: "building",
      url: projectUrl(slug),
      deployPath,
      sourceType: metadata.repo.provider || detectSourceProvider(repoUrl) || "github",
      repoUrl: metadata.repo.url,
      repoOwner: metadata.repo.owner,
      repoName: metadata.repo.name,
      branch: metadata.analysis.branch,
      rootDir: metadata.analysis.rootDir,
      githubTokenEncrypted: encryptSecret(githubToken),
      githubWebhookSecret: webhookSecret,
      envVars,
      framework: metadata.analysis.framework,
      entryPoint: metadata.analysis.entryPoint,
      buildCommand: buildCommand ?? metadata.analysis.buildCommand,
      outputDir: outputDir || metadata.analysis.outputDir,
      lastCommitSha: metadata.repo.lastCommitSha,
      lastCommitMessage: metadata.repo.lastCommitMessage,
      repoMeta: metadata.repo
    });
    return this.deployExistingProject(project, { user, buildCommand: buildCommand || metadata.analysis.buildCommand, outputDir: outputDir || metadata.analysis.outputDir, envVars, githubToken, isInitialDeploy: true });
  }

  async deployExistingProject(project, { user = null, buildCommand, outputDir, envVars, githubToken = "", commitSha = "", isInitialDeploy = false } = {}) {
    if (!project?.repoUrl) throw new Error("This project is not connected to a GitHub repository.");
    const settings = await this.store.settings();
    const started = Date.now();
    const deployment = await this.store.createDeployment({
      projectId: project.id,
      userId: user?.id || project.userId,
      status: "building",
      framework: project.framework,
      buildCommand: buildCommand ?? project.buildCommand,
      entryPoint: project.entryPoint,
      sourceRepo: project.repoUrl,
      branch: project.branch,
      commitSha: commitSha || project.lastCommitSha || "",
      url: project.url
    });
    const sourceDir = path.join(config.paths.builds, deployment.id);
    const cloneDir = path.join(sourceDir, "repo");
    const token = githubToken || decryptSecret(project.githubTokenEncrypted);
    const parsed = parseRepositoryUrl(project.repoUrl);
    const timeoutMs = Number(settings.maxBuildTimeSeconds || 120) * 1000;
    const safeRoot = safeRootDir(project.rootDir || "");
    const envObject = envArrayToObject(envVars || project.envVars || []);

    try {
      await this.store.updateProject(project.id, { status: "building", active: true });
      await this.log(deployment, "info", `Cloning ${parsed.fullPath || `${parsed.owner}/${parsed.repo}`} (${project.branch || "main"})...`);
      await ensureDir(sourceDir);
      const askpass = path.join(sourceDir, process.platform === "win32" ? "git-askpass.cmd" : "git-askpass.sh");
      if (token) {
        if (process.platform === "win32") {
          await fs.writeFile(askpass, "@echo off\r\necho %1 | findstr /I \"Username\" >nul\r\nif %errorlevel%==0 (\r\n  echo %GIT_USERNAME%\r\n) else (\r\n  echo %GIT_ACCESS_TOKEN%\r\n)\r\n");
        } else {
          await fs.writeFile(askpass, "#!/bin/sh\ncase \"$1\" in\n  *Username*) echo \"$GIT_USERNAME\" ;;\n  *) echo \"$GIT_ACCESS_TOKEN\" ;;\nesac\n");
          await fs.chmod(askpass, 0o700);
        }
      }
      const gitEnv = token ? { GIT_ASKPASS: askpass, GIT_ACCESS_TOKEN: token, GIT_USERNAME: parsed.gitUsername || "x-access-token" } : {};
      await spawnArgs("git", ["clone", "--depth=1", "--branch", project.branch || "main", project.repoUrl, cloneDir], sourceDir, (level, data) => this.log(deployment, level, redactRemote(data)), timeoutMs, gitEnv);
      if (commitSha) {
        await this.log(deployment, "info", `Checking out commit ${commitSha.slice(0, 12)}...`);
        await spawnArgs("git", ["checkout", commitSha], cloneDir, (level, data) => this.log(deployment, level, data), timeoutMs, gitEnv);
      }
      const buildRoot = path.resolve(cloneDir, safeRoot);
      if (!isInside(cloneDir, buildRoot)) throw new Error("Root directory resolved outside the cloned repository.");
      const analysis = await analyzeDirectory(buildRoot);
      const finalBuildCommand = buildCommand ?? project.buildCommand ?? analysis.buildCommand;
      const finalOutputDir = outputDir || project.outputDir || analysis.outputDir || ".";
      await this.store.updateProject(project.id, {
        framework: analysis.framework,
        entryPoint: analysis.entryPoint,
        buildCommand: finalBuildCommand,
        outputDir: finalOutputDir
      });
      await this.store.updateDeployment(deployment.id, {
        framework: analysis.framework,
        entryPoint: analysis.entryPoint,
        buildCommand: finalBuildCommand,
        outputDir: finalOutputDir
      });
      await this.log(deployment, "info", `Detected ${analysis.framework}.`);

      let finalOutput = buildRoot;
      const packageManager = await detectPackageManager(buildRoot);
      if (packageManager.install && finalBuildCommand !== "npm install") {
        await this.log(deployment, "info", `Installing dependencies with ${packageManager.manager}...`);
        await spawnCommand(packageManager.install, buildRoot, (level, data) => this.log(deployment, level, data), timeoutMs, envObject);
      }
      if (finalBuildCommand) {
        await this.log(deployment, "info", `Running ${finalBuildCommand}...`);
        await spawnCommand(finalBuildCommand, buildRoot, (level, data) => this.log(deployment, level, data), timeoutMs, envObject);
        finalOutput = path.resolve(buildRoot, finalOutputDir === "." ? "" : finalOutputDir);
      }
      if (!isInside(buildRoot, finalOutput)) throw new Error("Output directory resolved outside the project root.");

      if (analysis.framework === "Node.js" && config.enableNodeRuntime) {
        await this.startNodeRuntime(project, buildRoot, deployment);
      } else {
        if (!(await exists(path.join(finalOutput, "index.html")))) {
          throw new Error(`${analysis.framework} did not produce an index.html in ${finalOutputDir}. Set a static output directory or enable a Node runtime.`);
        }
        await fs.rm(project.deployPath, { recursive: true, force: true });
        await fs.cp(finalOutput, project.deployPath, { recursive: true });
      }

      const head = await spawnGitHead(cloneDir).catch(() => ({ sha: commitSha || "", message: "" }));
      const deployTimeMs = Date.now() - started;
      await this.store.updateDeployment(deployment.id, {
        status: "live",
        commitSha: head.sha || commitSha || project.lastCommitSha,
        outputDir: project.deployPath,
        deployTimeMs,
        finishedAt: nowIso()
      });
      const updatedProject = await this.store.updateProject(project.id, {
        status: "live",
        active: true,
        deployPath: project.deployPath,
        lastCommitSha: head.sha || commitSha || project.lastCommitSha,
        lastCommitMessage: head.message || project.lastCommitMessage
      });
      await this.log(deployment, "info", `Deployment live at ${project.url}`);
      await safeRm(sourceDir);
      return { project: updatedProject, deployment: await this.store.findDeploymentById(deployment.id), webhookSecret: isInitialDeploy ? project.githubWebhookSecret : undefined };
    } catch (error) {
      await this.log(deployment, "error", error.message);
      await this.store.updateDeployment(deployment.id, { status: "failed", errorMessage: error.message, finishedAt: nowIso() });
      await this.store.updateProject(project.id, { status: "failed", active: false });
      await safeRm(sourceDir);
      throw error;
    }
  }

  async startNodeRuntime(project, cwd, deployment) {
    const port = 4100 + Math.floor(Math.random() * 2000);
    await this.log(deployment, "info", `Starting Node runtime on internal port ${port}.`);
    const child = spawn("node server.js", {
      cwd,
      shell: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
      detached: false
    });
    runningProcesses.set(project.id, child);
    child.stdout.on("data", (chunk) => this.log(deployment, "info", chunk.toString()));
    child.stderr.on("data", (chunk) => this.log(deployment, "warn", chunk.toString()));
    child.on("close", (code) => this.log(deployment, "warn", `Runtime stopped with code ${code}.`));
    await this.store.updateProject(project.id, { runtimePort: port, deployPath: cwd });
  }
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  Deployer,
  slugify,
  projectUrl,
  productionProjectUrl,
  analyzeDirectory,
  parseGitHubUrl,
  parseGitLabUrl,
  parseRepositoryUrl,
  detectSourceProvider,
  runningProcesses,
  encryptSecret,
  decryptSecret,
  exchangeGitHubOAuthCode,
  exchangeGitLabOAuthCode
};
