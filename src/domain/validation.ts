/**
 * @fileoverview Domain Validation Schemas
 *
 * This module defines Zod validation schemas for all domain objects and operations
 * in the Prompt Vault application. These schemas ensure data integrity, provide
 * runtime type checking, and generate helpful error messages for invalid inputs.
 *
 * Validation Rules:
 * - Slugs: 3+ chars, lowercase alphanumeric + hyphens only
 * - Titles: 3+ characters minimum
 * - Descriptions: Optional, max 2000 characters
 * - Bodies: Required, non-empty content
 * - Formats: Restricted to markdown, yaml, json
 * - Versions: Strict semantic versioning (X.Y.Z)
 * - Tags: Max 10 tags per prompt, non-empty strings
 * - Search: Comprehensive filtering with pagination and limits
 *
 * All schemas are designed to be composable and reusable across different
 * application layers (API, CLI, services).
 *
 * @example
 * ```typescript
 * import { promptInputSchema } from './validation';
 *
 * const result = promptInputSchema.safeParse(inputData);
 * if (!result.success) {
 *   console.error('Validation failed:', result.error.format());
 * } else {
 *   // Data is valid and properly typed
 *   const prompt = result.data;
 * }
 * ```
 */

import { z } from "zod";

/**
 * Zod schema for validating prompt creation and update payloads.
 *
 * This schema enforces business rules for prompt data integrity:
 * - Unique UUID identifier
 * - URL-safe slug with length and character restrictions
 * - Descriptive title with minimum length
 * - Optional description with reasonable limits
 * - Required content body
 * - Supported content formats
 * - Semantic versioning compliance
 * - Tag system with quantity limits
 * - Optional changelog for version tracking
 *
 * @example
 * ```typescript
 * const validPrompt = {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   slug: "code-review-prompt",
 *   title: "Code Review Assistant",
 *   description: "A prompt for reviewing code changes",
 *   body: "# Code Review Guidelines\n\nPlease review the following code...",
 *   format: "markdown",
 *   semanticVersion: "1.0.0",
 *   tags: ["review", "code", "development"],
 *   changelog: "Initial version with basic guidelines"
 * };
 * ```
 */
export const promptInputSchema = z.object({
  id: z.string().uuid(),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters long")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase alphanumerics and hyphens"),
  title: z.string().min(3, "Title must be at least 3 characters long"),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  isFavorite: z.boolean().default(false),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  body: z.string().min(1, "Prompt body is required"),
  format: z.enum(["markdown", "yaml", "json"]).default("markdown"),
  semanticVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, "Version must follow semantic versioning"),
  tags: z.array(z.string().min(1)).max(10).default([]),
  projectTagId: z.string().uuid().optional(),
  changelog: z.string().max(2000).optional(),
});

/**
 * Zod schema for validating prompt search and filtering queries.
 *
 * This schema supports advanced search capabilities with multiple filter types:
 * - Text search across titles, descriptions, and content
 * - Tag-based filtering with multiple tags
 * - Format-specific filtering
 * - Pagination with configurable page sizes
 * - Search performance controls and limits
 *
 * The schema includes safety limits to prevent resource exhaustion from
 * overly broad or expensive search operations.
 *
 * @example
 * ```typescript
 * const searchQuery = {
 *   text: "code review",
 *   tags: ["review", "development"],
 *   formats: ["markdown"],
 *   page: 0,
 *   pageSize: 20,
 *   caseSensitive: false,
 *   maxResults: 20,
 *   maxMatchesPerRule: 3,
 *   maxTotalMatches: 100
 * };
 * ```
 */
export const searchQuerySchema = z.object({
  text: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).optional(),
  formats: z.array(z.enum(["markdown", "yaml", "json"])).optional(),
  category: z.string().max(100).optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(20),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(100).default(20),
  maxMatchesPerRule: z.number().int().min(1).max(10).default(3),
  maxTotalMatches: z.number().int().min(1).max(1000).default(100),
  projectTagId: z.string().uuid().optional(),
});
