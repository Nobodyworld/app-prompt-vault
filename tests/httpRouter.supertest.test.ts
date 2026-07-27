import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createProjectTag,
  resetCoreDb,
  tagSharedPrompt,
} from "../src/lib/platform-core.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createPromptVaultRouter } from "../src/web/createPromptVaultRouter.js";

type Agent = ReturnType<typeof request>;

function buildApp() {
  const database = new Database(":memory:");
  const logger = new StructuredLogger({ level: "error" });
  const service = new PromptVaultService(database, { logger });
  const app = express();

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(express.json());
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error instanceof SyntaxError) {
        response.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message: "Malformed JSON payload",
            details: { requestId: response.locals.requestId },
          },
        });
        return;
      }
      next(error);
    },
  );
  app.use("/api", createPromptVaultRouter(service, logger));
  app.use((error: unknown, _request: Request, response: Response) => {
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        details: { requestId: response.locals.requestId },
      },
    });
  });

  return { app, service, database };
}

async function withApp(
  handler: (context: {
    agent: Agent;
    service: PromptVaultService;
  }) => Promise<void>,
): Promise<void> {
  const { app, service, database } = buildApp();
  const agent = request(app);

  try {
    await handler({ agent, service });
  } finally {
    database.close();
    await resetCoreDb();
  }
}

describe("HTTP router (supertest)", () => {
  it("returns 404 for missing prompts", async () => {
    await withApp(async ({ agent }) => {
      const missingId = randomUUID();
      const response = await agent.get(`/api/prompts/${missingId}`).expect(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(String(response.body.error.message).toLowerCase()).toContain(
        "not found",
      );
    });
  });

  it("creates, lists, and retrieves prompts with tags", async () => {
    await withApp(async ({ agent }) => {
      const slug = `supertest-${randomUUID().slice(0, 8)}`;

      const createResponse = await agent
        .post("/api/prompts")
        .send({
          slug,
          title: "Project Prompt",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["alpha", "beta"],
        })
        .expect(201);

      const promptId = createResponse.body.data.prompt.id as string;

      const getResponse = await agent
        .get(`/api/prompts/${promptId}`)
        .expect(200);
      expect(getResponse.body.data.prompt.slug).toBe(slug);
      expect(
        getResponse.body.data.prompt.tags
          .map((tag: { label: string }) => tag.label)
          .sort(),
      ).toEqual(["alpha", "beta"]);

      const listResponse = await agent
        .get("/api/prompts?page=0&pageSize=5&tags=alpha")
        .expect(200);
      expect(listResponse.body.data.pagination.total).toBeGreaterThan(0);
      expect(
        listResponse.body.data.prompts.some(
          (prompt: { id: string }) => prompt.id === promptId,
        ),
      ).toBe(true);
    });
  });

  it("tags and untags prompts via endpoints", async () => {
    await withApp(async ({ agent }) => {
      const slug = `supertest-${randomUUID().slice(0, 8)}`;
      const createResponse = await agent
        .post("/api/prompts")
        .send({
          slug,
          title: "Taggable",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: [],
        })
        .expect(201);

      const promptId = createResponse.body.data.prompt.id as string;

      const tagResponse = await agent
        .post(`/api/prompts/${promptId}/tags`)
        .send({ tags: ["one", "two"] })
        .expect(200);

      expect(
        tagResponse.body.data.prompt.tags
          .map((tag: { label: string }) => tag.label)
          .sort(),
      ).toEqual(["one", "two"]);

      const untagResponse = await agent
        .delete(`/api/prompts/${promptId}/tags`)
        .send({ tags: ["one"] })
        .expect(200);

      expect(
        untagResponse.body.data.prompt.tags.map(
          (tag: { label: string }) => tag.label,
        ),
      ).toEqual(["two"]);
    });
  });

  it("updates prompt metadata and replaces tags", async () => {
    await withApp(async ({ agent }) => {
      const slug = `supertest-${randomUUID().slice(0, 8)}`;
      const createResponse = await agent
        .post("/api/prompts")
        .send({
          slug,
          title: "Original",
          description: "Original description",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["alpha"],
        })
        .expect(201);

      const promptId = createResponse.body.data.prompt.id as string;

      const updateResponse = await agent
        .put(`/api/prompts/${promptId}`)
        .send({
          title: "Updated",
          description: "Updated description",
          tags: ["delta", "epsilon"],
        })
        .expect(200);

      expect(updateResponse.body.data.prompt.title).toBe("Updated");
      expect(updateResponse.body.data.prompt.description).toBe(
        "Updated description",
      );
      expect(
        updateResponse.body.data.prompt.tags
          .map((tag: { label: string }) => tag.label)
          .sort(),
      ).toEqual(["delta", "epsilon"]);

      const getResponse = await agent
        .get(`/api/prompts/${promptId}`)
        .expect(200);
      expect(
        getResponse.body.data.prompt.tags
          .map((tag: { label: string }) => tag.label)
          .sort(),
      ).toEqual(["delta", "epsilon"]);
    });
  });

  it("adds a new version and converts formats", async () => {
    await withApp(async ({ agent }) => {
      const createResponse = await agent
        .post("/api/prompts")
        .send({
          slug: `supertest-${randomUUID().slice(0, 8)}`,
          title: "Versioned",
          body: "# Greeting",
          semanticVersion: "1.0.0",
          tags: [],
        })
        .expect(201);

      const promptId = createResponse.body.data.prompt.id as string;

      const versionPayload = {
        body: JSON.stringify({ greeting: "hello" }),
        semanticVersion: "1.0.1",
        format: "json" as const,
      };
      const versionResponse = await agent
        .post(`/api/prompts/${promptId}/versions`)
        .send(versionPayload)
        .expect(201);
      expect(versionResponse.body.data.version.semanticVersion).toBe("1.0.1");

      const latest = await agent.get(`/api/prompts/${promptId}`).expect(200);
      expect(latest.body.data.prompt.latestVersion.semanticVersion).toBe(
        "1.0.1",
      );
      expect(latest.body.data.prompt.latestVersion.format).toBe("json");

      const convertResponse = await agent
        .post(`/api/prompts/${promptId}/convert`)
        .send({ targetFormat: "yaml" })
        .expect(200);

      expect(convertResponse.body.data.format).toBe("yaml");
      expect(String(convertResponse.body.data.content)).toContain(
        "greeting: hello",
      );
    });
  });

  it("maps validation and duplicate errors", async () => {
    await withApp(async ({ agent }) => {
      const slug = `supertest-${randomUUID().slice(0, 8)}`;

      const createResponse = await agent
        .post("/api/prompts")
        .send({
          slug,
          title: "Valid",
          body: "Body",
          semanticVersion: "1.0.0",
        })
        .expect(201);

      expect(createResponse.body.data.prompt.slug).toBe(slug);

      const duplicate = await agent
        .post("/api/prompts")
        .send({
          slug,
          title: "Duplicate",
          body: "Body",
          semanticVersion: "1.0.0",
        })
        .expect(409);
      expect(duplicate.body.error.code).toBe("CONFLICT");
      expect(duplicate.body.error.message).toContain(slug);

      const invalidVersion = await agent
        .post(`/api/prompts/${createResponse.body.data.prompt.id}/versions`)
        .send({ body: "Body", semanticVersion: "1.0" })
        .expect(400);
      expect(invalidVersion.body.error.code).toBe("VALIDATION_ERROR");
      expect(invalidVersion.body.error.details.issues).toContain(
        "Version must follow semantic versioning",
      );
    });
  });

  it("rejects malformed JSON and invalid filters", async () => {
    await withApp(async ({ agent }) => {
      await agent
        .post("/api/prompts")
        .set("content-type", "application/json")
        .send("{")
        .expect(400)
        .expect((response: any) => {
          expect(response.body.error.code).toBe("BAD_REQUEST");
          expect(response.body.error.message).toBe("Malformed JSON payload");
          expect(response.body.error.details.requestId).toBeDefined();
        });

      const invalidFilter = await agent
        .get("/api/prompts?projectTagId=not-a-uuid")
        .expect(400);
      expect(invalidFilter.body.error.code).toBe("VALIDATION_ERROR");
      expect(invalidFilter.body.error.message).toBe("Request validation failed");
      expect(
        invalidFilter.body.error.details.issues.some((detail: string) =>
          detail.toLowerCase().includes("uuid"),
        ),
      ).toBe(true);
    });
  });

  it("filters prompts by projectTagId", async () => {
    await withApp(async ({ agent }) => {
      const promptA = await agent
        .post("/api/prompts")
        .send({
          slug: `supertest-${randomUUID().slice(0, 8)}`,
          title: "Project Prompt",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["alpha"],
        })
        .expect(201);

      const promptB = await agent
        .post("/api/prompts")
        .send({
          slug: `supertest-${randomUUID().slice(0, 8)}`,
          title: "Unscoped Prompt",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["beta"],
        })
        .expect(201);

      const projectTag = await createProjectTag({
        slug: "demo-project",
        label: "Demo Project",
      });
      await tagSharedPrompt(promptA.body.data.prompt.id, projectTag.id);

      const projectResponse = await agent
        .get(`/api/prompts?projectTagId=${projectTag.id}`)
        .expect(200);
      const projectIds = projectResponse.body.data.prompts.map(
        (prompt: { id: string }) => prompt.id,
      );

      expect(projectIds).toContain(promptA.body.data.prompt.id);
      expect(projectIds).not.toContain(promptB.body.data.prompt.id);
      expect(projectResponse.body.data.pagination.total).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
