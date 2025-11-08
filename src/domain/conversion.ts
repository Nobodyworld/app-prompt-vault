import YAML from "yaml";
import type { PromptFormat } from "../domain/models.js";

/**
 * Supported prompt content formats for conversion.
 */
export type PromptConversionTarget = PromptFormat;

/**
 * Converts prompt content between supported formats.
 * @param sourceContent - The source content to convert
 * @param sourceFormat - The format of the source content
 * @param targetFormat - The desired output format
 * @returns The converted content
 * @throws Error if conversion fails
 */
export function convertPromptContent(
  sourceContent: string,
  sourceFormat: PromptFormat,
  targetFormat: PromptFormat
): string {
  // If source and target formats are the same, return as-is
  if (sourceFormat === targetFormat) {
    return sourceContent;
  }

  // Convert to intermediate representation (object)
  let parsedContent: unknown;

  try {
    switch (sourceFormat) {
      case "json":
        parsedContent = JSON.parse(sourceContent);
        break;
      case "yaml":
        parsedContent = YAML.parse(sourceContent);
        break;
      case "markdown":
        // For markdown, we treat it as plain text and wrap it in an object
        parsedContent = { content: sourceContent };
        break;
      default:
        throw new Error(`Unsupported source format: ${sourceFormat}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${sourceFormat} content: ${message}`);
  }

  // Convert from intermediate representation to target format
  try {
    switch (targetFormat) {
      case "json":
        return JSON.stringify(parsedContent, null, 2);
      case "yaml":
        return YAML.stringify(parsedContent);
      case "markdown":
        // For markdown, extract content from the object
        if (typeof parsedContent === "object" && parsedContent !== null && "content" in parsedContent) {
          return String((parsedContent as { content: unknown }).content);
        }
        // If it's not an object with content, convert the whole thing to YAML-like markdown
        return YAML.stringify(parsedContent);
      default:
        throw new Error(`Unsupported target format: ${targetFormat}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to serialize to ${targetFormat}: ${message}`);
  }
}

/**
 * Detects the format of content based on its structure.
 * @param content - The content to analyze
 * @returns The detected format, defaults to 'markdown' if unclear
 */
export function detectPromptFormat(content: string): PromptFormat {
  const trimmed = content.trim();

  // Try JSON first
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON, continue checking
    }
  }

  // Try YAML
  try {
    YAML.parse(trimmed);
    // Check for YAML indicators (colons, dashes at start of lines)
    if (trimmed.includes(": ") || trimmed.includes(":\n") ||
        trimmed.split("\n").some(line => line.trim().startsWith("- "))) {
      return "yaml";
    }
  } catch {
    // Not valid YAML, continue
  }

  // Default to markdown
  return "markdown";
}

/**
 * Validates that content matches the expected format.
 * @param content - The content to validate
 * @param format - The expected format
 * @returns true if valid, throws error if invalid
 */
export function validatePromptContent(content: string, format: PromptFormat): boolean {
  try {
    switch (format) {
      case "json":
        JSON.parse(content);
        return true;
      case "yaml":
        YAML.parse(content);
        return true;
      case "markdown":
        // Markdown is always valid as plain text
        return true;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${format} content: ${message}`);
  }
}
