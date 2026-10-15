CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS saved_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  repo_path TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query TEXT,
  headers TEXT,
  body_text TEXT,
  content_type TEXT,
  tree_state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
CREATE INDEX IF NOT EXISTS idx_saved_requests_repo_path ON saved_requests(repo_path);
