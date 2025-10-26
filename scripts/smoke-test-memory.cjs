#!/usr/bin/env node
/* eslint-env node */
/*
Smoke test script that supports in-memory DB for CI.
Usage: node ./scripts/smoke-test-memory.cjs [path-to-db]
If dbPath is ':memory:' the migration SQL will be applied.
*/
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const fs = require('fs');
const { argv } = require('process');

const dbPath = argv[2] || './prompt-vault.db';
const useInMemory = dbPath === ':memory:';

if (!useInMemory && !fs.existsSync(dbPath)) {
  console.error(`DB file not found: ${dbPath}`);
  process.exit(2);
}

const db = new Database(useInMemory ? ':memory:' : dbPath);

if (useInMemory) {
  try {
    const migrationSql = fs.readFileSync('./src/db/migrations/001_init.sql', 'utf8');
    db.exec(migrationSql);
  } catch (err) {
    console.error('Failed to apply migrations to in-memory DB:', err && err.message ? err.message : err);
    process.exit(5);
  }
}

try {
  const now = new Date().toISOString();
  const promptId = randomUUID();
  const versionId = randomUUID();

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO prompts (id, slug, title, description, created_at, updated_at)
       VALUES (@id, @slug, @title, @description, @createdAt, @updatedAt)`
    ).run({
      id: promptId,
      slug: `smoke-memory-${Date.now()}`,
      title: 'Smoke Test (memory)',
      description: 'Created by smoke-test-memory script',
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`
    ).run({
      id: versionId,
      promptId,
      semanticVersion: '1.0.0',
      body: 'Smoke test body (memory)',
      changelog: 'initial',
      createdAt: now,
      updatedAt: now,
    });
  });

  insert();

  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.title, pv.id as version_id, pv.semantic_version, pv.body
       FROM prompts p
       LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id
       WHERE p.id = @id`
    )
    .all({ id: promptId });

  if (!rows || rows.length === 0) {
    console.error('Smoke test failed: inserted rows not found');
    process.exit(3);
  }

  console.log('Smoke test succeeded (memory). Inserted rows:');
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
} catch (err) {
  console.error('Smoke test error:', err && err.message ? err.message : err);
  process.exit(4);
} finally {
  try {
    db.close();
  } catch (e) {
    // ignore
  }
}
