-- Rebuild the contentless FTS5 index with ordinary DELETE support.
-- The canonical prompts and prompt_versions tables are the source of truth.
DROP TRIGGER IF EXISTS prompts_fts_insert;
DROP TRIGGER IF EXISTS prompts_fts_delete;
DROP TRIGGER IF EXISTS prompts_fts_update;
DROP TRIGGER IF EXISTS prompt_versions_fts_insert;
DROP TRIGGER IF EXISTS prompt_versions_fts_update;
DROP TRIGGER IF EXISTS prompt_versions_fts_delete;

DROP TABLE IF EXISTS prompts_fts;

CREATE VIRTUAL TABLE prompts_fts USING fts5(
  title,
  body,
  description,
  content='',
  contentless_delete=1
);

INSERT INTO prompts_fts(rowid, title, body, description)
SELECT
  p.rowid,
  COALESCE(p.title, ''),
  COALESCE((
    SELECT pv.body
    FROM prompt_versions pv
    WHERE pv.prompt_id = p.id
    ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
    LIMIT 1
  ), ''),
  COALESCE(p.description, '')
FROM prompts p
WHERE p.deleted_at IS NULL;

CREATE TRIGGER prompts_fts_insert
AFTER INSERT ON prompts
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO prompts_fts(rowid, title, body, description)
  VALUES(
    new.rowid,
    COALESCE(new.title, ''),
    COALESCE((
      SELECT pv.body
      FROM prompt_versions pv
      WHERE pv.prompt_id = new.id
      ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
      LIMIT 1
    ), ''),
    COALESCE(new.description, '')
  );
END;

CREATE TRIGGER prompts_fts_update
AFTER UPDATE OF title, description, deleted_at ON prompts
BEGIN
  DELETE FROM prompts_fts WHERE rowid = old.rowid;

  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT
    new.rowid,
    COALESCE(new.title, ''),
    COALESCE((
      SELECT pv.body
      FROM prompt_versions pv
      WHERE pv.prompt_id = new.id
      ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
      LIMIT 1
    ), ''),
    COALESCE(new.description, '')
  WHERE new.deleted_at IS NULL;
END;

CREATE TRIGGER prompts_fts_delete
AFTER DELETE ON prompts
BEGIN
  DELETE FROM prompts_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER prompt_versions_fts_insert
AFTER INSERT ON prompt_versions
BEGIN
  DELETE FROM prompts_fts
  WHERE rowid = (
    SELECT p.rowid
    FROM prompts p
    WHERE p.id = new.prompt_id
  );

  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT
    p.rowid,
    COALESCE(p.title, ''),
    COALESCE((
      SELECT pv.body
      FROM prompt_versions pv
      WHERE pv.prompt_id = p.id
      ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
      LIMIT 1
    ), ''),
    COALESCE(p.description, '')
  FROM prompts p
  WHERE p.id = new.prompt_id
    AND p.deleted_at IS NULL;
END;

CREATE TRIGGER prompt_versions_fts_update
AFTER UPDATE OF body, created_at, prompt_id ON prompt_versions
BEGIN
  DELETE FROM prompts_fts
  WHERE rowid IN (
    SELECT p.rowid
    FROM prompts p
    WHERE p.id IN (old.prompt_id, new.prompt_id)
  );

  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT
    p.rowid,
    COALESCE(p.title, ''),
    COALESCE((
      SELECT pv.body
      FROM prompt_versions pv
      WHERE pv.prompt_id = p.id
      ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
      LIMIT 1
    ), ''),
    COALESCE(p.description, '')
  FROM prompts p
  WHERE p.id IN (old.prompt_id, new.prompt_id)
    AND p.deleted_at IS NULL;
END;

CREATE TRIGGER prompt_versions_fts_delete
AFTER DELETE ON prompt_versions
BEGIN
  DELETE FROM prompts_fts
  WHERE rowid = (
    SELECT p.rowid
    FROM prompts p
    WHERE p.id = old.prompt_id
  );

  INSERT INTO prompts_fts(rowid, title, body, description)
  SELECT
    p.rowid,
    COALESCE(p.title, ''),
    COALESCE((
      SELECT pv.body
      FROM prompt_versions pv
      WHERE pv.prompt_id = p.id
      ORDER BY datetime(pv.created_at) DESC, pv.rowid DESC
      LIMIT 1
    ), ''),
    COALESCE(p.description, '')
  FROM prompts p
  WHERE p.id = old.prompt_id
    AND p.deleted_at IS NULL;
END;
