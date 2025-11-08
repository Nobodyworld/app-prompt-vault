/**
 * Domain model definitions for the Prompt Vault ecosystem.
 */

/**
 * Uniquely identifies a prompt within the vault.
 */
export type PromptId = string;

/**
 * Uniquely identifies a version of a prompt.
 */
export type PromptVersionId = string;

/**
 * Supported prompt content formats.
 */
export type PromptFormat = 'markdown' | 'yaml' | 'json';

/**
 * Represents a tag that can be attached to prompts for filtering and grouping.
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
