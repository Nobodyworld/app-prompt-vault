import { randomUUID } from "node:crypto";
import type { NextFunction, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import type { PromptVaultService } from "../services/PromptVaultService.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { Telemetry } from "../observability/telemetry.js";
import { createNoopTelemetry } from "../observability/telemetry.js";
import { DuplicatePromptError, PromptNotFoundError, ValidationError } from "../domain/errors.js";
import type { Prompt } from "../domain/models.js";

const semanticVersionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, "Version must follow semantic versioning");

const promptCreateSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters long")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase alphanumerics and hyphens"),
  title: z.string().min(3, "Title must be at least 3 characters long"),
  description: z.string().max(2000).optional(),
  body: z.string().min(1, "Prompt body is required"),
  format: z.enum(["markdown", "yaml", "json"]).default("markdown"),
  semanticVersion: semanticVersionSchema.default("1.0.0"),
  tags: z.array(z.string().min(1)).default([]),
  changelog: z.string().max(2000).optional(),
});

const promptSearchSchema = z.object({
  text: z.string().max(200).optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      const parts = Array.isArray(value) ? value : value.split(",");
      const labels = parts
        .flatMap((part) => part.split(","))
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      return labels.length > 0 ? labels : undefined;
    }),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  projectTagId: z.string().uuid().optional(),
});

const versionCreateSchema = z.object({
  body: z.string().min(1, "Prompt body is required"),
  format: z.enum(["markdown", "yaml", "json"]).default("markdown"),
  semanticVersion: semanticVersionSchema.default("1.0.0"),
  changelog: z.string().max(2000).optional(),
});

const tagMutationSchema = z.object({
  tags: z.array(z.string().min(1)).nonempty("At least one tag must be provided"),
});

const promptIdParamSchema = z.object({
  promptId: z.string().uuid("Prompt ID must be a valid UUID"),
});

interface RouterOptions {
  readonly telemetry?: Telemetry;
}

function resolveRoutePath(request: Parameters<RequestHandler>[0]): string {
  const base = request.baseUrl ?? "";
  const matched = request.route?.path as string | undefined;
  const candidate = `${base}${matched ?? ""}`;
  return candidate.length > 0 ? candidate : request.path;
}

export function createPromptVaultRouter(
  service: PromptVaultService,
  logger: StructuredLogger,
  options: RouterOptions = {}
): Router {
  const router = createRouter();
  const telemetry = options.telemetry ?? createNoopTelemetry();

  function asyncHandler(name: string, handler: RequestHandler): RequestHandler {
    return (request, response, next) => {
      const attributes = {
        method: request.method,
        route: resolveRoutePath(request),
      };
      Promise.resolve(telemetry.withSpan(`http.${name}`, attributes, () => handler(request, response, next))).catch(
        (error) => {
          telemetry.recordEvent(`http.${name}.error`, {
            message: error instanceof Error ? error.message : String(error),
            route: attributes.route,
          });
          next(error);
        }
      );
    };
  }

  function mapPromptToResponse(prompt: Prompt): Record<string, unknown> {
    return {
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description,
      category: prompt.category,
      body: prompt.latestVersion?.body,
      tags: prompt.tags.map((tag) => ({ id: tag.id, label: tag.label })),
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      deletedAt: prompt.deletedAt,
      latestVersion: prompt.latestVersion
        ? {
          id: prompt.latestVersion.id,
          semanticVersion: prompt.latestVersion.semanticVersion,
          body: prompt.latestVersion.body,
          format: prompt.latestVersion.format,
          changelog: prompt.latestVersion.changelog,
          createdAt: prompt.latestVersion.createdAt,
          updatedAt: prompt.latestVersion.updatedAt,
        }
        : undefined,
    };
  }

  router.get(
    "/prompts",
    asyncHandler("list-prompts", async (request, response) => {
      const query = promptSearchSchema.parse(request.query);
      const result = await service.searchPrompts({
        text: query.text,
        tags: query.tags,
        page: query.page,
        pageSize: query.pageSize,
        projectTagId: query.projectTagId,
      });

      response.json({
        prompts: result.prompts.map(mapPromptToResponse),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
        },
      });
    })
  );

  router.get(
    "/prompts/:promptId",
    asyncHandler("get-prompt", async (request, response) => {
      const { promptId } = promptIdParamSchema.parse(request.params);
      const prompt = await service.getPrompt(promptId);
      response.json({ prompt: mapPromptToResponse(prompt) });
    })
  );

  router.post(
    "/prompts",
    asyncHandler("create-prompt", async (request, response) => {
      const payload = promptCreateSchema.parse(request.body);
      const prompt = await service.createPrompt({
        ...payload,
        id: payload.id ?? randomUUID(),
      });
      response.status(201).json({ prompt: mapPromptToResponse(prompt) });
    })
  );

  router.put(
    "/prompts/:promptId",
    asyncHandler("update-prompt", async (request, response) => {
      const payload = z.object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        category: z.string().max(100).optional(),
        tags: z.array(z.string().min(1)).optional(),
      }).parse(request.body);

      const { promptId } = promptIdParamSchema.parse(request.params);
      const prompt = await service.updatePrompt(promptId, payload);
      response.json({ prompt: mapPromptToResponse(prompt) });
    })
  );

  router.post(
    "/prompts/:promptId/versions",
    asyncHandler("add-version", (request, response) => {
      const payload = versionCreateSchema.parse(request.body);
      const { promptId } = promptIdParamSchema.parse(request.params);
      const version = service.addVersion(
        promptId,
        payload.body,
        payload.semanticVersion,
        payload.format,
        payload.changelog
      );
      response.status(201).json({ version });
    })
  );

  router.post(
    "/prompts/:promptId/convert",
    asyncHandler("convert-prompt", async (request, response) => {
      const { targetFormat } = z.object({
        targetFormat: z.enum(["markdown", "yaml", "json"])
      }).parse(request.body);

      const { promptId } = promptIdParamSchema.parse(request.params);
      const converted = await service.convertPrompt(promptId, targetFormat);
      response.json({ data: { content: converted, format: targetFormat } });
    })
  );

  router.post(
    "/prompts/:promptId/tags",
    asyncHandler("tag-prompt", async (request, response) => {
      const payload = tagMutationSchema.parse(request.body);
      const { promptId } = promptIdParamSchema.parse(request.params);
      await service.tagPrompt(promptId, payload.tags);
      const prompt = await service.getPrompt(promptId);
      response.json({ data: mapPromptToResponse(prompt) });
    })
  );

  router.delete(
    "/prompts/:promptId/tags",
    asyncHandler("untag-prompt", async (request, response) => {
      const payload = tagMutationSchema.parse(request.body);
      const { promptId } = promptIdParamSchema.parse(request.params);
      await service.untagPrompt(promptId, payload.tags);
      const prompt = await service.getPrompt(promptId);
      response.json({ data: mapPromptToResponse(prompt) });
    })
  );

  router.use((
    error: unknown,
    request: Parameters<RequestHandler>[0],
    response: Response,
    next: NextFunction
  ) => {
    const requestId = response.locals?.requestId;
    const traceId = response.locals?.traceId;
    if (error instanceof ValidationError || error instanceof z.ZodError) {
      const issues = error instanceof ValidationError ? error.issues : error.issues.map((issue) => issue.message);
      response.status(400).json({ error: "Request validation failed", details: issues, requestId, traceId });
      return;
    }

    if (error instanceof PromptNotFoundError) {
      response.status(404).json({ error: error.message, requestId, traceId });
      return;
    }

    if (error instanceof DuplicatePromptError) {
      response.status(409).json({ error: error.message, requestId, traceId });
      return;
    }

    logger.error("router_error", {
      path: request.path,
      method: request.method,
      error: error instanceof Error ? error.message : error,
      requestId,
      traceId,
    });
    telemetry.recordEvent("http.router_error", {
      method: request.method,
      path: request.path,
    });

    next(error);
  });

  return router;
}
