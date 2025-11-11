-- Adds soft delete support to prompts table
ALTER TABLE prompts ADD COLUMN deleted_at TEXT;
