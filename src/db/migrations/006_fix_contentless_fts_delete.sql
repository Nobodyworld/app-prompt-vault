-- Contentless FTS5 tables do not support ordinary DELETE statements.
-- Use the FTS5 delete command when a prompt row is permanently removed.
DROP TRIGGER IF EXISTS prompts_fts_delete;

CREATE TRIGGER prompts_fts_delete AFTER DELETE ON prompts
BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid) VALUES('delete', old.rowid);
END;
