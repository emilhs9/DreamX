CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  avatar_url TEXT,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  plan TEXT NOT NULL DEFAULT 'free',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token_hash TEXT,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  github_access_token_encrypted TEXT,
  github_login TEXT,
  github_avatar_url TEXT,
  github_connected_at TIMESTAMPTZ,
  source_connections JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'user',
  user_agent TEXT,
  ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  framework TEXT NOT NULL DEFAULT 'Static',
  status TEXT NOT NULL DEFAULT 'building',
  url TEXT,
  build_command TEXT,
  output_dir TEXT,
  custom_domain TEXT,
  entry_point TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  deploy_path TEXT,
  runtime_port INTEGER,
  source_type TEXT NOT NULL DEFAULT 'github',
  repo_url TEXT,
  repo_owner TEXT,
  repo_name TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  root_dir TEXT,
  github_token_encrypted TEXT,
  github_webhook_secret TEXT,
  env_vars JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_commit_sha TEXT,
  last_commit_message TEXT,
  repo_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'building',
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  framework TEXT,
  build_command TEXT,
  entry_point TEXT,
  source_repo TEXT,
  branch TEXT,
  commit_sha TEXT,
  output_dir TEXT,
  url TEXT,
  deploy_time_ms INTEGER
);

CREATE TABLE IF NOT EXISTS deploy_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
  line TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_access_token_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS source_connections JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE projects ADD COLUMN IF NOT EXISTS framework TEXT NOT NULL DEFAULT 'Static';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'building';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_command TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS output_dir TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS entry_point TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deploy_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS runtime_port INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'github';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_owner TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS root_dir TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_token_encrypted TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_webhook_secret TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS env_vars JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_commit_sha TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_commit_message TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS triggered_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS framework TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_command TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS entry_point TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS source_repo TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS commit_sha TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS output_dir TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deploy_time_ms INTEGER;

ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS line TEXT;
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE admin_logs ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE admin_logs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployments(user_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_started_at ON deployments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_deployment_id ON deploy_logs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_created_at ON deploy_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);
