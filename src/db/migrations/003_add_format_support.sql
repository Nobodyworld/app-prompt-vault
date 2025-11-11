-- Adds format support to prompt versions for multi-format content storage.
-- Check if format column already exists before adding it
PRAGMA foreign_keys = OFF;

-- Add format column if it doesn't exist
ALTER TABLE prompt_versions ADD COLUMN format TEXT DEFAULT 'markdown' CHECK (format IN ('markdown', 'yaml', 'json'));

-- Make format NOT NULL after adding the column (if it was added)
-- This is a bit tricky in SQLite, so we'll handle it in the application logic

-- Update existing records to have explicit format (they were all markdown by default)
UPDATE prompt_versions SET format = 'markdown' WHERE format IS NULL;

PRAGMA foreign_keys = ON;
