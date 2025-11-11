/**
 * @fileoverview Domain Error Classes
 *
 * This module defines custom error classes for the Prompt Vault domain layer.
 * These errors provide structured error handling with specific error types that
 * can be caught and handled appropriately by application layers.
 *
 * Error Hierarchy:
 * - PromptNotFoundError: Resource not found (404-equivalent)
 * - DuplicatePromptError: Unique constraint violation
 * - ValidationError: Input validation failures
 *
 * All errors extend the base Error class and include relevant context information
 * for debugging and user feedback.
 *
 * @example
 * ```typescript
 * try {
 *   const prompt = service.getPrompt(id);
 * } catch (error) {
 *   if (error instanceof PromptNotFoundError) {
 *     // Handle missing prompt gracefully
 *     console.log(`Prompt ${error.promptId} not found`);
 *   } else if (error instanceof DuplicatePromptError) {
 *     // Handle duplicate slug
 *     console.log(`Slug ${error.slug} already exists`);
 *   } else if (error instanceof ValidationError) {
 *     // Handle validation issues
 *     console.log('Validation failed:', error.issues);
 *   }
 * }
 * ```
 */

/**
 * Error thrown when a requested prompt cannot be found.
 *
 * This error is typically thrown by repository methods when attempting to
 * retrieve a prompt by ID that doesn't exist in the database. It provides
 * the prompt ID for context and user feedback.
 *
 * @example
 * ```typescript
 * throw new PromptNotFoundError("550e8400-e29b-41d4-a716-446655440000");
 * // Error: "Prompt with id 550e8400-e29b-41d4-a716-446655440000 was not found."
 * ```
 */
export class PromptNotFoundError extends Error {
  /**
   * Construct a new PromptNotFoundError for the given identifier.
   * @param promptId - Identifier of the missing prompt.
   */
  public constructor(public readonly promptId: string) {
    super(`Prompt with id ${promptId} was not found.`);
    this.name = "PromptNotFoundError";
  }
}

/**
 * Error thrown when attempting to create a prompt that violates unique constraints.
 *
 * This error occurs when trying to create a prompt with a slug that already exists
 * in the system. The repository layer maps SQLite UNIQUE constraint violations
 * to this error type for consistent handling.
 *
 * @example
 * ```typescript
 * throw new DuplicatePromptError("my-existing-prompt");
 * // Error: "Prompt with slug my-existing-prompt already exists."
 * ```
 */
export class DuplicatePromptError extends Error {
  /**
   * Construct a new DuplicatePromptError for the offending slug.
   * @param slug - Slug that already exists.
   */
  public constructor(public readonly slug: string) {
    super(`Prompt with slug ${slug} already exists.`);
    this.name = "DuplicatePromptError";
  }
}

/**
 * Error thrown when validation of incoming data fails.
 *
 * This error aggregates multiple validation issues into a single error object,
 * making it easier to report all validation problems at once. It's typically
 * thrown by service methods when input data doesn't pass Zod schema validation.
 *
 * @example
 * ```typescript
 * const issues = ["Title must be at least 3 characters", "Invalid slug format"];
 * throw new ValidationError(issues);
 * // Error: "Validation failed: Title must be at least 3 characters, Invalid slug format"
 * ```
 */
export class ValidationError extends Error {
  /**
   * Construct a new validation error with aggregated issues.
   * @param issues - Specific validation failures.
   */
  public constructor(public readonly issues: readonly string[]) {
    super(`Validation failed: ${issues.join(", ")}`);
    this.name = "ValidationError";
  }
}
