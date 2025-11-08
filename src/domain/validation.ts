import { z } from "zod";

/**
 * Schema for validating prompt creation payloads.
 */
export const promptInputSchema = z.object({
  id: z.string().uuid(),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters long")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase alphanumerics and hyphens"),
  title: z.string().min(3, "Title must be at least 3 characters long"),
  description: z.string().max(2000).optional(),
  body: z.string().min(1, "Prompt body is required"),
  format: z.enum(["markdown", "yaml", "json"]).default("markdown"),
  semanticVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, "Version must follow semantic versioning"),
  tags: z.array(z.string().min(1)).max(10).default([]),
  changelog: z.string().max(2000).optional(),
});

/**
 * Schema for validating search queries.
 */
export const searchQuerySchema = z.object({
  text: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).optional(),
  formats: z.array(z.enum(["markdown", "yaml", "json"])).optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(20),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(100).default(20),
  maxMatchesPerRule: z.number().int().min(1).max(10).default(3),
  maxTotalMatches: z.number().int().min(1).max(1000).default(100),
});
