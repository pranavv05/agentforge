CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS specs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  case_type TEXT NOT NULL DEFAULT 'A',
  repo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'CREATED',
  version INTEGER NOT NULL DEFAULT 1,
  profile TEXT NOT NULL DEFAULT 'demo',
  cap_usd REAL NOT NULL DEFAULT 2.0,
  inject_flaws INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_specs_user ON specs(user_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (spec_id, type, version),
  FOREIGN KEY (spec_id) REFERENCES specs(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  approver TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spec_id) REFERENCES specs(id)
);
CREATE INDEX IF NOT EXISTS idx_approvals_spec ON approvals(spec_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spec_id) REFERENCES specs(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_spec ON audit_log(spec_id);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  simulated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spec_id) REFERENCES specs(id)
);
CREATE INDEX IF NOT EXISTS idx_calls_spec ON llm_calls(spec_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  req_ids TEXT NOT NULL DEFAULT '',
  test_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  evidence TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (spec_id) REFERENCES specs(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_spec ON tasks(spec_id);

CREATE TABLE IF NOT EXISTS plan_progress (
  user_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_key)
);
