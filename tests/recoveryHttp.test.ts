import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoreDb } from "../src/lib/platform-core.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createPromptVaultRouter } from "../src/web/createPromptVaultRouter.js";

const databases: Database.Database[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  await resetCoreDb();
});

function fixture() {
  const database = new Database(":memory:");
  databases.push(database);
  const logger = new StructuredLogger({ level: "error" });
  const service = new PromptVaultService(database, { logger });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", createPromptVaultRouter(service, logger));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(400).json({
      error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) },
    });
  });
  return { agent: request(app), service, database };
}

async function seed(service: PromptVaultService, slug = "http-recovery") {
  const prompt = await service.createPrompt({
    id: randomUUID(),
    slug,
    title: "HTTP recovery",
    body: "Original HTTP body",
    semanticVersion: "1.0.0",
    format: "markdown",
    tags: ["http", "recovery"],
    changelog: "Initial",
  });
  service.addVersion(
    prompt.id,
    "Second HTTP body",
    "1.1.0",
    "markdown",
    "Second",
  );
  return prompt;
}

describe("HTTP recovery contracts", () => {
  it("exports verified full history and reports storage without content", async () => {
    const { agent, service } = fixture();
    await seed(service);
    const exported = await agent.get("/api/recovery/export").expect(200);
    expect(exported.headers["x-prompt-vault-backup-verified"]).toBe("true");
    expect(exported.body).toMatchObject({
      format: "prompt-vault-backup",
      version: "2.0",
      summary: { promptCount: 1, versionCount: 2 },
    });
    expect(exported.body.prompts[0].versions).toHaveLength(2);
    expect(exported.body.prompts[0].versions[0].changelog).toBe("Initial");

    const status = await agent.get("/api/storage/status?integrity=true").expect(200);
    expect(status.body.data).toMatchObject({
      runtime: "http",
      storage: "sqlite",
      promptCount: 1,
      versionCount: 2,
      integrityStatus: "ok",
    });
    expect(JSON.stringify(status.body)).not.toContain("Original HTTP body");
  });

  it("previews and executes the exact plan transactionally", async () => {
    const source = fixture();
    await seed(source.service, "portable-history");
    const backup = (await source.agent.get("/api/recovery/export").expect(200)).text;

    const target = fixture();
    const preview = await target.agent
      .post("/api/recovery/preview")
      .send({ content: backup })
      .expect(200);
    expect(preview.body.data.validation).toMatchObject({
      valid: true,
      promptCount: 1,
      versionCount: 2,
    });
    expect(preview.body.data.validation).not.toHaveProperty("document");
    expect(preview.body.data.plan.entries[0].kind).toBe("new-prompt");

    const executed = await target.agent
      .post("/api/recovery/execute")
      .send({
        content: backup,
        plan: preview.body.data.plan,
        policy: "skip-existing",
      })
      .expect(200);
    expect(executed.body.data).toMatchObject({
      newPrompts: 1,
      integrityResult: "ok",
      foreignKeyViolationCount: 0,
    });
    expect(target.service.listPromptVersions(
      (await target.service.listAllPrompts())[0].id,
    )).toHaveLength(2);
    expect(
      (await target.service.listAllPrompts())[0].tags.map((tag) => tag.label),
    ).toEqual(["http", "recovery"]);
  });

  it("rejects invalid sources and stale previews without mutation", async () => {
    const source = fixture();
    await seed(source.service, "stale-http");
    const backup = (await source.agent.get("/api/recovery/export").expect(200)).text;
    const target = fixture();
    const invalid = await target.agent
      .post("/api/recovery/preview")
      .send({ content: "{" })
      .expect(200);
    expect(invalid.body.data.validation.valid).toBe(false);
    expect(invalid.body.data).not.toHaveProperty("plan");

    const preview = await target.agent
      .post("/api/recovery/preview")
      .send({ content: backup })
      .expect(200);
    await seed(target.service, "concurrent-http-change");
    const before = target.database.prepare("SELECT COUNT(*) AS count FROM prompts").get();
    const stale = await target.agent
      .post("/api/recovery/execute")
      .send({
        content: backup,
        plan: preview.body.data.plan,
        policy: "skip-existing",
      })
      .expect(400);
    expect(stale.body.error.code).toBe("VALIDATION_ERROR");
    expect(stale.body.error.details.issues.join(" ")).toMatch(/changed after preview/);
    expect(target.database.prepare("SELECT COUNT(*) AS count FROM prompts").get()).toEqual(before);
  });
});
