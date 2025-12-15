/**
 * Domain model definitions for the Prompt Vault ecosystem.
 *
 * This module defines the core data structures and types used throughout
 * the Prompt Vault application. These models represent the fundamental
 * entities for managing prompts, versions, tags, and search functionality.
 */

/**
 * Uniquely identifies a prompt within the vault.
 *
 * Prompt IDs are UUID strings that provide global uniqueness across
 * the entire prompt ecosystem. They are used as primary keys and
 * foreign key references throughout the system.
 *
 * @example
 * ```typescript
 * const promptId: PromptId = "550e8400-e29b-41d4-a716-446655440000";
 * ```
 */
export type PromptId = string;

/**
 * Uniquely identifies a version of a prompt.
 */
export type PromptVersionId = string;

/**
 * Supported prompt content formats.
 *
 * Defines the content types that prompts can be stored and rendered in.
 * Each format has different parsing, validation, and conversion rules.
 *
 * - `markdown`: Standard Markdown with optional frontmatter
 * - `yaml`: YAML format for structured prompt data
 * - `json`: JSON format for programmatic prompt definitions
 *
 * @example
 * ```typescript
 * const format: PromptFormat = "markdown";
 * // Valid values: "markdown" | "yaml" | "json"
 * ```
 */
export type PromptFormat = 'markdown' | 'yaml' | 'json';

/**
 * Represents a tag that can be attached to prompts for filtering and grouping.
 *
 * Tags enable categorization and discovery of prompts. They support optional
 * descriptions for better context and are created with timestamps for audit trails.
 *
 * @example
 * ```typescript
 * const tag: Tag = {
 *   id: "123e4567-e89b-12d3-a456-426614174000",
 *   label: "machine-learning",
 *   description: "Prompts related to machine learning tasks",
 *   createdAt: new Date("2024-01-15T10:30:00Z")
 * };
 * ```
 */
export interface Tag {
  /** Unique identifier for the tag. */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** Optional descriptive text to provide context. */
  readonly description?: string;
  /** Timestamp when the tag was created. */
  readonly createdAt: Date;
}

/**
 * Metadata describing a single revision of a prompt.
 *
 * Each prompt can have multiple versions representing its evolution over time.
 * Versions are immutable once created and track semantic versioning along with
 * content changes and timestamps.
 *
 * @example
 * ```typescript
 * const version: PromptVersion = {
 *   id: "789e0123-e89b-12d3-a456-426614174001",
 *   promptId: "550e8400-e29b-41d4-a716-446655440000",
 *   semanticVersion: "1.2.0",
 *   body: "# Greeting Prompt\n\nHello! How can I help you today?",
 *   format: "markdown",
 *   changelog: "Improved greeting language and added formatting",
 *   createdAt: new Date("2024-01-20T14:30:00Z"),
 *   updatedAt: new Date("2024-01-20T14:30:00Z")
 * };
 * ```
 */
export interface PromptVersion {
  /** Unique identifier for this prompt version. */
  readonly id: PromptVersionId;
  /** FK referencing the parent prompt. */
  readonly promptId: PromptId;
  /** Semantic version string such as `1.0.0`. */
  readonly semanticVersion: string;
  /** The canonical text for the prompt at this version. */
  readonly body: string;
  /** Format of the prompt content. */
  readonly format: PromptFormat;
  /** Optional notes highlighting what changed. */
  readonly changelog?: string;
  /** Timestamp when the version was created. */
  readonly createdAt: Date;
  /** Timestamp of last modification. */
  readonly updatedAt: Date;
}

/**
 * Primary entity representing a reusable prompt entry.
 *
 * The Prompt is the central entity in the vault, containing metadata, tags,
 * and references to its version history. Prompts support soft deletion and
 * maintain audit trails through creation and update timestamps.
 *
 * @example
 * ```typescript
 * const prompt: Prompt = {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   slug: "customer-greeting",
 *   title: "Customer Service Greeting",
 *   description: "Professional greeting for customer interactions",
 *   tags: [tag1, tag2],
 *   createdAt: new Date("2024-01-15T10:00:00Z"),
 *   updatedAt: new Date("2024-01-20T14:30:00Z"),
 *   deletedAt: undefined, // null if not deleted
 *   latestVersion: version1
 * };
 * ```
 */
export interface Prompt {
  /** Unique identifier for the prompt. */
  readonly id: PromptId;
  /** Slug for referencing the prompt from the CLI or UI. */
  readonly slug: string;
  /** Human-readable title describing the prompt. */
  readonly title: string;
  /** Detailed description capturing context, usage tips, or instructions. */
  readonly description?: string;
  /** Category for organizing prompts into folders/groups. */
  readonly category?: string;
  /** Whether the prompt is marked as a favorite. */
  readonly isFavorite?: boolean;
  /** Optional 1..5 rating for quick triage/sorting. */
  readonly rating?: number | null;
  /** Tags currently linked to the prompt. */
  readonly tags: readonly Tag[];
  /** Timestamp when the prompt was created. */
  readonly createdAt: Date;
  /** Timestamp when the prompt metadata was last updated. */
  readonly updatedAt: Date;
  /** Timestamp when the prompt was soft deleted (null if not deleted). */
  readonly deletedAt?: Date;
  /** The latest version metadata associated with this prompt. */
  readonly latestVersion?: PromptVersion;
}

/**
 * Represents a mapping between prompts and tags.
 */
export interface PromptTagLink {
  /** Identifier of the prompt. */
  readonly promptId: PromptId;
  /** Identifier of the tag. */
  readonly tagId: Tag["id"];
}

/**
 * Container for paginated prompt results.
 *
 * Used by search operations to return prompts in manageable chunks with
 * pagination metadata. Enables efficient browsing of large result sets.
 *
 * @example
 * ```typescript
 * const results: PromptSearchResult = {
 *   prompts: [prompt1, prompt2, prompt3],
 *   page: 0,
 *   pageSize: 10,
 *   total: 47
 * };
 * // Shows first 10 of 47 matching prompts
 * ```
 */
export interface PromptSearchResult {
  /** Collection of prompts for the current page. */
  readonly prompts: readonly Prompt[];
  /** Zero-based page index. */
  readonly page: number;
  /** Number of prompts per page. */
  readonly pageSize: number;
  /** Total number of prompts matching the query. */
  readonly total: number;
}

/**
 * Represents a search match with excerpt and highlighting information.
 *
 * Provides detailed information about where and how search terms matched
 * within prompt content, enabling precise highlighting and context display.
 *
 * @example
 * ```typescript
 * const match: SearchMatch = {
 *   excerpt: "...Hello! How can I help you today? I am here to...",
 *   position: 42,
 *   length: 7
 * };
 * // Matches "help you" starting at character 42
 * ```
 */
export interface SearchMatch {
  /** The text excerpt containing the match. */
  readonly excerpt: string;
  /** Zero-based position of the match within the original text. */
  readonly position: number;
  /** Length of the matched text. */
  readonly length: number;
}

/**
 * Advanced search result for a single prompt with detailed match information.
 */
export interface PromptSearchMatch {
  /** The prompt that matched the search. */
  readonly prompt: Prompt;
  /** Total number of matches found in this prompt. */
  readonly totalMatches: number;
  /** Individual match excerpts with highlighting information. */
  readonly matches: readonly SearchMatch[];
}

/**
 * Container for advanced search results with detailed match information.
 *
 * Provides comprehensive search results with per-prompt match details,
 * excerpts, and highlighting. Used for advanced search operations that
 * require precise match information and context.
 *
 * @example
 * ```typescript
 * const results: AdvancedPromptSearchResult = {
 *   matches: [{
 *     prompt: prompt1,
 *     totalMatches: 3,
 *     matches: [match1, match2, match3]
 *   }],
 *   page: 0,
 *   pageSize: 20,
 *   total: 1,
 *   totalMatches: 3
 * };
 * ```
 */
export interface AdvancedPromptSearchResult {
  /** Collection of prompts with detailed match information. */
  readonly matches: readonly PromptSearchMatch[];
  /** Zero-based page index. */
  readonly page: number;
  /** Number of prompts per page. */
  readonly pageSize: number;
  /** Total number of prompts matching the query. */
  readonly total: number;
  /** Total number of matches across all results. */
  readonly totalMatches: number;
}
