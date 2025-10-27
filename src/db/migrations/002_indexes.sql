-- Adds indexes to accelerate hot-path queries.
CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id_created_at ON prompt_versions(prompt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag_id ON prompt_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_label_lower ON tags(LOWER(label));
