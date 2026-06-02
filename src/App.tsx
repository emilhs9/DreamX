import { Component, ErrorInfo, createContext, FormEvent, lazy, ReactNode, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { io } from "socket.io-client";
import { useTranslation } from "react-i18next";
import i18n, { languages, rtlLanguages } from "./i18n";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  Code2,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeOff,
  FileArchive,
  Globe2,
  HardDrive,
  LayoutDashboard,
  ListFilter,
  Lock,
  LogOut,
  Mail,
  Menu,
  Moon,
  Play,
  RefreshCcw,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  SquareTerminal,
  StopCircle,
  Sun,
  Trash2,
  Upload,
  User,
  Users,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
const BRAND_NAME = "DreamX";
const entranceVideo = "/videos/launchpad-main.mp4";
const consoleVideo = "/videos/launchpad-console.mp4";
const ChartLine = lazy(() => import("./Charts").then((module) => ({ default: module.ChartLine })));
const ChartBar = lazy(() => import("./Charts").then((module) => ({ default: module.ChartBar })));

type Role = "admin" | "user";

type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: Role;
  plan?: string;
  banned?: boolean;
  emailVerified?: boolean;
  createdAt?: string;
  projectsCount?: number;
};

type Project = {
  id: string;
  userId?: string;
  name: string;
  slug: string;
  customDomain?: string;
  framework?: string;
  entryPoint?: string;
  buildCommand?: string;
  status: string;
  active?: boolean;
  url?: string;
  previewUrl?: string;
  productionUrl?: string;
  deployPath?: string;
  sourceType?: string;
  repoUrl?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  rootDir?: string;
  outputDir?: string;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  repoMeta?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  userEmail?: string;
  userName?: string;
};

type Deployment = {
  id: string;
  projectId: string;
  status: string;
  framework?: string;
  buildCommand?: string;
  entryPoint?: string;
  outputDir?: string;
  sourceRepo?: string;
  branch?: string;
  commitSha?: string;
  url?: string;
  deployTimeMs?: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
};

type LogEntry = {
  id?: string;
  level: "info" | "warn" | "error" | string;
  message?: string;
  line?: string;
  createdAt?: string;
  timestamp?: string;
};

type AdminLog = {
  id: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  createdAt?: string;
};

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  audience?: string;
  createdAt?: string;
};

type Analysis = {
  framework: string;
  packageManager?: string;
  buildCommand?: string;
  entryPoint?: string;
  outputDir?: string;
  rootDir?: string;
  branch?: string;
  files?: string[];
  supportsStaticDeploy?: boolean;
  supportsNodeRuntime?: boolean;
};

type GitHubRepoInfo = {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description?: string;
  language?: string;
  stars?: number;
  defaultBranch?: string;
  private?: boolean;
  visibility?: string;
  updatedAt?: string;
  pushedAt?: string;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  lastCommitDate?: string;
};

type GitHubConnectedUser = {
  login: string;
  name?: string;
  avatarUrl?: string;
  htmlUrl?: string;
};

type SourceProvider = "github" | "gitlab";

const sourceProviders: { id: SourceProvider; name: string; descriptionKey: string }[] = [
  // Sir, Emil: keep provider metadata small so deploy controls stay cheap to render.
  { id: "github", name: "GitHub", descriptionKey: "deploy.providers.github" },
  { id: "gitlab", name: "GitLab", descriptionKey: "deploy.providers.gitlab" }
];

type ApiOptions = RequestInit & { admin?: boolean };

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = options.admin ? localStorage.getItem("lp_admin_access") : localStorage.getItem("lp_access");
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  headers["Accept-Language"] = i18n.resolvedLanguage || i18n.language || localStorage.getItem("dreamx_lang") || "en";
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = document.cookie
    .split("; ")
    .find((item) => item.startsWith("lp_csrf="))
    ?.split("=")[1];
  const method = String(options.method || "GET").toUpperCase();
  if (csrf && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers["X-CSRF-Token"] = decodeURIComponent(csrf);

  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error || "Request failed") as Error & { retryAfterSeconds?: number; status?: number };
    error.retryAfterSeconds = data.retryAfterSeconds;
    error.status = response.status;
    throw error;
  }
  return data as T;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type CosmicStar = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
  twinkle: number;
  speedX: number;
  speedY: number;
  parallax: number;
  glow: number;
  hue: number;
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
  alpha: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function CosmicBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const canvasElement: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = context;

    const stars: CosmicStar[] = [];
    const shootingStars: ShootingStar[] = [];
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastTime = performance.now();
    let nextShootingStar = lastTime + 2200 + Math.random() * 4200;

    const random = (min: number, max: number) => min + Math.random() * (max - min);

    function createStar(layer: "back" | "middle" | "front"): CosmicStar {
      const front = layer === "front";
      const middle = layer === "middle";
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: front ? random(1.35, 2.9) : middle ? random(0.85, 1.7) : random(0.35, 0.95),
        alpha: front ? random(0.45, 0.9) : middle ? random(0.28, 0.72) : random(0.12, 0.48),
        phase: Math.random() * Math.PI * 2,
        twinkle: front ? random(0.0012, 0.0026) : middle ? random(0.001, 0.002) : random(0.0006, 0.0015),
        speedX: front ? random(-4, 4) : middle ? random(-2.4, 2.4) : random(-1.1, 1.1),
        speedY: front ? random(10, 22) : middle ? random(4, 11) : random(1.2, 4.2),
        parallax: front ? random(14, 24) : middle ? random(7, 13) : random(2, 5),
        glow: front ? random(7, 14) : middle ? random(3, 7) : 0,
        hue: front ? random(208, 222) : middle ? random(205, 226) : random(208, 238)
      };
    }

    function seedStars() {
      stars.length = 0;
      const area = width * height;
      const tinyCount = Math.round(clampNumber(area / 1350, 420, 2200));
      const middleCount = Math.round(clampNumber(area / 13000, 70, 260));
      const frontCount = Math.round(clampNumber(area / 60000, 14, 58));

      for (let index = 0; index < tinyCount; index += 1) stars.push(createStar("back"));
      for (let index = 0; index < middleCount; index += 1) stars.push(createStar("middle"));
      for (let index = 0; index < frontCount; index += 1) stars.push(createStar("front"));
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvasElement.width = Math.floor(width * dpr);
      canvasElement.height = Math.floor(height * dpr);
      canvasElement.style.width = `${width}px`;
      canvasElement.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars();
    }

    function drawAmbient(time: number) {
      const base = ctx.createLinearGradient(0, 0, width, height);
      base.addColorStop(0, "#020617");
      base.addColorStop(0.34, "#0B1120");
      base.addColorStop(0.68, "#020617");
      base.addColorStop(1, "#000000");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);

      const drift = Math.sin(time * 0.00008) * 34;
      const glows = [
        { x: width * 0.16 + pointer.x * 0.8, y: height * 0.24 + pointer.y * 0.55, radius: Math.min(width, height) * 0.58, alpha: 0.16 },
        { x: width * 0.82 + pointer.x * 0.45 + drift, y: height * 0.12 + pointer.y * 0.35, radius: Math.min(width, height) * 0.45, alpha: 0.1 },
        { x: width * 0.56 - pointer.x * 0.35, y: height * 0.9 - pointer.y * 0.25, radius: Math.min(width, height) * 0.62, alpha: 0.08 }
      ];

      ctx.globalCompositeOperation = "screen";
      for (const glow of glows) {
        const gradient = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
        gradient.addColorStop(0, `rgba(96, 165, 250, ${glow.alpha})`);
        gradient.addColorStop(0.42, `rgba(30, 41, 59, ${glow.alpha * 0.35})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    function drawStar(star: CosmicStar, time: number, dt: number) {
      if (!reducedMotion.matches) {
        star.x += star.speedX * dt;
        star.y += star.speedY * dt;
      }

      if (star.x > width + 24) star.x = -24;
      if (star.x < -24) star.x = width + 24;
      if (star.y > height + 24) star.y = -24;

      const x = star.x + pointer.x * star.parallax;
      const y = star.y + pointer.y * star.parallax;
      const twinkle = 0.72 + Math.sin(time * star.twinkle + star.phase) * 0.28;
      const alpha = clampNumber(star.alpha * twinkle, 0.05, 0.95);

      if (star.glow > 0) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, star.glow);
        glow.addColorStop(0, `hsla(${star.hue}, 100%, 76%, ${alpha * 0.58})`);
        glow.addColorStop(0.35, `hsla(${star.hue}, 100%, 68%, ${alpha * 0.2})`);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, star.glow, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${star.hue}, 95%, 88%)`;
      if (star.size < 1) {
        ctx.fillRect(x, y, star.size, star.size);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function spawnShootingStar(now: number) {
      if (reducedMotion.matches || shootingStars.length > 2 || now < nextShootingStar) return;
      const speed = random(520, 780);
      shootingStars.push({
        x: random(width * 0.18, width * 0.92),
        y: random(height * 0.03, height * 0.38),
        vx: -speed,
        vy: speed * random(0.32, 0.46),
        life: 0,
        maxLife: random(0.72, 1.05),
        length: random(120, 230),
        alpha: random(0.46, 0.82)
      });
      nextShootingStar = now + random(3600, 8200);
    }

    function drawShootingStars(dt: number) {
      for (let index = shootingStars.length - 1; index >= 0; index -= 1) {
        const item = shootingStars[index];
        item.life += dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;

        const progress = item.life / item.maxLife;
        if (progress >= 1) {
          shootingStars.splice(index, 1);
          continue;
        }

        const alpha = item.alpha * Math.sin(progress * Math.PI);
        const angle = Math.atan2(item.vy, item.vx);
        const tailX = item.x - Math.cos(angle) * item.length;
        const tailY = item.y - Math.sin(angle) * item.length;
        const gradient = ctx.createLinearGradient(item.x, item.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        gradient.addColorStop(0.18, `rgba(147, 197, 253, ${alpha * 0.76})`);
        gradient.addColorStop(1, "rgba(96, 165, 250, 0)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(96, 165, 250, 0.7)";
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.restore();
      }
    }

    function render(now: number) {
      const deltaSeconds = Math.min((now - lastTime) / 1000, 0.034);
      lastTime = now;
      pointer.x += (pointer.targetX - pointer.x) * 0.045;
      pointer.y += (pointer.targetY - pointer.y) * 0.045;

      drawAmbient(now);
      ctx.globalCompositeOperation = "screen";
      for (const star of stars) drawStar(star, now, deltaSeconds);
      spawnShootingStar(now);
      drawShootingStars(deltaSeconds);
      ctx.globalCompositeOperation = "source-over";

      frame = requestAnimationFrame(render);
    }

    function onPointerMove(event: PointerEvent) {
      pointer.targetX = ((event.clientX / Math.max(width, 1)) - 0.5) * 1.8;
      pointer.targetY = ((event.clientY / Math.max(height, 1)) - 0.5) * 1.4;
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas className="cosmic-canvas" ref={canvasRef} aria-hidden="true" />;
}

function App() {
  const location = useLocation();
  const { i18n: activeI18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState<User | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("dreamx_theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    Promise.all([
      api<{ authenticated: boolean; user?: User }>("/api/v1/auth/me")
        .then((data) => {
          if (data.authenticated && data.user) setUser(data.user);
        })
        .catch(() => null),
      api<{ settings: Record<string, unknown> }>("/api/v1/settings/public")
        .then((data) => setSettings(data.settings || {}))
        .catch(() => null)
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("dreamx_theme", theme);
  }, [theme]);

  useEffect(() => {
    const lang = (activeI18n.resolvedLanguage || activeI18n.language || "en").split("-")[0];
    document.documentElement.lang = lang;
    document.documentElement.dir = rtlLanguages.has(lang) ? "rtl" : "ltr";
    localStorage.setItem("dreamx_lang", lang);
  }, [activeI18n.language, activeI18n.resolvedLanguage]);

  useDocumentMeta(location.pathname);

  const value = useMemo(() => ({ user, setUser, admin, setAdmin }), [user, admin]);
  const themeValue = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <CosmicBackground />
      <AuthContext.Provider value={value}>
        <ErrorBoundary>
          {loading ? (
            <LoadingScreen />
          ) : settings.maintenanceMode && !window.location.pathname.startsWith("/dream") && window.location.pathname !== "/maintenance" ? (
            <MaintenancePage />
          ) : (
            <Routes>
              <Route path="/" element={<PublicLayout><Landing /></PublicLayout>} />
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password/:token" element={<ResetPassword />} />
              <Route path="/dashboard" element={<Protected><AppLayout><Dashboard /></AppLayout></Protected>} />
              <Route path="/projects" element={<Protected><AppLayout><Projects /></AppLayout></Protected>} />
              <Route path="/projects/:id" element={<Protected><AppLayout><ProjectDetail /></AppLayout></Protected>} />
              <Route path="/deploy" element={<Protected><AppLayout><Deploy /></AppLayout></Protected>} />
              <Route path="/profile" element={<Protected><AppLayout><Profile /></AppLayout></Protected>} />
              <Route path="/dream" element={<AdminLogin />} />
              <Route path="/dream/dashboard" element={<AdminProtected><AdminLayout><AdminDashboard /></AdminLayout></AdminProtected>} />
              <Route path="/dream/users" element={<AdminProtected><AdminLayout><AdminUsers /></AdminLayout></AdminProtected>} />
              <Route path="/dream/projects" element={<AdminProtected><AdminLayout><AdminProjects /></AdminLayout></AdminProtected>} />
              <Route path="/dream/settings" element={<AdminProtected><AdminLayout><AdminSettings /></AdminLayout></AdminProtected>} />
              <Route path="/dream/logs" element={<AdminProtected><AdminLayout><AdminLogs /></AdminLayout></AdminProtected>} />
              <Route path="/dream/notifications" element={<AdminProtected><AdminLayout><AdminNotifications /></AdminLayout></AdminProtected>} />
              <Route path="/404" element={<NotFound />} />
              <Route path="/maintenance" element={<MaintenancePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          )}
        </ErrorBoundary>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}

type ThemeMode = "dark" | "light";

const ThemeContext = createContext<{ theme: ThemeMode; setTheme: (theme: ThemeMode) => void } | null>(null);

const AuthContext = createContext<{
  user: User | null;
  setUser: (user: User | null) => void;
  admin: User | null;
  setAdmin: (admin: User | null) => void;
} | null>(null);

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Auth context is missing.");
  return context;
}

function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Theme context is missing.");
  return context;
}

function useDocumentMeta(pathname: string) {
  const { t } = useTranslation();
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": `${BRAND_NAME} - ${t("brand.tagline")}`,
      "/login": `${t("nav.login")} - ${BRAND_NAME}`,
      "/register": `${t("auth.registerTitle")} - ${BRAND_NAME}`,
      "/forgot-password": `${t("auth.forgot")} - ${BRAND_NAME}`,
      "/dashboard": `${t("nav.dashboard")} - ${BRAND_NAME}`,
      "/projects": `${t("nav.projects")} - ${BRAND_NAME}`,
      "/deploy": `${t("nav.deploy")} - ${BRAND_NAME}`,
      "/profile": `${t("nav.profile")} - ${BRAND_NAME}`,
      "/dream": `${BRAND_NAME}`,
      "/dream/dashboard": `${t("admin.dashboard")} - ${BRAND_NAME}`,
      "/dream/users": `${t("admin.users")} - ${BRAND_NAME}`,
      "/dream/projects": `${t("admin.projects")} - ${BRAND_NAME}`,
      "/dream/settings": `${t("admin.settings")} - ${BRAND_NAME}`,
      "/dream/logs": `${t("admin.logs")} - ${BRAND_NAME}`,
      "/dream/notifications": `${t("admin.notifications")} - ${BRAND_NAME}`,
      "/maintenance": `Maintenance - ${BRAND_NAME}`,
      "/404": `404 - ${BRAND_NAME}`
    };
    const dynamicTitle = pathname.startsWith("/projects/") ? `${t("projects.details")} - ${BRAND_NAME}` : undefined;
    const title = dynamicTitle || titles[pathname] || `404 - ${BRAND_NAME}`;
    const description = pathname === "/" ? t("landing.copy") : t("brand.tagline");
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:image", `${window.location.origin}/og-image.png`, true);
    setCanonical(`${window.location.origin}${pathname}`);
  }, [pathname, t]);
}

function setMeta(name: string, content: string, property = false) {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(property ? "property" : "name", name);
    document.head.appendChild(tag);
  }
  tag.content = content;
}

function setCanonical(href: string) {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.hasError) {
      return (
        <main className="center-page">
          <section className="card center-copy">
            <h1>Something went wrong</h1>
            <p className="muted">Refresh the page or return home to continue.</p>
            <Link className="button primary" to="/">Home</Link>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <main className="center-page">
      <div className="card loading-card">
        <Rocket size={24} />
        <strong>{t("brand.name")}</strong>
        <div className="skeleton-line" />
      </div>
    </main>
  );
}

function VideoBackground({ variant = "entry", className = "" }: { variant?: "entry" | "console"; className?: string }) {
  const src = variant === "console" ? consoleVideo : entranceVideo;
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () => setEnabled(!motionQuery.matches && !mobileQuery.matches && !connection?.saveData);

    update();
    motionQuery.addEventListener("change", update);
    mobileQuery.addEventListener("change", update);
    return () => {
      motionQuery.removeEventListener("change", update);
      mobileQuery.removeEventListener("change", update);
    };
  }, []);

  return (
    <div className={`video-bg ${className}`} aria-hidden="true">
      {enabled && <video className="is-active" autoPlay muted loop playsInline preload="metadata" src={src} />}
      <div className="video-overlay" />
    </div>
  );
}

function PageMotion({ children }: { children: ReactNode }) {
  return <div className="page-motion">{children}</div>;
}

function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to="/" className="logo" aria-label={`${BRAND_NAME} home`}>
      <span className="logo-mark"><Rocket size={18} /></span>
      {!compact && <span>{t("brand.name")}</span>}
    </Link>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const light = theme === "light";
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={t("nav.theme")}
      onClick={() => setTheme(light ? "dark" : "light")}
    >
      {light ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}

function LanguageSwitcher() {
  const [open, setOpen] = useState(false);
  const activeCode = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  const active = languages.find((language) => language.code === activeCode) || languages[0];
  const { t } = useTranslation();
  return (
    <div className="language-switcher">
      <button className="icon-button lang-trigger" type="button" aria-label={t("nav.language")} onClick={() => setOpen(!open)}>
        <Globe2 size={17} />
        <span>{active.code.toUpperCase()}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="card language-menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {languages.map((language) => (
              <button
                key={language.code}
                type="button"
                className={language.code === active.code ? "active" : ""}
                onClick={() => {
                  i18n.changeLanguage(language.code);
                  setOpen(false);
                }}
              >
                <span>{language.code.toUpperCase()}</span>
                {language.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { href: "#features", label: t("nav.features") },
    { href: "#workflow", label: t("nav.workflow") },
    { href: "#pricing", label: t("nav.pricing") },
    { href: "#faq", label: t("nav.faq") }
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className={`public-nav ${scrolled ? "is-solid" : ""}`}>
        <Logo />
        <nav className="nav-links">
          {navItems.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <div className="nav-actions">
          <LanguageSwitcher />
          <ThemeToggle />
          {user ? (
            <Link className="button primary" to="/dashboard">{t("nav.dashboard")}</Link>
          ) : (
            <>
              <Link className="button ghost" to="/login">{t("nav.login")}</Link>
              <Link className="button primary" to="/register">{t("nav.register")}</Link>
            </>
          )}
          <button
            className="icon-button mobile-menu-button"
            type="button"
            aria-label={menuOpen ? t("common.close") : "Menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              className="card mobile-panel public-mobile-panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {navItems.map((item) => <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>)}
              <div className="mobile-panel-actions">
                <div className="mobile-panel-controls">
                  <LanguageSwitcher />
                  <ThemeToggle />
                </div>
                {user ? (
                  <Link className="button primary" to="/dashboard" onClick={() => setMenuOpen(false)}>{t("nav.dashboard")}</Link>
                ) : (
                  <>
                    <Link className="button secondary" to="/login" onClick={() => setMenuOpen(false)}>{t("nav.login")}</Link>
                    <Link className="button primary" to="/register" onClick={() => setMenuOpen(false)}>{t("nav.register")}</Link>
                  </>
                )}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>
      {children}
    </>
  );
}

function Landing() {
  const { t } = useTranslation();
  const [faqOpen, setFaqOpen] = useState(0);
  const featureCards = getFeatureCards(t);
  const workflowSteps = getWorkflowSteps(t);
  const pricingTiers = getPricingTiers(t);
  const faqItems = getFaqItems(t);
  const pipelineSteps = getPipelineSteps(t);

  return (
    <main>
      <section className="hero-section">
        <VideoBackground />
        <div className="hero-content shell">
          <PageMotion>
            <span className="badge">{t("landing.eyebrow")}</span>
            <h1 className="hero-title">{t("landing.title")}</h1>
            <p className="hero-copy">
              {t("landing.copy")}
            </p>
            <div className="hero-actions">
              <Link className="button primary large" to="/register">{t("nav.register")} <ArrowRight size={18} /></Link>
              <a className="button secondary large" href="#workflow">{t("nav.docs")} <Play size={18} /></a>
            </div>
          </PageMotion>
          <div className="card hero-panel">
            <div className="panel-head">
              <span>{t("landing.pipeline.title")}</span>
              <span className="status-badge live"><span /> {t("landing.pipeline.live")}</span>
            </div>
            {pipelineSteps.map((item) => (
              <div
                className="pipeline-row"
                key={item}
              >
                <BadgeCheck size={18} />
                <span>{item}</span>
                <small>{t("landing.pipeline.done")}</small>
              </div>
            ))}
            <div className="terminal-mini">
              <span>$ dreamx deploy github.com/user/site</span>
              <span>https://site.dream.x</span>
            </div>
          </div>
          <a className="scroll-indicator" href="#features" aria-label={t("landing.scroll")}><ChevronDown size={20} /></a>
        </div>
      </section>

      <section id="features" className="section shell">
        <SectionHeader eyebrow={t("nav.features")} title={t("landing.featuresTitle")} />
        <motion.div className="feature-grid" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={staggerParent}>
          {featureCards.map((feature) => <FeatureCard key={feature.title} feature={feature} />)}
        </motion.div>
      </section>

      <section id="workflow" className="section shell">
        <SectionHeader eyebrow={t("nav.workflow")} title={t("landing.workflowTitle")} />
        <div className="flow-grid">
          {workflowSteps.map((step, index) => (
            <motion.div className="card flow-card" key={step.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} viewport={{ once: true }}>
              <span className="flow-index">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="pricing" className="section shell pricing-showcase">
        <div className="showcase-copy">
          <span className="badge">{t("nav.pricing")}</span>
          <h2>{t("landing.pricingTitle")}</h2>
          <p>{t("landing.readyCopy")}</p>
          <div className="showcase-preview" aria-hidden="true">
            <div className="preview-window">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-terminal">
              <span>$ dreamx deploy github.com/team/app</span>
              <strong>https://team-app.dream.x</strong>
            </div>
          </div>
        </div>
        <div className="choice-stack">
          {pricingTiers.map((tier, index) => (
            <motion.div className={`choice-card ${index === 1 ? "is-featured" : ""}`} key={tier.name} whileHover={{ y: -3 }}>
              <div className="choice-info">
                <span className="choice-kicker">{index === 1 ? t("landing.popular") : t("nav.deploy")}</span>
                <h3>{tier.name}</h3>
                <p>{tier.copy}</p>
                <ul>
                  {tier.items.map((item) => <li key={item}><Check size={16} /> {item}</li>)}
                </ul>
              </div>
              <div className="choice-price">
                <span>{t("nav.pricing")}</span>
                <strong>{tier.price}</strong>
                <Link className="button primary" to="/register">{t("nav.register")}</Link>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="faq" className="section shell">
        <SectionHeader eyebrow={t("nav.faq")} title={t("landing.faqTitle")} />
        <div className="faq-list">
          {faqItems.map((item, index) => (
            <button
              className="card faq-item"
              key={item.q}
              type="button"
              aria-expanded={faqOpen === index}
              onClick={() => setFaqOpen(faqOpen === index ? -1 : index)}
            >
              <span><CircleHelp size={18} /> {item.q}</span>
              <ChevronDown className={faqOpen === index ? "rotate" : ""} size={18} />
              <AnimatePresence>
                {faqOpen === index && (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    {item.a}
                  </motion.p>
                )}
              </AnimatePresence>
            </button>
          ))}
        </div>
      </section>

      <section className="section shell">
        <div className="card cta-card">
          <div>
            <span className="badge">{t("landing.ready")}</span>
            <h2>{BRAND_NAME}</h2>
            <p>{t("landing.readyCopy")}</p>
          </div>
          <Link className="button primary large" to="/register">{t("nav.register")} <ArrowRight size={18} /></Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-head">
      <span className="badge">{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function FeatureCard({ feature }: { feature: { title: string; copy: string; icon: LucideIcon } }) {
  const Icon = feature.icon;
  return (
    <motion.article className="card feature-card" variants={staggerItem} whileHover={{ scale: 1.01 }}>
      <Icon size={22} />
      <h3>{feature.title}</h3>
      <p>{feature.copy}</p>
    </motion.article>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="footer shell">
      <div>
        <Logo />
        <p>{t("brand.tagline")}</p>
        <div className="footer-controls">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <div>
        <strong>{t("footer.platform")}</strong>
        <Link to="/deploy">{t("nav.deploy")}</Link>
        <Link to="/projects">{t("nav.projects")}</Link>
        <Link to="/dashboard">{t("nav.dashboard")}</Link>
      </div>
      <div>
        <strong>{t("footer.company")}</strong>
        <a href="#features">{t("nav.features")}</a>
        <a href="#pricing">{t("nav.pricing")}</a>
        <a href="#faq">{t("nav.faq")}</a>
      </div>
      <div>
        <strong>{t("footer.policy")}</strong>
        <a href="#faq">{t("footer.security")}</a>
        <a href="#faq">{t("footer.privacy")}</a>
        <a href="mailto:support@dreamx.dev">{t("footer.support")}</a>
      </div>
      <p className="footer-bottom">Copyright {new Date().getFullYear()} {BRAND_NAME}. {t("footer.rights")}</p>
    </footer>
  );
}

function isValidEmailInput(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPasswordInput(value: string) {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const isRegister = mode === "register";
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", remember: true });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const name = form.name.trim();
    const email = form.email.trim();
    if (isRegister && name.length < 2) {
      setError(t("errors.nameMin"));
      return;
    }
    if (!isValidEmailInput(email)) {
      setError(t("errors.emailInvalid"));
      return;
    }
    if (!form.password) {
      setError(t("errors.required"));
      return;
    }
    if (isRegister && !isStrongPasswordInput(form.password)) {
      setError(t("errors.passwordStrong"));
      return;
    }
    if (isRegister && form.password !== form.confirmPassword) {
      setError(t("errors.passwordMatch"));
      return;
    }
    setLoading(true);
    try {
      const payload = isRegister
        ? { name, email, password: form.password, remember: form.remember }
        : { email, password: form.password, remember: form.remember };
      const data = await api<{ user: User; accessToken: string; refreshToken: string }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      localStorage.setItem("lp_access", data.accessToken);
      localStorage.setItem("lp_refresh", data.refreshToken);
      setUser(data.user);
      const intended = !isRegister ? sessionStorage.getItem("dreamx_intended_url") : "";
      if (intended) sessionStorage.removeItem("dreamx_intended_url");
      navigate(intended || "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      setLoading(false);
    }
  }

  const footer = isRegister ? (
    <span>{t("auth.already")} <Link to="/login">{t("nav.login")}</Link></span>
  ) : (
    <span>{t("auth.new")} <Link to="/register">{t("auth.create")}</Link></span>
  );

  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <CenteredCardPage maxWidth={isRegister ? 460 : 420} footer={footer} showBrand>
      <form onSubmit={submit} className="form-stack">
        <div>
          <h1>{isRegister ? t("auth.registerTitle") : t("auth.loginTitle")}</h1>
          <p>{isRegister ? t("auth.registerCopy") : t("auth.loginCopy")}</p>
        </div>
        {isRegister && (
          <Field label={t("auth.name")} id="name">
            <input id="name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
        )}
        <Field label={t("auth.email")} id="email">
          <input id="email" className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        </Field>
        <PasswordInput label={t("auth.password")} value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete={isRegister ? "new-password" : "current-password"} />
        {isRegister && <p className="field-hint">{t("auth.passwordHint")}</p>}
        {isRegister && (
          <PasswordInput label={t("auth.confirmPassword")} value={form.confirmPassword} onChange={(confirmPassword) => setForm({ ...form, confirmPassword })} autoComplete="new-password" />
        )}
        <label className="check-row">
          <input type="checkbox" checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} />
          <span>{t("auth.remember")}</span>
        </label>
        {!isRegister && <Link className="muted-link" to="/forgot-password">{t("auth.forgot")}</Link>}
        {error && <Alert type="error" message={error} />}
        <button className="button primary full" type="submit" disabled={loading}>{loading && <span className="spinner" />} {isRegister ? t("auth.create") : t("nav.login")}</button>
      </form>
    </CenteredCardPage>
  );
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api<{ message: string }>("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setMessage(data.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <CenteredCardPage maxWidth={400} footer={<Link to="/login">Back to login</Link>} showBrand>
      <form onSubmit={submit} className="form-stack">
        <div>
          <h1>Reset password</h1>
          <p>Enter your email. Reset tokens expire after 15 minutes.</p>
        </div>
        <Field label="Email" id="forgot-email">
          <input id="forgot-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        {message && <Alert type="success" message={message} />}
        <button className="button primary full" disabled={loading}>{loading && <span className="spinner" />} Send reset link</button>
      </form>
    </CenteredCardPage>
  );
}

function ResetPassword() {
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    try {
      await api(`/api/v1/auth/reset-password/${token}`, { method: "POST", body: JSON.stringify({ password }) });
      setMessage("Password updated. You can login now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    }
  }

  return (
    <CenteredCardPage maxWidth={400} footer={<Link to="/login">Back to login</Link>} showBrand>
      <form onSubmit={submit} className="form-stack">
        <div>
          <h1>New password</h1>
          <p>Use at least 8 characters with uppercase, lowercase, and a number.</p>
        </div>
        <PasswordInput label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordInput label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {message && <Alert type="success" message={message} />}
        {error && <Alert type="error" message={error} />}
        <button className="button primary full">Update password</button>
      </form>
    </CenteredCardPage>
  );
}

function CenteredCardPage({ children, footer, maxWidth, showBrand = false }: { children: ReactNode; footer?: ReactNode; maxWidth: number; showBrand?: boolean }) {
  return (
    <main className="video-page">
      <div className="auth-card-shell" style={{ maxWidth }}>
        <motion.section className="card auth-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {showBrand && <Logo />}
          {showBrand && <div className="divider" />}
          {children}
        </motion.section>
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </main>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function PasswordInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete?: string }) {
  const [visible, setVisible] = useState(false);
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <Field label={label} id={id}>
      <div className="password-wrap">
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button className="icon-button" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </Field>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (!user) sessionStorage.setItem("dreamx_intended_url", `${location.pathname}${location.search}${location.hash}`);
  }, [user, location.pathname, location.search, location.hash]);
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppLayout({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!notificationsOpen) return;
    api<{ notifications: NotificationItem[] }>("/api/v1/public/stats")
      .then((data) => setNotifications(data.notifications || []))
      .catch(() => setNotifications([]));
  }, [notificationsOpen]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    localStorage.removeItem("lp_access");
    localStorage.removeItem("lp_refresh");
    setUser(null);
    setMobileOpen(false);
    navigate("/");
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Logo />
        <nav className="app-nav">
          <Link to="/dashboard">{t("nav.dashboard")}</Link>
          <Link to="/projects">{t("nav.projects")}</Link>
          <Link to="/deploy">{t("nav.deploy")}</Link>
        </nav>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            className="icon-button notify-button"
            type="button"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen((value) => !value);
              setOpen(false);
            }}
          >
            <Bell size={18} />
            <span className="notify-dot" />
          </button>
          <button
            className="avatar-button"
            type="button"
            onClick={() => {
              setOpen(!open);
              setNotificationsOpen(false);
            }}
          >
            {user?.avatarUrl ? <img src={user.avatarUrl} alt={user.name} loading="lazy" /> : <User size={18} />}
            <span>{user?.name}</span>
          </button>
          <button
            className="icon-button mobile-menu-button"
            type="button"
            aria-label={mobileOpen ? t("common.close") : "Menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <AnimatePresence>
            {notificationsOpen && (
              <motion.div className="dropdown card notification-dropdown" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                <strong>{t("admin.notifications")}</strong>
                {notifications.map((item) => (
                  <div className="notification-item" key={item.id}>
                    <span>{item.title}</span>
                    <small>{item.message}</small>
                  </div>
                ))}
                {!notifications.length && <p className="muted">{t("common.empty")}</p>}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {open && (
              <motion.div className="dropdown card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                <Link to="/profile" onClick={() => setOpen(false)}>{t("nav.profile")}</Link>
                <button onClick={logout}><LogOut size={16} /> {t("nav.logout")}</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.nav className="card mobile-panel app-mobile-panel" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Link to="/dashboard" onClick={() => setMobileOpen(false)}>{t("nav.dashboard")}</Link>
              <Link to="/projects" onClick={() => setMobileOpen(false)}>{t("nav.projects")}</Link>
              <Link to="/deploy" onClick={() => setMobileOpen(false)}>{t("nav.deploy")}</Link>
              <Link to="/profile" onClick={() => setMobileOpen(false)}>{t("nav.profile")}</Link>
              <div className="mobile-panel-controls">
                <LanguageSwitcher />
                <ThemeToggle />
              </div>
              <button type="button" onClick={logout}><LogOut size={16} /> {t("nav.logout")}</button>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>
      <div className="shell content-space">{children}</div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipsHidden, setTipsHidden] = useState(false);

  useEffect(() => {
    api<{ items: Project[] }>("/api/v1/projects")
      .then((data) => setProjects(data.items || []))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects.filter((project) => project.active !== false);
  const slots = [0, 1, 2].map((index) => activeProjects[index] || null);

  return (
    <PageMotion>
      <PageTitle eyebrow={t("nav.dashboard")} title={t("dashboard.title")} copy={t("dashboard.copy")} />
      <section className="card dashboard-hero">
        <div>
          <span className="badge">{t("dashboard.welcome", { name: user?.name?.split(" ")[0] || t("dashboard.developer") })}</span>
          <h2>{t("brand.tagline")}</h2>
          <p className="muted">{t("dashboard.workspaceCopy")}</p>
        </div>
        <div className="quick-actions">
          <Link className="button primary" to="/deploy"><Rocket size={16} /> {t("dashboard.deployNew")}</Link>
          <Link className="button secondary" to="/projects"><FileArchive size={16} /> {t("dashboard.viewProjects")}</Link>
          <a className="button secondary" href="#tips"><CircleHelp size={16} /> {t("dashboard.viewDocs")}</a>
        </div>
      </section>
      <div className="stats-grid">
        <CounterCard label={t("dashboard.activeProjects")} value={activeProjects.length} />
        <CounterCard label={t("dashboard.availableSlots")} value={Math.max(0, 3 - activeProjects.length)} />
        <CounterCard label={t("dashboard.monthDeploys")} value={projects.length} />
        <CounterCard label={t("dashboard.bandwidth")} value={3.8} suffix=" GB" decimals={1} />
      </div>
      <div className="slot-grid">
        {loading ? (
          [0, 1, 2].map((item) => <SkeletonCard key={item} />)
        ) : (
          slots.map((project, index) => project ? <ProjectSlot key={project.id} project={project} /> : <EmptySlot key={index} />)
        )}
      </div>
      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>{t("dashboard.recentActivity")}</h2>
            <Activity size={18} />
          </div>
          <div className="activity-list">
            {projects.slice(0, 5).map((project) => (
              <Link key={project.id} to={`/projects/${project.id}`}>
                <span className={`status-dot ${project.status}`} />
                <div>
                  <strong>{project.name}</strong>
                  <small>{project.status} - {formatDate(project.createdAt)}</small>
                </div>
              </Link>
            ))}
            {!projects.length && <p className="muted">{t("common.empty")}</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>{t("dashboard.quickDeploy")}</h2>
            <Upload size={18} />
          </div>
          <p className="muted">Connect a GitHub or GitLab repo, review analysis, then publish a live URL.</p>
          <Link className="button primary" to="/deploy">{t("dashboard.deployNew")} <ArrowRight size={16} /></Link>
        </section>
      </div>
      {!tipsHidden && (
        <section id="tips" className="card onboarding-card">
          <div className="card-head">
            <h2>{t("dashboard.tips")}</h2>
            <button className="button secondary" onClick={() => setTipsHidden(true)}>{t("dashboard.dismiss")}</button>
          </div>
          <div className="onboarding-list">
            {["Connect your first repository", "Add a custom domain label", "Open live logs during build", "Review security settings"].map((item) => (
              <span key={item}><Check size={16} /> {item}</span>
            ))}
          </div>
        </section>
      )}
    </PageMotion>
  );
}

function ProjectSlot({ project }: { project: Project }) {
  return (
    <motion.article className="card slot-card" whileHover={{ scale: 1.01 }}>
      <div className="card-head">
        <span className={`status-badge ${project.status}`}><span /> {project.status}</span>
        <Code2 size={18} />
      </div>
      <h3>{project.name}</h3>
      <p>{project.framework || "Static"}</p>
      {project.url && <a href={project.url} target="_blank" rel="noreferrer">{project.url}</a>}
      <Link className="button secondary" to={`/projects/${project.id}`}>Open details</Link>
    </motion.article>
  );
}

function EmptySlot() {
  return (
    <Link className="card slot-card empty-slot" to="/deploy">
      <CloudUpload size={28} />
      <h3>Deploy New Project</h3>
      <p>Empty slot ready for a GitHub or GitLab repository.</p>
    </Link>
  );
}

function Projects() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ items: Project[] }>(`/api/v1/projects?${params.toString()}`);
    setProjects(data.items || []);
    setLoading(false);
  }

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  return (
    <PageMotion>
      <PageTitle eyebrow={t("nav.projects")} title={t("projects.title")} copy={t("projects.copy")} />
      <div className="filter-bar card">
        <div className="input-icon"><Search size={16} /><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("projects.search")} /></div>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="live">Live</option>
          <option value="building">Building</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>
        <button className="button secondary" onClick={load}><ListFilter size={16} /> Filter</button>
      </div>
      <div className="project-list">
        {loading ? <SkeletonCard /> : projects.map((project) => <ProjectListCard key={project.id} project={project} />)}
        {!loading && !projects.length && <EmptyState title={t("projects.empty")} copy={t("projects.emptyCopy")} />}
      </div>
    </PageMotion>
  );
}

function ProjectListCard({ project }: { project: Project }) {
  const { t } = useTranslation();
  const openUrl = previewProjectUrl(project);
  return (
    <article className="card project-row">
      <div>
        <span className={`status-badge ${project.status}`}><span /> {project.status}</span>
        <h3>{project.name}</h3>
        <p>{project.framework || "Static"} - {formatDate(project.createdAt)}</p>
      </div>
      <div className="row-actions">
        {openUrl && <a className="button secondary" href={openUrl} target="_blank" rel="noreferrer">{t("projects.open")}</a>}
        <Link className="button primary" to={`/projects/${project.id}`}>{t("projects.details")}</Link>
      </div>
    </article>
  );
}

function Deploy() {
  const { t } = useTranslation();
  const location = useLocation();
  const [sourceProvider, setSourceProvider] = useState<SourceProvider>("github");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [name, setName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [envRows, setEnvRows] = useState([{ key: "", value: "" }]);
  const [githubUser, setGithubUser] = useState<GitHubConnectedUser | null>(null);
  const [repoList, setRepoList] = useState<GitHubRepoInfo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [repo, setRepo] = useState<GitHubRepoInfo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "queued" | "building" | "deploying" | "live" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [limitModal, setLimitModal] = useState(false);
  const selectedSource = sourceProviders.find((item) => item.id === sourceProvider) || sourceProviders[0];

  function detectProviderFromUrl(value: string): SourceProvider | "" {
    if (/github\.com\//i.test(value)) return "github";
    if (/gitlab\.com\//i.test(value)) return "gitlab";
    return "";
  }

  useEffect(() => {
    const match = repoUrl.trim().match(/(?:github|gitlab)\.com\/(?:.+\/)?([^/.]+)(?:\.git)?\/?$/i);
    if (match && !name) setName(match[1]);
  }, [repoUrl, name]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const returnedSource = params.get("source");
    const source = returnedSource === "gitlab" ? "gitlab" : "github";
    if (returnedSource === "github" || returnedSource === "gitlab") setSourceProvider(source);
    const status = params.get("connection") || params.get("github");
    if (status === "missing_config") setError(t("deploy.githubOAuthMissing"));
    if (status === "failed") setError(t("deploy.githubOAuthFailed"));
    api<{ connection: { connected: boolean; login: string; avatarUrl: string; htmlUrl?: string; connectedAt?: string } }>(`/api/v1/source/${source}/status`)
      .then((data) => {
        if (!data.connection.connected) return;
        setGithubUser({ login: data.connection.login, avatarUrl: data.connection.avatarUrl, htmlUrl: data.connection.htmlUrl });
        loadRepositories(source, true);
      })
      .catch(() => null);
  }, [location.search, t]);

  const filteredRepos = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();
    return repoList.filter((item) => {
      if (!query) return true;
      return item.fullName.toLowerCase().includes(query) || String(item.description || "").toLowerCase().includes(query);
    });
  }, [repoList, repoSearch]);

  function changeSourceProvider(provider: SourceProvider) {
    setSourceProvider(provider);
    setGithubUser(null);
    setRepoList([]);
    setSelectedRepoFullName("");
    setRepo(null);
    setAnalysis(null);
    setRepoUrl("");
    setBranches([]);
    setError("");
  }

  async function loadRepositories(provider = sourceProvider, silent = false) {
    setError("");
    setRepoLoading(true);
    try {
      if (!silent) appendLog("info", `Loading ${provider} repositories.`);
      const sourceData = await api<{ user: GitHubConnectedUser; repositories: GitHubRepoInfo[] }>(`/api/v1/source/${provider}/connect`, {
        method: "POST",
        body: JSON.stringify({ search: repoSearch })
      });
      setGithubUser(sourceData.user);
      setRepoList(sourceData.repositories || []);
      if (!silent) {
        const providerName = sourceProviders.find((item) => item.id === provider)?.name || "Git";
        appendLog("info", t("deploy.githubConnected", { provider: providerName, count: sourceData.repositories?.length || 0 }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      setRepoLoading(false);
    }
  }

  function connectGitHub() {
    window.location.href = `/api/v1/source/${sourceProvider}/oauth/start`;
  }

  async function disconnectGitHub() {
    setError("");
    try {
      await api(`/api/v1/source/${sourceProvider}/disconnect`, { method: "POST" });
      setGithubUser(null);
      setRepoList([]);
      setSelectedRepoFullName("");
      setRepo(null);
      setAnalysis(null);
      appendLog("info", `${selectedSource.name} disconnected.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    }
  }

  async function loadBranches(repoInfo: GitHubRepoInfo) {
    try {
      const sourceData = await api<{ branches: string[] }>(`/api/v1/source/${sourceProvider}/branches`, {
        method: "POST",
        body: JSON.stringify({ repoUrl: repoInfo.url })
      });
      setBranches(sourceData.branches || [repoInfo.defaultBranch || "main"]);
    } catch (_err) {
      setBranches([repoInfo.defaultBranch || "main"]);
    }
  }

  function selectRepository(repoInfo: GitHubRepoInfo) {
    setSelectedRepoFullName(repoInfo.fullName);
    setRepoUrl(repoInfo.url);
    setRepo(repoInfo);
    setAnalysis(null);
    setError("");
    setBranch(repoInfo.defaultBranch || "main");
    setName(repoInfo.name);
    appendLog("info", `Selected ${repoInfo.fullName}.`);
    loadBranches(repoInfo);
  }

  async function analyze() {
    if (!repoUrl.trim()) {
      setError(t("errors.repoRequired"));
      return;
    }
    setError("");
    setPhase("analyzing");
    setProgress(18);
    try {
      appendLog("info", `Validating ${selectedSource.name} repository access.`);
      const data = await api<{ repo: GitHubRepoInfo; branches: string[]; analysis: Analysis }>("/api/v1/deployments/analyze", {
        method: "POST",
        body: JSON.stringify({ repoUrl, branch, rootDir })
      });
      setRepo(data.repo);
      setBranches(data.branches || []);
      setAnalysis(data.analysis);
      setBranch(data.analysis.branch || branch || data.repo.defaultBranch || "main");
      if (!name) setName(data.repo.name);
      setBuildCommand(data.analysis.buildCommand || "");
      setOutputDir(data.analysis.outputDir || ".");
      setProgress(36);
      setPhase("idle");
      appendLog("info", `Detected ${data.analysis.framework} from ${data.repo.fullName}.`);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }

  async function deployNow() {
    if (!repoUrl.trim()) return;
    setError("");
    setResult(null);
    setLogs([]);
    setPhase("queued");
    setProgress(8);
    appendLog("info", "Queued deployment job.");
    await delay(240);
    setPhase("building");
    appendLog("info", "Preparing sandboxed build directory.");
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 6, 88)), 360);
    try {
      appendLog("info", `Cloning ${selectedSource.name} repository and starting build.`);
      const data = await api<{ project: Project; deployment: Deployment }>("/api/v1/deployments", {
        method: "POST",
        body: JSON.stringify({
          repoUrl,
          branch,
          name: name || repo?.name,
          customDomain,
          buildCommand,
          outputDir,
          rootDir,
          envVars: envRows.filter((row) => row.key.trim())
        })
      });
      window.clearInterval(timer);
      setPhase("deploying");
      setProgress(94);
      appendLog("info", "Publishing immutable static assets.");
      await delay(280);
      setResult(data.project);
      setPhase("live");
      setProgress(100);
      appendLog("info", `Deployment live at ${publicProjectUrl(data.project)}`);
    } catch (err) {
      window.clearInterval(timer);
      const message = err instanceof Error ? err.message : "Deployment failed.";
      setPhase("failed");
      setError(message);
      appendLog("error", message);
      if (message.toLowerCase().includes("limit")) setLimitModal(true);
    }
  }

  function appendLog(level: LogEntry["level"], message: string) {
    setLogs((items) => [...items, { id: `${Date.now()}-${items.length}`, level, message, createdAt: new Date().toISOString() }]);
  }

  const analysisRows = analysis ? [
    ["Repository", repo?.fullName || repoUrl],
    ["Last commit", repo?.lastCommitMessage || analysis.branch || branch],
    ["Detecting framework", analysis.framework || "Static"],
    ["Detecting build command", analysis.buildCommand || "none"],
    ["Detecting output directory", analysis.outputDir || "."],
    ["Detecting entry point", analysis.entryPoint || "index.html"]
  ] : [];

  return (
    <PageMotion>
      <PageTitle eyebrow={t("nav.deploy")} title={t("deploy.title")} copy={t("deploy.copy")} />
      <div className="deploy-grid">
        <section className="card deploy-card">
          <div className="github-banner">
            <Code2 size={28} />
            <div>
              <strong>{t("deploy.githubDeployTitle")}</strong>
              <span>{t("deploy.githubDeployCopy")}</span>
            </div>
          </div>
          <div className="provider-grid" role="list">
            {sourceProviders.map((provider) => (
              <button
                className={`provider-card ${sourceProvider === provider.id ? "active" : ""}`}
                type="button"
                key={provider.id}
                onClick={() => changeSourceProvider(provider.id)}
              >
                <strong>{provider.name}</strong>
                <span>{t(provider.descriptionKey)}</span>
              </button>
            ))}
          </div>
          <div className="github-connect">
            <div className="github-connect-actions">
              {githubUser ? (
                <>
                  <a className="github-account" href={githubUser.htmlUrl || "#"} target="_blank" rel="noreferrer">
                    {githubUser.avatarUrl && <img src={githubUser.avatarUrl} alt="" loading="lazy" />}
                    <span>{t("deploy.connectedAs", { user: githubUser.login })}</span>
                  </a>
                  <button className="button secondary" type="button" onClick={() => loadRepositories(sourceProvider, false)} disabled={repoLoading}>
                    {repoLoading && <span className="spinner" />} {t("deploy.refreshRepos")}
                  </button>
                  <button className="button ghost" type="button" onClick={disconnectGitHub}>{t("deploy.disconnectGithub")}</button>
                </>
              ) : (
                <button className="button primary" type="button" onClick={connectGitHub}>
                  <Code2 size={16} /> {t("deploy.connectProvider", { provider: selectedSource.name })}
                </button>
              )}
            </div>
          </div>
          {githubUser && (
            <div className="repo-picker">
              <div className="repo-picker-head">
                <div>
                  <strong>{t("deploy.chooseRepository")}</strong>
                  <span>{t("deploy.chooseRepositoryCopy")}</span>
                </div>
                <span className="status-badge">{repoList.length}</span>
              </div>
              <Field label={t("deploy.repositorySearch")} id="repo-search">
                <input id="repo-search" className="input" value={repoSearch} onChange={(event) => setRepoSearch(event.target.value)} placeholder={t("deploy.repositorySearchPlaceholder")} />
              </Field>
              <div className="repo-list" role="list">
                {filteredRepos.map((item) => (
                  <button
                    className={`repo-option ${selectedRepoFullName === item.fullName ? "active" : ""}`}
                    type="button"
                    key={item.fullName}
                    onClick={() => selectRepository(item)}
                  >
                    <span>
                      <strong>{item.fullName}</strong>
                      <small>{item.description || t("deploy.noDescription")}</small>
                    </span>
                    <span className="repo-meta">
                      {item.private ? t("deploy.privateRepo") : t("deploy.publicRepo")}
                      {item.language ? ` / ${item.language}` : ""}
                      {item.stars ? ` / ${item.stars} stars` : ""}
                    </span>
                  </button>
                ))}
                {!filteredRepos.length && <div className="empty-repo-list">{t("deploy.noRepositories")}</div>}
              </div>
            </div>
          )}
          <Field label={t("deploy.manualRepoUrl")} id="deploy-repo">
            <input
              id="deploy-repo"
              className="input"
              value={repoUrl}
              onChange={(event) => {
                const value = event.target.value;
                const detectedProvider = detectProviderFromUrl(value);
                if (detectedProvider && detectedProvider !== sourceProvider) setSourceProvider(detectedProvider);
                setRepoUrl(value);
                setSelectedRepoFullName("");
                setRepo(null);
                setAnalysis(null);
              }}
              placeholder={sourceProvider === "gitlab" ? "https://gitlab.com/group/project" : "https://github.com/username/repo"}
              required
            />
          </Field>
          <div className="form-grid">
            <Field label="Branch" id="deploy-branch">
              <input id="deploy-branch" className="input" list="branch-options" value={branch} onChange={(event) => setBranch(event.target.value || "main")} />
            </Field>
            <Field label="Project name" id="deploy-name">
              <input id="deploy-name" className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <datalist id="branch-options">
              {branches.map((item) => <option key={item} value={item} />)}
            </datalist>
            <Field label="Custom domain label" id="deploy-domain">
              <input id="deploy-domain" className="input" value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="optional" />
            </Field>
            <Field label="Root directory" id="deploy-root">
              <input id="deploy-root" className="input" value={rootDir} onChange={(event) => setRootDir(event.target.value)} placeholder="apps/web" />
            </Field>
            <Field label="Build command" id="deploy-build">
              <input id="deploy-build" className="input" value={buildCommand} onChange={(event) => setBuildCommand(event.target.value)} placeholder="npm run build" />
            </Field>
            <Field label="Output directory" id="deploy-output">
              <input id="deploy-output" className="input" value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="dist" />
            </Field>
          </div>
          <div className="env-list">
            <div className="card-head"><h2>Environment variables</h2><Settings size={18} /></div>
            {envRows.map((row, index) => (
              <div className="env-row" key={index}>
                <input className="input" value={row.key} onChange={(event) => setEnvRows((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="KEY" />
                <input className="input" value={row.value} onChange={(event) => setEnvRows((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="value" />
                <button className="icon-button" type="button" aria-label="Remove environment variable" onClick={() => setEnvRows((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
              </div>
            ))}
            <button className="button secondary" type="button" onClick={() => setEnvRows((items) => [...items, { key: "", value: "" }])}>Add variable</button>
          </div>
          <div className="button-row">
            <button className="button secondary" type="button" onClick={analyze} disabled={!repoUrl || phase === "analyzing"}>{phase === "analyzing" && <span className="spinner" />} {t("deploy.analyze")}</button>
            <button className="button primary" type="button" onClick={deployNow} disabled={!repoUrl || !analysis || phase === "building" || phase === "deploying"}>{t("deploy.deployNow")} <Rocket size={16} /></button>
          </div>
          {error && <Alert type="error" message={error} />}
        </section>

        <section className="card analysis-card">
          <div className="card-head">
            <h2>Analysis</h2>
            <StatusBadge status={phase === "analyzing" ? "building" : analysis ? "live" : "queued"} />
          </div>
          {!analysis && <p className="muted">Analysis results appear here before deploy.</p>}
          <AnimatePresence>
            {analysisRows.map(([label, value], index) => (
              <motion.div className="analysis-row" key={label} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.06 }}>
                <span>{label}</span>
                <strong><Check size={16} /> {value}</strong>
              </motion.div>
            ))}
          </AnimatePresence>
          <ProgressBar value={progress} />
          <div className="log-box typewriter">
            {logs.map((log, index) => <div key={log.id || index} className={`log-line ${log.level}`}>[{log.level}] {log.message || log.line}</div>)}
          </div>
          {result && (
            <motion.div className="success-card" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="confetti" />
              <h3>Project is live</h3>
              <p>{publicProjectUrl(result)}</p>
              <button className="button secondary" onClick={() => copyText(publicProjectUrl(result))}><Copy size={16} /> Copy URL</button>
            </motion.div>
          )}
        </section>
      </div>
      <Modal open={limitModal} title="Project limit reached" onClose={() => setLimitModal(false)}>
        <p className="muted">You already have the maximum active deployments. Stop or delete a project to free a slot.</p>
        <Link className="button primary" to="/projects">Manage projects</Link>
      </Modal>
    </PageMotion>
  );
}

function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [envRows, setEnvRows] = useState([{ key: "NODE_ENV", value: "production" }]);
  const [commitSha, setCommitSha] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  async function load() {
    const data = await api<{ project: Project; deployment?: Deployment; deployments?: Deployment[]; logs: LogEntry[] }>(`/api/v1/projects/${id}`);
    setProject(data.project);
    setDeployment(data.deployment || null);
    setDeployments(data.deployments || []);
    setLogs(data.logs || []);
  }

  useEffect(() => { load().catch(() => null); }, [id]);
  useEffect(() => {
    if (!deployment?.id) return;
    const socket = io("/", { withCredentials: true });
    socket.emit("deploy:join", deployment.id);
    socket.on("deploy:log", (log: LogEntry) => setLogs((items) => [log, ...items].slice(0, 250)));
    return () => { socket.disconnect(); };
  }, [deployment?.id]);

  async function action(type: "stop" | "redeploy") {
    const data = await api<{ project: Project; deployment?: Deployment }>(`/api/v1/projects/${id}/${type}`, {
      method: "POST",
      body: type === "redeploy" ? JSON.stringify({ commitSha: commitSha.trim() || undefined }) : undefined
    });
    setProject(data.project);
    if (data.deployment) setDeployment(data.deployment);
    setMessage(type === "stop" ? "Project stopped." : "Project redeployed.");
    await load();
  }

  async function deleteProject() {
    await api(`/api/v1/projects/${id}`, { method: "DELETE" });
    navigate("/projects");
  }

  if (!project) return <LoadingScreen />;
  const liveUrl = publicProjectUrl(project);
  const openUrl = previewProjectUrl(project);

  return (
    <PageMotion>
      <PageTitle eyebrow={project.status} title={project.name} copy="Inspect URL, deployment metadata, environment settings, and deploy logs." />
      {message && <Toast message={message} onClose={() => setMessage("")} />}
      <div className="project-detail-grid">
        <section className="card">
          <div className="card-head">
            <h2>Live URL</h2>
            <StatusBadge status={project.status} />
          </div>
          <a className="url-box" href={liveUrl} target="_blank" rel="noreferrer">{liveUrl}</a>
          {project.previewUrl && project.previewUrl !== liveUrl && (
            <p className="muted">Local preview: {project.previewUrl}</p>
          )}
          <div className="button-row">
            <button className="button secondary" onClick={() => copyText(liveUrl)}><Copy size={16} /> Copy</button>
            <a className="button primary" href={openUrl} target="_blank" rel="noreferrer">Open <ArrowRight size={16} /></a>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Deployment info</h2><Server size={18} /></div>
          <InfoGrid rows={[
            ["Repository", project.repoUrl || "-"],
            ["Branch", project.branch || "main"],
            ["Last commit", project.lastCommitSha ? project.lastCommitSha.slice(0, 12) : "-"],
            ["Framework", project.framework || "Static"],
            ["Entry point", project.entryPoint || "index.html"],
            ["Build command", project.buildCommand || "none"],
            ["Output directory", project.outputDir || "."],
            ["Deploy time", deployment?.deployTimeMs ? `${deployment.deployTimeMs}ms` : "-"]
          ]} />
        </section>
        <section className="card">
          <div className="card-head"><h2>Environment variables</h2><Settings size={18} /></div>
          <div className="env-list">
            {envRows.map((row, index) => (
              <div className="env-row" key={`${row.key}-${index}`}>
                <input className="input" value={row.key} onChange={(event) => setEnvRows((rows) => rows.map((item, idx) => idx === index ? { ...item, key: event.target.value } : item))} />
                <input className="input" value={row.value} onChange={(event) => setEnvRows((rows) => rows.map((item, idx) => idx === index ? { ...item, value: event.target.value } : item))} />
              </div>
            ))}
            <button className="button secondary" onClick={() => setEnvRows([...envRows, { key: "", value: "" }])}>Add variable</button>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Actions</h2><Zap size={18} /></div>
          <div className="button-column">
            <Field label="Specific commit hash" id="redeploy-commit">
              <input id="redeploy-commit" className="input" value={commitSha} onChange={(event) => setCommitSha(event.target.value)} placeholder="optional" />
            </Field>
            <button className="button secondary" onClick={() => action("redeploy")}><RefreshCcw size={16} /> Redeploy</button>
            <button className="button secondary" onClick={() => action("stop")}><StopCircle size={16} /> Stop</button>
            <button className="button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>
          </div>
        </section>
      </div>
      <div className="two-col wide-left">
        <section className="card">
          <div className="card-head"><h2>Deploy logs</h2><SquareTerminal size={18} /></div>
          <div className="log-box">
            {logs.slice().reverse().map((log, index) => <div key={log.id || index} className={`log-line ${log.level}`}>[{log.level}] {log.message || log.line}</div>)}
            {!logs.length && <span className="muted">No logs yet.</span>}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Deploy history</h2><Database size={18} /></div>
          <div className="table compact">
            {deployments.map((item) => (
              <div className="table-row" key={item.id}>
                <span><StatusBadge status={item.status} /></span>
                <span>{formatDate(item.startedAt)}</span>
                <span>{item.deployTimeMs ? `${item.deployTimeMs}ms` : "-"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Modal open={confirmDelete} title="Delete project?" onClose={() => setConfirmDelete(false)}>
        <p className="muted">This removes the project and its deployment files from the server.</p>
        <button className="button danger" onClick={deleteProject}>Delete permanently</button>
      </Modal>
    </PageMotion>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function saveProfile() {
    const data = await api<{ user: User }>("/api/v1/profile", { method: "PATCH", body: JSON.stringify({ name, email }) });
    setUser(data.user);
    setMessage("Profile saved.");
  }

  async function changePassword() {
    await api("/api/v1/profile/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) });
    setCurrentPassword("");
    setNewPassword("");
    setMessage("Password changed.");
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    const body = new FormData();
    body.append("avatar", file);
    const data = await api<{ user: User }>("/api/v1/profile/avatar", { method: "POST", body });
    setUser(data.user);
    setMessage("Avatar uploaded.");
  }

  async function deleteAccount() {
    await api("/api/v1/profile", { method: "DELETE" });
    localStorage.removeItem("lp_access");
    localStorage.removeItem("lp_refresh");
    setUser(null);
    window.location.href = "/";
  }

  return (
    <PageMotion>
      <PageTitle eyebrow="Profile" title="Account settings." copy="Update identity, avatar, password, or delete the account with confirmation." />
      {message && <Toast message={message} onClose={() => setMessage("")} />}
      <div className="settings-grid">
        <section className="card">
          <div className="card-head"><h2>Profile</h2><User size={18} /></div>
          <div className="profile-avatar">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt={user.name} loading="lazy" /> : <User size={28} />}
            <label className="button secondary">
              Upload avatar
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => uploadAvatar(event.target.files?.[0])} />
            </label>
          </div>
          <Field label="Name" id="profile-name"><input className="input" id="profile-name" value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Email" id="profile-email"><input className="input" id="profile-email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <button className="button primary" onClick={saveProfile}>Save profile</button>
        </section>
        <section className="card">
          <div className="card-head"><h2>Security</h2><Lock size={18} /></div>
          <PasswordInput label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordInput label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <button className="button secondary" onClick={changePassword}>Change password</button>
          <div className="danger-zone">
            <strong>Delete account</strong>
            <p>This removes your account and all projects.</p>
            <button className="button danger" onClick={() => setDeleteOpen(true)}>Delete account</button>
          </div>
        </section>
      </div>
      <Modal open={deleteOpen} title="Delete account?" onClose={() => setDeleteOpen(false)}>
        <p className="muted">This action cannot be undone.</p>
        <button className="button danger" onClick={deleteAccount}>Delete my account</button>
      </Modal>
    </PageMotion>
  );
}

function AdminLogin() {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const { setAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setInterval(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{ admin: User; accessToken: string; refreshToken: string }>("/api/admin/login", {
        method: "POST",
        admin: true,
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem("lp_admin_access", data.accessToken);
      localStorage.setItem("lp_admin_refresh", data.refreshToken);
      setAdmin(data.admin);
      navigate("/dream/dashboard");
    } catch (err) {
      const apiError = err as Error & { retryAfterSeconds?: number };
      if (apiError.retryAfterSeconds) setRetryAfter(apiError.retryAfterSeconds);
      setError(t("auth.invalid"));
    } finally {
      setLoading(false);
    }
  }

  if (!armed) return <main className="admin-decoy" aria-hidden="true" />;

  return (
    <CenteredCardPage maxWidth={380}>
      <form className="form-stack" onSubmit={submit}>
        <div className="admin-login-head">
          <div className="logo static-logo">
            <span className="logo-mark"><Shield size={18} /></span>
            <span>{BRAND_NAME}</span>
          </div>
          <h1 className="sr-only">{t("auth.secureAccess")}</h1>
        </div>
        <Field label={t("auth.name")} id="admin-username">
          <input id="admin-username" className="input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </Field>
        <Field label={t("auth.password")} id="admin-password">
          <div className="password-wrap">
            <input id="admin-password" className="input" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            <button className="icon-button" type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </Field>
        {error && <Alert type="error" message={error} />}
        {retryAfter > 0 && <Alert type="warn" message={t("auth.locked", { time: `${Math.ceil(retryAfter / 60)}m ${retryAfter % 60}s` })} />}
        <button className="button primary full" disabled={loading || retryAfter > 0}>{loading && <span className="spinner" />} {t("nav.login")}</button>
      </form>
    </CenteredCardPage>
  );
}

function AdminProtected({ children }: { children: ReactNode }) {
  const { admin, setAdmin } = useAuth();
  const [checking, setChecking] = useState(!admin);

  useEffect(() => {
    if (admin) return;
    api<{ admin: User }>("/api/admin/me", { admin: true })
      .then((data) => setAdmin(data.admin))
      .catch(() => null)
      .finally(() => setChecking(false));
  }, [admin, setAdmin]);

  if (checking) return <LoadingScreen />;
  return admin ? <>{children}</> : <Navigate to="/404" replace />;
}

function AdminLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { setAdmin } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  async function logout() {
    await api("/api/admin/logout", { method: "POST", admin: true }).catch(() => null);
    localStorage.removeItem("lp_admin_access");
    localStorage.removeItem("lp_admin_refresh");
    setAdmin(null);
    navigate("/dream");
  }

  return (
    <div className={`admin-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <Shield size={20} />
          {!collapsed && <span>Dream Admin</span>}
          <button className="icon-button" onClick={() => setCollapsed(!collapsed)}><Menu size={16} /></button>
        </div>
        <nav>
          {adminLinks.map((link) => {
            const Icon = link.icon;
            const active = location.pathname === link.to;
            return (
              <Link className={active ? "active" : ""} to={link.to} key={link.to}>
                <Icon size={18} />
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <span className="badge">Admin</span>
          <LanguageSwitcher />
          <ThemeToggle />
          <button className="button secondary" onClick={logout}><LogOut size={16} /> {t("nav.logout")}</button>
        </header>
        {children}
      </main>
    </div>
  );
}

function AdminDashboard() {
  const [data, setData] = useState<{
    overview: { users: number; deployments: number; activeDeployments: number; failedToday?: number; deploymentsPerDay: { label: string; count: number }[]; newUsersPerWeek: { label: string; count: number }[] };
    resources: { cpu: number; ram: number; disk: number; websocketConnections: number };
    activity: AdminLog[];
    queue: { waiting: number; active: number; completed: number };
  } | null>(null);

  useEffect(() => { api<typeof data>("/api/admin/overview", { admin: true }).then(setData).catch(() => null); }, []);
  if (!data) return <AdminSkeleton />;

  return (
    <PageMotion>
      <PageTitle eyebrow="Admin overview" title="Platform control room." copy="Users, deployments, server resource usage, queue status, and audit activity." />
      <div className="stats-grid">
        <CounterCard label="Total users" value={data.overview.users} />
        <CounterCard label="Total deployments" value={data.overview.deployments} />
        <CounterCard label="Active now" value={data.overview.activeDeployments} />
        <CounterCard label="Failed today" value={data.overview.failedToday || 0} />
      </div>
      <div className="admin-dashboard-grid">
        <section className="card chart-card">
          <div className="card-head"><h2>Deployments per day</h2><Activity size={18} /></div>
          <Suspense fallback={<SkeletonCard />}>
            <ChartLine rows={data.overview.deploymentsPerDay} />
          </Suspense>
        </section>
        <section className="card chart-card">
          <div className="card-head"><h2>New users per week</h2><Users size={18} /></div>
          <Suspense fallback={<SkeletonCard />}>
            <ChartBar rows={data.overview.newUsersPerWeek} />
          </Suspense>
        </section>
        <section className="card resource-card">
          <div className="card-head"><h2>Server resources</h2><Cpu size={18} /></div>
          <div className="gauge-grid">
            <CircularGauge label="CPU" value={data.resources.cpu} />
            <CircularGauge label="RAM" value={data.resources.ram} />
            <CircularGauge label="Disk" value={data.resources.disk} />
          </div>
          <p className="muted">{data.resources.websocketConnections} websocket connections</p>
        </section>
        <section className="card">
          <div className="card-head"><h2>Recent activity</h2><SquareTerminal size={18} /></div>
          <div className="activity-list">
            {data.activity.slice(0, 10).map((log) => (
              <div className="activity-item" key={log.id}>
                <span className="status-dot live" />
                <div><strong>{log.action}</strong><small>{formatDate(log.createdAt)} - {log.ip || "local"}</small></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageMotion>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<{ user: User; projects: Project[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [toast, setToast] = useState("");

  async function load(nextPage = page) {
    const params = new URLSearchParams({ page: String(nextPage), limit: "20" });
    if (search) params.set("search", search);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    const data = await api<{ items: User[]; total: number }>(`/api/admin/users?${params.toString()}`, { admin: true });
    setUsers(data.items);
    setTotal(data.total);
    setPage(nextPage);
  }

  useEffect(() => { load(1).catch(() => null); }, []);

  async function view(user: User) {
    const data = await api<{ user: User; projects: Project[] }>(`/api/admin/users/${user.id}`, { admin: true });
    setSelected(data);
  }

  async function patch(user: User, body: Record<string, unknown>) {
    await api(`/api/admin/users/${user.id}`, { method: "PATCH", admin: true, body: JSON.stringify(body) });
    setToast("User updated.");
    await load();
  }

  async function resetPassword(user: User) {
    const password = window.prompt("New password for this user");
    if (!password) return;
    await api(`/api/admin/users/${user.id}/reset-password`, { method: "POST", admin: true, body: JSON.stringify({ password }) });
    setToast("Password reset.");
  }

  async function impersonate(user: User) {
    const data = await api<{ user: User; accessToken: string }>(`/api/admin/users/${user.id}/impersonate`, { method: "POST", admin: true });
    localStorage.setItem("lp_access", data.accessToken);
    window.location.href = "/dashboard";
  }

  async function deleteUser() {
    if (!confirmDelete) return;
    await api(`/api/admin/users/${confirmDelete.id}`, { method: "DELETE", admin: true });
    setConfirmDelete(null);
    setToast("User deleted.");
    await load();
  }

  return (
    <PageMotion>
      <PageTitle eyebrow="Users" title="User management." copy="Search, filter, ban, reset, impersonate, or delete users with audit logs." />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <AdminFilterBar search={search} setSearch={setSearch} onFilter={() => load(1)}>
        <select className="input" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">All roles</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
        </select>
      </AdminFilterBar>
      <section className="card table-card">
        <div className="table users-table">
          <div className="table-row table-head">
            <span>User</span><span>Role</span><span>Projects</span><span>Joined</span><span>Status</span><span>Actions</span>
          </div>
          {users.map((user) => (
            <div className="table-row" key={user.id}>
              <span className="user-cell">{user.avatarUrl ? <img src={user.avatarUrl} alt={user.name} loading="lazy" /> : <User size={18} />}<span><strong>{user.name}</strong><small>{user.email}</small></span></span>
              <span>{user.role}</span>
              <span>{user.projectsCount || 0}</span>
              <span>{formatDate(user.createdAt)}</span>
              <span><StatusBadge status={user.banned ? "banned" : "active"} /></span>
              <span className="table-actions">
                <button onClick={() => view(user)}>View</button>
                <button onClick={() => patch(user, { banned: !user.banned })}>{user.banned ? "Unban" : "Ban"}</button>
                <button onClick={() => patch(user, { role: user.role === "admin" ? "user" : "admin" })}>Role</button>
                <button onClick={() => resetPassword(user)}>Reset</button>
                <button onClick={() => impersonate(user)}>Impersonate</button>
                <button className="danger-text" onClick={() => setConfirmDelete(user)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
        <Pagination page={page} total={total} pageSize={20} onPage={load} />
      </section>
      <Modal open={Boolean(selected)} title="User profile" onClose={() => setSelected(null)}>
        {selected && (
          <div className="modal-stack">
            <InfoGrid rows={[["Name", selected.user.name], ["Email", selected.user.email], ["Role", selected.user.role], ["Projects", String(selected.projects.length)]]} />
            <div className="project-list compact-list">
              {selected.projects.map((project) => <ProjectListCard key={project.id} project={project} />)}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={Boolean(confirmDelete)} title="Delete user?" onClose={() => setConfirmDelete(null)}>
        <p className="muted">This deletes the user and every project they own.</p>
        <button className="button danger" onClick={deleteUser}>Delete user</button>
      </Modal>
    </PageMotion>
  );
}

function AdminProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [framework, setFramework] = useState("");
  const [owner, setOwner] = useState("");
  const [logModal, setLogModal] = useState<{ project: Project; logs: LogEntry[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [toast, setToast] = useState("");

  async function load() {
    const params = new URLSearchParams({ limit: "100" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ items: Project[] }>(`/api/admin/projects?${params.toString()}`, { admin: true });
    let items = data.items;
    if (framework) items = items.filter((project) => (project.framework || "").toLowerCase().includes(framework.toLowerCase()));
    if (owner) items = items.filter((project) => `${project.userName || ""} ${project.userEmail || ""}`.toLowerCase().includes(owner.toLowerCase()));
    setProjects(items);
  }

  useEffect(() => { load().catch(() => null); }, []);

  async function projectAction(project: Project, action: "stop" | "restart" | "redeploy" | "delete") {
    const method = action === "delete" ? "DELETE" : "POST";
    const suffix = action === "delete" ? "" : `/${action}`;
    await api(`/api/admin/projects/${project.id}${suffix}`, { method, admin: true });
    setToast(`Project ${action} complete.`);
    await load();
  }

  async function viewLogs(project: Project) {
    const data = await api<{ logs: LogEntry[] }>(`/api/admin/projects/${project.id}/logs`, { admin: true });
    setLogModal({ project, logs: data.logs });
  }

  return (
    <PageMotion>
      <PageTitle eyebrow="Projects" title="Deployment management." copy="Filter all deployments, view logs, stop, restart, delete, or force redeploy." />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <AdminFilterBar search={search} setSearch={setSearch} onFilter={load}>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="building">Building</option>
          <option value="live">Live</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>
        <input className="input" value={framework} onChange={(event) => setFramework(event.target.value)} placeholder="Framework" />
        <input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Owner" />
      </AdminFilterBar>
      <section className="card table-card">
        <div className="table projects-table">
          <div className="table-row table-head"><span>Project</span><span>Owner</span><span>Framework</span><span>Status</span><span>URL</span><span>Actions</span></div>
          {projects.map((project) => (
            <div className="table-row" key={project.id}>
              <span><strong>{project.name}</strong><small>{formatDate(project.createdAt)}</small></span>
              <span>{project.userName || project.userEmail || "-"}</span>
              <span>{project.framework || "Static"}</span>
              <span><StatusBadge status={project.status} /></span>
              <span className="url-cell"><a href={project.url} target="_blank" rel="noreferrer">{project.url}</a></span>
              <span className="table-actions">
                <button onClick={() => viewLogs(project)}>Logs</button>
                <button onClick={() => projectAction(project, "stop")}>Stop</button>
                <button onClick={() => projectAction(project, "restart")}>Restart</button>
                <button onClick={() => projectAction(project, "redeploy")}>Redeploy</button>
                <button className="danger-text" onClick={() => setConfirmDelete(project)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      </section>
      <Modal open={Boolean(logModal)} title={logModal?.project.name || "Deploy logs"} onClose={() => setLogModal(null)}>
        <div className="log-box tall">
          {logModal?.logs.map((log, index) => <div className={`log-line ${log.level}`} key={log.id || index}>[{log.level}] {log.message || log.line}</div>)}
        </div>
      </Modal>
      <Modal open={Boolean(confirmDelete)} title="Delete deployment?" onClose={() => setConfirmDelete(null)}>
        <p className="muted">This removes the deployment files and project record.</p>
        <button className="button danger" onClick={() => confirmDelete && projectAction(confirmDelete, "delete").then(() => setConfirmDelete(null))}>Delete project</button>
      </Modal>
    </PageMotion>
  );
}

function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [toast, setToast] = useState("");

  useEffect(() => {
    api<{ settings: Record<string, unknown> }>("/api/admin/settings", { admin: true })
      .then((data) => setSettings(data.settings))
      .catch(() => null);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const data = await api<{ settings: Record<string, unknown> }>("/api/admin/settings", { method: "PATCH", admin: true, body: JSON.stringify(patch) });
    setSettings(data.settings);
    setToast("Settings saved.");
  }

  async function changePassword() {
    await api("/api/admin/password", { method: "POST", admin: true, body: JSON.stringify(passwords) });
    setPasswords({ currentPassword: "", newPassword: "" });
    setToast("Admin password changed.");
  }

  return (
    <PageMotion>
      <PageTitle eyebrow="Settings" title="Platform settings." copy="White-label the site, tune deploy limits, SMTP, maintenance, and admin credentials." />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <div className="settings-grid">
        <section className="card settings-section">
          <div className="card-head"><h2>General</h2><Globe2 size={18} /></div>
          <Field label="Site name" id="site-name"><input className="input" id="site-name" value={String(settings.siteName || "")} onChange={(event) => setSettings({ ...settings, siteName: event.target.value })} /></Field>
          <Field label="Logo URL" id="logo-url"><input className="input" id="logo-url" value={String(settings.logoUrl || "")} onChange={(event) => setSettings({ ...settings, logoUrl: event.target.value })} /></Field>
          <Field label="Favicon URL" id="favicon-url"><input className="input" id="favicon-url" value={String(settings.faviconUrl || "")} onChange={(event) => setSettings({ ...settings, faviconUrl: event.target.value })} /></Field>
          <button className="button primary" onClick={() => save({ siteName: settings.siteName, logoUrl: settings.logoUrl, faviconUrl: settings.faviconUrl })}>Save general</button>
        </section>
        <section className="card settings-section">
          <div className="card-head"><h2>Deployment</h2><Rocket size={18} /></div>
          <NumberField label="Max projects per user" value={Number(settings.deploymentLimit || 3)} onChange={(value) => setSettings({ ...settings, deploymentLimit: value })} />
          <Field label="Repository source" id="repository-source">
            <input className="input" id="repository-source" value="GitHub and GitLab repositories" disabled />
          </Field>
          <NumberField label="Max build time seconds" value={Number(settings.maxBuildTimeSeconds || 120)} onChange={(value) => setSettings({ ...settings, maxBuildTimeSeconds: value })} />
          <button className="button primary" onClick={() => save({ deploymentLimit: settings.deploymentLimit, maxBuildTimeSeconds: settings.maxBuildTimeSeconds })}>Save deployment</button>
        </section>
        <section className="card settings-section">
          <div className="card-head"><h2>Maintenance</h2><Shield size={18} /></div>
          <Alert type="warn" message="When enabled, non-admin pages show the maintenance page." />
          <label className="switch-row">
            <input type="checkbox" checked={Boolean(settings.maintenanceMode)} onChange={(event) => setSettings({ ...settings, maintenanceMode: event.target.checked })} />
            <span>Maintenance mode</span>
          </label>
          <button className="button primary" onClick={() => save({ maintenanceMode: settings.maintenanceMode })}>Save maintenance</button>
        </section>
        <section className="card settings-section">
          <div className="card-head"><h2>Email / SMTP</h2><Mail size={18} /></div>
          <Field label="SMTP host" id="smtp-host"><input className="input" id="smtp-host" value={String((settings.smtp as Record<string, unknown> | undefined)?.host || "")} onChange={(event) => setSettings({ ...settings, smtp: { ...(settings.smtp as Record<string, unknown> || {}), host: event.target.value } })} /></Field>
          <Field label="SMTP user" id="smtp-user"><input className="input" id="smtp-user" value={String((settings.smtp as Record<string, unknown> | undefined)?.user || "")} onChange={(event) => setSettings({ ...settings, smtp: { ...(settings.smtp as Record<string, unknown> || {}), user: event.target.value } })} /></Field>
          <Field label="SMTP from" id="smtp-from"><input className="input" id="smtp-from" value={String((settings.smtp as Record<string, unknown> | undefined)?.from || "")} onChange={(event) => setSettings({ ...settings, smtp: { ...(settings.smtp as Record<string, unknown> || {}), from: event.target.value } })} /></Field>
          <button className="button primary" onClick={() => save({ smtp: settings.smtp })}>Save SMTP</button>
        </section>
        <section className="card settings-section">
          <div className="card-head"><h2>Admin password</h2><Lock size={18} /></div>
          <PasswordInput label="Current admin password" value={passwords.currentPassword} onChange={(value) => setPasswords({ ...passwords, currentPassword: value })} />
          <PasswordInput label="New admin password" value={passwords.newPassword} onChange={(value) => setPasswords({ ...passwords, newPassword: value })} />
          <button className="button secondary" onClick={changePassword}>Change password</button>
        </section>
      </div>
    </PageMotion>
  );
}

function AdminLogs() {
  const [data, setData] = useState<{ adminLogs: AdminLog[]; serverLog: string[]; errorLog: string[]; websocketConnections: number } | null>(null);
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const response = await api<{ adminLogs: AdminLog[]; serverLog: string[]; errorLog: string[]; websocketConnections: number }>("/api/admin/logs", { admin: true });
    setData(response);
  }

  useEffect(() => {
    load().catch(() => null);
    const socket = io("/", { withCredentials: true });
    const timer = window.setInterval(() => load().catch(() => null), 5000);
    return () => { socket.disconnect(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data, autoScroll]);

  if (!data) return <AdminSkeleton />;

  const serverLines = [
    ...data.serverLog.map((line) => ({ level: "info", line })),
    ...data.errorLog.map((line) => ({ level: "error", line }))
  ].filter((item) => (!level || item.level === level) && item.line.toLowerCase().includes(search.toLowerCase()));

  return (
    <PageMotion>
      <PageTitle eyebrow="Logs" title="System monitoring." copy="Filter structured admin logs and server output. Viewer auto-refreshes and tracks websocket count." />
      <div className="filter-bar card">
        <select className="input" value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs" />
        <label className="check-row"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label>
        <button className="button secondary" onClick={() => setData({ ...data, serverLog: [], errorLog: [] })}>Clear viewer</button>
      </div>
      <div className="two-col wide-left">
        <section className="card">
          <div className="card-head"><h2>System logs</h2><span className="badge">{data.websocketConnections} sockets</span></div>
          <div className="log-box tall" ref={logRef}>
            {serverLines.map((item, index) => <div key={index} className={`log-line ${item.level}`}>[{item.level}] {item.line}</div>)}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Admin audit</h2><Shield size={18} /></div>
          <div className="activity-list">
            {data.adminLogs.map((log) => (
              <div className="activity-item" key={log.id}>
                <span className="status-dot live" />
                <div><strong>{log.action}</strong><small>{formatDate(log.createdAt)} - {log.ip || "local"}</small></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageMotion>
  );
}

function AdminNotifications() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [emailBlast, setEmailBlast] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toast, setToast] = useState("");

  async function load() {
    const data = await api<{ notifications: NotificationItem[] }>("/api/admin/notifications", { admin: true });
    setItems(data.notifications || []);
  }

  useEffect(() => { load().catch(() => null); }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    await api("/api/admin/notifications", { method: "POST", admin: true, body: JSON.stringify({ title, message, emailBlast }) });
    setTitle("");
    setMessage("");
    setEmailBlast(false);
    setToast("Announcement sent.");
    await load();
  }

  return (
    <PageMotion>
      <PageTitle eyebrow="Notifications" title="Announcements and email blasts." copy="Send a banner to all users and optionally email it through configured SMTP." />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <div className="two-col">
        <form className="card form-stack" onSubmit={send}>
          <Field label="Subject" id="notice-title"><input className="input" id="notice-title" value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>
          <Field label="Message" id="notice-message"><textarea className="input textarea" id="notice-message" value={message} onChange={(event) => setMessage(event.target.value)} required /></Field>
          <label className="check-row"><input type="checkbox" checked={emailBlast} onChange={(event) => setEmailBlast(event.target.checked)} /> Email blast to users</label>
          <button className="button primary">Send announcement</button>
        </form>
        <section className="card">
          <div className="card-head"><h2>History</h2><Bell size={18} /></div>
          <div className="activity-list">
            {items.map((item) => (
              <div className="activity-item" key={item.id}>
                <span className="status-dot live" />
                <div><strong>{item.title}</strong><small>{item.message} - {formatDate(item.createdAt)}</small></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageMotion>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <CenteredCardPage maxWidth={420} footer={<Link to="/">Return home</Link>} showBrand>
      <div className="center-copy">
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
          <Sparkles size={32} />
        </motion.div>
        <h1>404</h1>
        <p>{t("errors.notFound")}</p>
      </div>
    </CenteredCardPage>
  );
}

function MaintenancePage() {
  const { t } = useTranslation();
  return (
    <CenteredCardPage maxWidth={420} showBrand>
      <div className="center-copy">
        <Server size={32} />
        <h1>Maintenance</h1>
        <p>{t("errors.maintenance")}</p>
      </div>
    </CenteredCardPage>
  );
}

function PageTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="page-title">
      <span className="badge">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
}

function CounterCard({ label, value, suffix = "", decimals = 0 }: { label: string; value: number; suffix?: string; decimals?: number }) {
  return (
    <div className="card stat-card">
      <strong><CountUp value={value} decimals={decimals} />{suffix}</strong>
      <span>{label}</span>
    </div>
  );
}

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let frame = 0;
    const totalFrames = 28;
    const start = display;
    const diff = value - start;
    const tick = () => {
      frame += 1;
      setDisplay(start + diff * Math.min(frame / totalFrames, 1));
      if (frame < totalFrames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(display)}</>;
}

function StatusBadge({ status }: { status: string }) {
  const safe = status || "queued";
  return <span className={`status-badge ${safe}`}><span /> {safe}</span>;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-wrap">
      <div className="progress-label"><span>Progress</span><strong>{Math.round(value)}%</strong></div>
      <div className="progress"><motion.div animate={{ width: `${value}%` }} transition={{ duration: 0.25 }} /></div>
    </div>
  );
}

function Alert({ type, message }: { type: "success" | "error" | "warn"; message: string }) {
  return <div className={`alert ${type}`}>{message}</div>;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <motion.div className="toast" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}>
      <Check size={16} />
      <span>{message}</span>
      <button onClick={onClose}><X size={14} /></button>
    </motion.div>
  );
}

function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className="card modal-card" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}>
            <div className="card-head">
              <h2>{title}</h2>
              <button className="icon-button" onClick={onClose}><X size={16} /></button>
            </div>
            {children}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="info-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function AdminFilterBar({ search, setSearch, onFilter, children }: { search: string; setSearch: (value: string) => void; onFilter: () => void; children?: ReactNode }) {
  return (
    <div className="filter-bar card">
      <div className="input-icon"><Search size={16} /><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></div>
      {children}
      <button className="button secondary" onClick={onFilter}><ListFilter size={16} /> Filter</button>
    </div>
  );
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <button className="button secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="button secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <Field label={label} id={id}>
      <input className="input" id={id} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}

function CircularGauge({ label, value }: { label: string; value: number }) {
  return (
    <div className="gauge" style={{ "--value": `${Math.max(0, Math.min(value, 100)) * 3.6}deg` } as React.CSSProperties}>
      <div><strong>{value}%</strong><span>{label}</span></div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="card skeleton-card">
      <div className="skeleton-line wide" />
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}

function AdminSkeleton() {
  return (
    <div className="content-space">
      <SkeletonCard />
      <div className="stats-grid"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    </div>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="card empty-state">
      <CloudUpload size={28} />
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(currentLocale(), { year: "numeric", month: "short", day: "2-digit" }).format(new Date(value));
}

function currentLocale() {
  return i18n.resolvedLanguage || i18n.language || localStorage.getItem("dreamx_lang") || navigator.language || "en";
}

function copyText(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value).catch(() => null);
}

function publicProjectUrl(project?: Project | null) {
  return project?.productionUrl || project?.url || "";
}

function previewProjectUrl(project?: Project | null) {
  return project?.previewUrl || project?.url || publicProjectUrl(project);
}

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } }
};

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 }
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

const featureSpecs: { key: string; icon: LucideIcon }[] = [
  { key: "login", icon: Lock },
  { key: "github", icon: Code2 },
  { key: "logs", icon: SquareTerminal },
  { key: "urls", icon: Globe2 },
  { key: "admin", icon: Shield },
  { key: "server", icon: Server }
];

function getFeatureCards(t: Translate) {
  return featureSpecs.map((feature) => ({
    title: t(`landing.features.${feature.key}.title`),
    copy: t(`landing.features.${feature.key}.copy`),
    icon: feature.icon
  }));
}

function getWorkflowSteps(t: Translate) {
  return ["connect", "analyze", "publish"].map((key) => ({
    title: t(`landing.workflowSteps.${key}.title`),
    copy: t(`landing.workflowSteps.${key}.copy`)
  }));
}

function getPricingTiers(t: Translate) {
  return ["free", "pro", "enterprise"].map((key) => ({
    name: t(`landing.pricing.${key}.name`),
    price: t(`landing.pricing.${key}.price`),
    copy: t(`landing.pricing.${key}.copy`),
    items: [0, 1, 2].map((index) => t(`landing.pricing.${key}.items.${index}`))
  }));
}

function getTestimonials(t: Translate) {
  return ["ayla", "tural", "studio"].map((key) => ({
    name: t(`landing.testimonialItems.${key}.name`),
    quote: t(`landing.testimonialItems.${key}.quote`)
  }));
}

function getComparisonRows(t: Translate) {
  return ["github", "login", "selfHosted", "limits"].map((key) => ({
    capability: t(`landing.comparisonRows.${key}.capability`),
    dreamx: t(`landing.comparisonRows.${key}.dreamx`),
    other: t(`landing.comparisonRows.${key}.other`)
  }));
}

function getFaqItems(t: Translate) {
  return ["login", "subdomains", "postgres", "https", "frameworks", "privateRepos", "limits", "logs", "domains"].map((key) => ({
    q: t(`landing.faqItems.${key}.q`),
    a: t(`landing.faqItems.${key}.a`)
  }));
}

function getPipelineSteps(t: Translate) {
  return ["connect", "analyze", "build", "publish"].map((key) => t(`landing.pipeline.${key}`));
}

const adminLinks: { label: string; to: string; icon: LucideIcon }[] = [
  { label: "Dashboard", to: "/dream/dashboard", icon: LayoutDashboard },
  { label: "Users", to: "/dream/users", icon: Users },
  { label: "Projects", to: "/dream/projects", icon: Rocket },
  { label: "Settings", to: "/dream/settings", icon: Settings },
  { label: "Logs", to: "/dream/logs", icon: SquareTerminal },
  { label: "Notifications", to: "/dream/notifications", icon: Bell }
];

export default App;
