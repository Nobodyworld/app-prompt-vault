-- Initializes the core tables for the Prompt Vault domain.
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  category TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  integrity_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  semantic_version TEXT NOT NULL,
  body TEXT NOT NULL,
  format TEXT,
  changelog TEXT,
  integrity_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

-- Full-text search virtual table for prompts (contentless to avoid implicit column coupling)
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  title, body, description,
  content=""
);

-- Triggers to keep FTS table in sync
CREATE TRIGGER IF NOT EXISTS prompts_fts_insert AFTER INSERT ON prompts
BEGIN
  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT new.rowid, new.title,
    COALESCE((SELECT body FROM prompt_versions WHERE prompt_id = new.id ORDER BY datetime(created_at) DESC LIMIT 1), ''),
    new.description;
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_delete AFTER DELETE ON prompts
BEGIN
  DELETE FROM prompts_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_update AFTER UPDATE ON prompts
BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid) VALUES('delete', new.rowid);
  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT new.rowid, new.title,
    COALESCE((SELECT body FROM prompt_versions WHERE prompt_id = new.id ORDER BY datetime(created_at) DESC LIMIT 1), ''),
    new.description;
END;

-- Keep FTS body in sync with latest versions
CREATE TRIGGER IF NOT EXISTS prompt_versions_fts_insert AFTER INSERT ON prompt_versions
BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid)
    VALUES('delete', (SELECT rowid FROM prompts WHERE id = new.prompt_id));
  INSERT INTO prompts_fts(rowid, title, body, description)
    SELECT rowid, title, new.body, description FROM prompts WHERE id = new.prompt_id;
END;

CREATE TRIGGER IF NOT EXISTS prompt_versions_fts_update AFTER UPDATE OF body ON prompt_versions
BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid)
    VALUES('delete', (SELECT rowid FROM prompts WHERE id = new.prompt_id));
  INSERT INTO prompts_fts(rowid, title, body, description)
    SELECT rowid, title, new.body, description FROM prompts WHERE id = new.prompt_id;
END;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_prompts_slug ON prompts(slug);
CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at);
CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts(updated_at);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_at ON prompt_versions(created_at);

CREATE INDEX IF NOT EXISTS idx_tags_label ON tags(label);

CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt_id ON prompt_tags(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag_id ON prompt_tags(tag_id);

CREATE VIEW IF NOT EXISTS prompt_latest_version AS
SELECT
  pv.prompt_id AS prompt_id,
  MAX(pv.created_at) AS latest_created_at
FROM prompt_versions pv
GROUP BY pv.prompt_id;
