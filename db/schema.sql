-- SQLite schema (api/data/neurolaudos.db). Applied automatically by the API on startup.
-- Timestamps are ISO-8601 UTC strings; dates are 'YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','psychologist','assistant')),
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS patients(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS evaluations(
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','review','approved')),
  approved_by TEXT NULL,
  approved_at TEXT NULL,
  privacy_json TEXT NULL,
  instructions_json TEXT NULL,
  work_seconds INTEGER NOT NULL DEFAULT 0,
  work_started_at TEXT NULL,
  sex TEXT NULL,
  schooling TEXT NULL,
  start_date TEXT NULL,
  end_date TEXT NULL,
  model_id TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  kind TEXT NOT NULL CHECK(kind IN ('base','anamnesis','export')),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  extracted_json TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS sections(
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'generated' CHECK(status IN ('generated','edited','approved')),
  source_summary TEXT,
  version INTEGER DEFAULT 1,
  approved_by TEXT NULL,
  approved_at TEXT NULL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(evaluation_id,section_key)
);
CREATE TABLE IF NOT EXISTS section_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL REFERENCES sections(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS prompt_templates(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ai_settings(
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  enabled INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
INSERT OR IGNORE INTO ai_settings(id,model,enabled) VALUES(1,'gpt-4.1',0);
CREATE TABLE IF NOT EXISTS ai_usage(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id TEXT,
  section_key TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  usd_brl REAL NOT NULL DEFAULT 0,
  actor_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_usage_eval ON ai_usage(evaluation_id);
CREATE INDEX IF NOT EXISTS ix_usage_created ON ai_usage(created_at);
CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  evaluation_id TEXT,
  action TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- Report models: blank base documents (no patient data) kept as versioned, encrypted files.
CREATE TABLE IF NOT EXISTS report_models(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'geral' CHECK(audience IN ('infantil','adulto','idoso','geral')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  instructions_json TEXT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS report_model_versions(
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES report_models(id),
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  report_json TEXT NOT NULL,
  structure_json TEXT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(model_id,version)
);
