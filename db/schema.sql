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
  totp_secret TEXT NULL,
  totp_pending TEXT NULL,
  totp_enabled_at TEXT NULL,
  totp_last_step INTEGER NULL,
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
  submitted_at TEXT NULL,
  submitted_by TEXT NULL,
  consent_care_at TEXT NULL,
  consent_ai_at TEXT NULL,
  ai_mode TEXT NOT NULL DEFAULT 'ai',
  place_date TEXT NULL,
  created_sections TEXT NULL,
  consent_by TEXT NULL,
  consent_note TEXT NULL,
  delivered_at TEXT NULL,
  delivered_to TEXT NULL,
  delivery_mode TEXT NULL,
  delivered_by TEXT NULL,
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
  ai_text TEXT NULL,
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
-- Review workflow: correction requests from the psychologist to whoever prepared the files (and replies).
CREATE TABLE IF NOT EXISTS review_notes(
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  author_id TEXT,
  text TEXT NOT NULL,
  resolved_at TEXT NULL,
  resolved_by TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_notes_eval ON review_notes(evaluation_id);
-- Standard texts of the clinic (recommendations, referrals...), inserted by hand in the editor. Never patient data.
CREATE TABLE IF NOT EXISTS text_snippets(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  section_key TEXT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- "Esqueci minha senha": there is no e-mail service, so the request goes to the administrator (Configurações > Usuários).
CREATE TABLE IF NOT EXISTS password_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  handled_at TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- Devolutiva: plain-language letter for the family/patient, written from the approved report. Separate from the report DOCX.
CREATE TABLE IF NOT EXISTS devolutivas(
  evaluation_id TEXT PRIMARY KEY REFERENCES evaluations(id),
  audience TEXT NOT NULL DEFAULT 'familia' CHECK(audience IN ('familia','paciente')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
  warnings_json TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT NULL,
  approved_at TEXT NULL,
  updated_by TEXT NULL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS devolutiva_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- Assessment plan (instruments to apply) and sessions of each evaluation.
CREATE TABLE IF NOT EXISTS evaluation_sessions(
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  date TEXT NOT NULL,
  time TEXT NULL,
  kind TEXT NOT NULL DEFAULT 'aplicacao' CHECK(kind IN ('anamnese','aplicacao','devolutiva','outra')),
  note TEXT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sessions_date ON evaluation_sessions(date);
CREATE TABLE IF NOT EXISTS evaluation_plan(
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  instrument TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','applied','not_applied')),
  session_id TEXT NULL,
  note TEXT NULL,
  applied_at TEXT NULL,
  applied_by TEXT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- The clinic's own version of an instrument guide sent to the AI (default ones live in api/src/prompts.mjs).
CREATE TABLE IF NOT EXISTS instrument_guides(
  id TEXT PRIMARY KEY,
  guide TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'ok',
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
CREATE INDEX IF NOT EXISTS ix_audit_eval ON audit_logs(evaluation_id);
CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_logs(actor_id,created_at);
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
-- Anamnesis written in ChatGPT (MCP plugin or copy and paste). The task holds no copy of the anamnesis file: the
-- notes are read from the encrypted DOCX when the plugin asks for them. received_text is cleared by the hourly sweep.
CREATE TABLE IF NOT EXISTS chatgpt_tasks(
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  section_key TEXT NOT NULL DEFAULT 'anamnesis',
  mode TEXT NOT NULL CHECK(mode IN ('mcp','paste')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','draft_received','reviewed','error','expired','discarded')),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  fetched_at TEXT NULL,
  received_at TEXT NULL,
  received_via TEXT NULL,
  received_text TEXT NULL,
  op_id TEXT NULL,
  applied_at TEXT NULL,
  applied_by TEXT NULL,
  applied_version INTEGER NULL,
  error TEXT NULL,
  notes TEXT NULL,
  include_images INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS chatgpt_tasks_eval ON chatgpt_tasks(evaluation_id,created_by);
-- OAuth for the MCP plugin: only hashes of codes and tokens are stored.
CREATE TABLE IF NOT EXISTS oauth_clients(
  client_id TEXT PRIMARY KEY,
  client_name TEXT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS oauth_requests(
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS oauth_codes(
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens(
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
