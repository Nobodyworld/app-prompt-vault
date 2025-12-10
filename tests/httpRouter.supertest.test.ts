import express, { type NextFunction, type Request, type Response } from "express";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import request, { type SuperTest, type Test } from "supertest";
import { describe, expect, it } from "vitest";
import { createProjectTag, tagPrompt } from "@nw/tags-projects";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createPromptVaultRouter } from "../src/web/createPromptVaultRouter.js";

function buildApp() {
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
            response.status(400).json({ error: "Malformed JSON payload", requestId: response.locals.requestId });
            return;
        }
        next(error);
    });
    app.use("/api", createPromptVaultRouter(service, logger));
    app.use((error: unknown, _request: Request, response: Response) => {
        response
            .status(500)
            .json({ error: error instanceof Error ? error.message : String(error), requestId: response.locals.requestId });
    });

    return { app, service, database };
}

async function withApp(handler: (context: { agent: SuperTest<Test>; service: PromptVaultService }) => Promise<void>): Promise<void> {
    const { app, service, database } = buildApp();
    const agent = request(app);

    try {
        await handler({ agent, service });
    } finally {
        database.close();
    }
}

describe("HTTP router (supertest)", () => {
    it("filters prompts by projectTagId", async () => {
        await withApp(async ({ agent, service }) => {
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

            const projectTag = await createProjectTag({ slug: "demo-project", label: "Demo Project" });
            await tagPrompt(promptA.body.prompt.id, projectTag.id);

            const projectResponse = await agent.get(`/api/prompts?projectTagId=${projectTag.id}`).expect(200);
            const projectIds = projectResponse.body.prompts.map((prompt: { id: string }) => prompt.id);

            expect(projectIds).toContain(promptA.body.prompt.id);
            expect(projectIds).not.toContain(promptB.body.prompt.id);
            expect(projectResponse.body.pagination.total).toBeGreaterThanOrEqual(1);
        });
    });
});
