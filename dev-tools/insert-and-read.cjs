const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const fs = require('fs');
const dbPath = './tests/data/prompt-vault.db';
console.log('DB path:', dbPath);
if (!fs.existsSync(dbPath)) { console.error('DB file not found:', dbPath); process.exit(1); }
const db = new Database(dbPath);
const now = new Date().toISOString();
const promptId = randomUUID();
const versionId = randomUUID();
const slug = 'script-smoke-' + Date.now();
try {
  db.transaction(() => {
    db.prepare(`INSERT INTO prompts (id, slug, title, description, created_at, updated_at) VALUES (@id, @slug, @title, @description, @createdAt, @updatedAt)`)
      .run({ id: promptId, slug, title: 'Script Smoke', description: 'Inserted by script', createdAt: now, updatedAt: now });

    db.prepare(`INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at) VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`)
      .run({ id: versionId, promptId, semanticVersion: '1.0.0', body: 'This is a smoke test body', changelog: 'initial', createdAt: now, updatedAt: now });
  })();
  console.log('Inserted prompt', promptId, 'slug', slug);
  const rows = db.prepare(`SELECT p.id, p.slug, p.title, p.created_at, p.updated_at, pv.id as version_id, pv.semantic_version, pv.body
    FROM prompts p
    LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id
    WHERE p.id = @promptId`).all({ promptId });
  console.log('Read back:', JSON.stringify(rows, null, 2));
} catch (err) {
  console.error('Error during DB insert/read:', err && err.message ? err.message : err);
} finally {
  db.close();
}
