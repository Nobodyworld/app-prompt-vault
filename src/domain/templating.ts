import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Template variables schema shared across CLI/API/tools.
 * Values are coerced to strings during rendering.
 */
export const templateVariablesSchema = z.record(
    z.string().min(1),
    z.union([z.string(), z.number(), z.boolean()]).optional()
).default({});

export type TemplateVariables = z.infer<typeof templateVariablesSchema>;

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractTemplateVariables(template: string): string[] {
    if (!template) return [];
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_REGEX.exec(template)) !== null) {
        const name = match[1]?.trim();
        if (name) found.add(name);
    }
    return [...found];
}

function buildBuiltins(): Record<string, string> {
    const now = new Date();
    const uuid =
        typeof globalThis.crypto !== "undefined" &&
            typeof (globalThis.crypto as unknown as { randomUUID?: () => string }).randomUUID === "function"
            ? (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID()
            : randomUUID();

    return {
        now: now.toISOString(),
        today: now.toISOString().slice(0, 10),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        uuid,
    };
}

export interface RenderTemplateResult {
    rendered: string;
    requiredVariables: string[];
    missingVariables: string[];
}

export function renderTemplate(
    template: string,
    variables: TemplateVariables = {}
): RenderTemplateResult {
    const requiredVariables = extractTemplateVariables(template);
    const builtins = buildBuiltins();

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables ?? {})) {
        if (value === undefined || value === null) continue;
        normalized[key] = String(value);
    }

    const missingVariables = requiredVariables.filter(
        (name) => normalized[name] === undefined && builtins[name] === undefined
    );

    const rendered = template.replace(PLACEHOLDER_REGEX, (_full, rawName: string) => {
        const name = String(rawName).trim();
        if (normalized[name] !== undefined) return normalized[name];
        if (builtins[name] !== undefined) return builtins[name];
        return `{{${name}}}`;
    });

    return { rendered, requiredVariables, missingVariables };
}

