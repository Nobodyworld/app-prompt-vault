import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createPromptVaultRouter } from "../src/web/createPromptVaultRouter.js";

async function withServer(
  handler: (context: { baseUrl: string; service: PromptVaultService }) => Promise<void>
): Promise<void> {
  const database = new Database(":memory:");
  const logger = new StructuredLogger({ level: "error" });
  const service = new PromptVaultService(database, { logger });
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(express.json());
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
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
  });
  app.use("/api", createPromptVaultRouter(service, logger));
  app.use((error: unknown, _request: Request, response: Response) => {
    response
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          details: { requestId: response.locals.requestId },
        },
      });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler({ baseUrl, service });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
}

describe("HTTP router", () => {
  it("creates and retrieves prompts", async () => {
    await withServer(async ({ baseUrl }) => {
      const createResponse = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `api-${randomUUID().slice(0, 8)}`,
          title: "API Test",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["alpha"],
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json();
      const promptId = created.data.prompt.id as string;

      const versionResponse = await fetch(`${baseUrl}/api/prompts/${promptId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Updated", semanticVersion: "1.0.1", changelog: "Update" }),
      });
      expect(versionResponse.status).toBe(201);
      const versionPayload = await versionResponse.json();
      expect(versionPayload.data.version.semanticVersion).toBe("1.0.1");

      const getResponse = await fetch(`${baseUrl}/api/prompts/${promptId}`);
      expect(getResponse.status).toBe(200);
      const fetched = await getResponse.json();
      expect(fetched.data.prompt.slug).toBe(created.data.prompt.slug);
      expect(fetched.data.prompt.tags).toHaveLength(1);
      expect(fetched.data.prompt.latestVersion.semanticVersion).toBe("1.0.1");

      const listResponse = await fetch(`${baseUrl}/api/prompts?page=0&pageSize=5&tags=alpha`);
      expect(listResponse.status).toBe(200);
      const listPayload = await listResponse.json();
      expect(listPayload.data.pagination.total).toBeGreaterThanOrEqual(1);
      expect(listPayload.data.prompts[0].slug).toBe(created.data.prompt.slug);
    });
  });

  it("updates prompt metadata and tags", async () => {
    await withServer(async ({ baseUrl }) => {
      // Create a prompt
      const createResponse = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `update-${randomUUID().slice(0, 8)}`,
          title: "Original Title",
          description: "Original description",
          body: "Body content",
          semanticVersion: "1.0.0",
          tags: ["original"],
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json();
      const promptId = created.data.prompt.id as string;

      // Update the prompt
      const updateResponse = await fetch(`${baseUrl}/api/prompts/${promptId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          description: "Updated description",
          tags: ["updated", "new-tag"],
        }),
      });
      expect(updateResponse.status).toBe(200);
      const updated = await updateResponse.json();
      expect(updated.data.prompt.title).toBe("Updated Title");
      expect(updated.data.prompt.description).toBe("Updated description");
      expect(updated.data.prompt.tags.map((t: { label: string }) => t.label).sort()).toEqual(["new-tag", "updated"]);

      // Verify the update persisted
      const getResponse = await fetch(`${baseUrl}/api/prompts/${promptId}`);
      const fetched = await getResponse.json();
      expect(fetched.data.prompt.title).toBe("Updated Title");
    });
  });

  it("validates incoming payloads", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "bad", title: "x", body: "" }),
      });
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error.code).toBe("VALIDATION_ERROR");
      expect(payload.error.message).toBe("Request validation failed");
      expect(payload.error.details.requestId).toBeDefined();
    });
  });

  it("supports tag lifecycle operations", async () => {
    await withServer(async ({ baseUrl }) => {
      const createResponse = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `tags-${randomUUID().slice(0, 8)}`,
          title: "Tag Test",
          body: "Body",
          semanticVersion: "1.0.0",
          tags: ["alpha"],
        }),
      });
      const created = await createResponse.json();
      const promptId = created.data.prompt.id as string;

      const tagResponse = await fetch(`${baseUrl}/api/prompts/${promptId}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: ["beta", "gamma"] }),
      });
      expect(tagResponse.status).toBe(200);
      const tagged = await tagResponse.json();
      expect(tagged.data.prompt.tags.map((tag: { label: string }) => tag.label)).toEqual(["alpha", "beta", "gamma"]);

      const untagResponse = await fetch(`${baseUrl}/api/prompts/${promptId}/tags`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: ["beta"] }),
      });
      expect(untagResponse.status).toBe(200);
      const untagged = await untagResponse.json();
      expect(untagged.data.prompt.tags.map((tag: { label: string }) => tag.label)).toEqual(["alpha", "gamma"]);
    });
  });

  it("handles missing prompts gracefully", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts/${randomUUID()}`);
      expect(response.status).toBe(404);
      const payload = await response.json();
      expect(payload.error.code).toBe("NOT_FOUND");
      expect(payload.error.details.requestId).toBeDefined();
    });
  });

  it("rejects malformed JSON payloads", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error.code).toBe("BAD_REQUEST");
      expect(payload.error.message).toBe("Malformed JSON payload");
      expect(payload.error.details.requestId).toBeDefined();
      expect(response.headers.get("x-request-id")).toBe(payload.error.details.requestId);
    });
  });

  it("rejects invalid prompt identifiers", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts/not-a-uuid`);
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error.code).toBe("VALIDATION_ERROR");
      expect(payload.error.message).toBe("Request validation failed");
    });
  });
});
