CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  urgency TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Received',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);

CREATE TABLE IF NOT EXISTS counselling_requests (
  id TEXT PRIMARY KEY,
  contact TEXT NOT NULL,
  mode TEXT NOT NULL,
  timing TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Received',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_counselling_created_at ON counselling_requests(created_at);

CREATE TABLE IF NOT EXISTS brief_cache (
  topic TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
