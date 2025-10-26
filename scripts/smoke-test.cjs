#!/usr/bin/env node
/*
Simple smoke test script for the Prompt Vault DB.
Inserts a prompt + version and reads them back. Exits with non-zero on failure.
Usage: node ./scripts/smoke-test.cjs [path-to-db]
*/
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const fs = require("fs");

const dbPath = process.argv[2] || "./prompt-vault.db";
if (!fs.existsSync(dbPath)) {
  console.error(`DB file not found: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath);
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
      slug: `smoke-script-${Date.now()}`,
      title: "Smoke Test Prompt",
      description: "Created by smoke-test script",
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`
    ).run({
      id: versionId,
      promptId,
      semanticVersion: "1.0.0",
      body: "Smoke test body",
      changelog: "initial",
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
    console.error("Smoke test failed: inserted rows not found");
    process.exit(3);
  }

  console.log("Smoke test succeeded. Inserted rows:");
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
} catch (err) {
  console.error("Smoke test error:", err && err.message ? err.message : err);
  process.exit(4);
} finally {
  try {
    db.close();
  } catch {
    // ignore
  }
}
