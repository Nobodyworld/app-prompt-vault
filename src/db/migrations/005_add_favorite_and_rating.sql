-- Adds favorites + rating metadata to prompts.
-- is_favorite: 0/1 integer boolean (default 0)
-- rating: optional integer (1..5 enforced at application layer)

ALTER TABLE prompts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prompts ADD COLUMN rating INTEGER;
