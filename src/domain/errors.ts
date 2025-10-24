/**
 * Application-specific error types to support ergonomic error handling.
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
