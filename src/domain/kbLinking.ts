export type KbLinkFormat = "token" | "markdown";

export interface KbLinkOptions {
    readonly title?: string;
    readonly anchor?: string;
    readonly format?: KbLinkFormat;
}

const KB_DOC_SCHEME = "kb_doc:";

function sanitizeAnchor(anchor: string): string {
    // Conservative: keep URL-fragment-safe-ish characters.
    return anchor.replace(/[^A-Za-z0-9._~!$&'()*+,;=:@/-]/g, "");
}

/**
 * Builds a Knowledge Base reference string for a document.
 *
 * The default format is a stable token: `kb_doc:<docId>`.
 * When `format: "markdown"` is used, returns a Markdown link that uses the same token as href.
 */
export function formatKbDocLink(docId: string, options: KbLinkOptions = {}): string {
    const trimmed = docId.trim();
    if (!trimmed) throw new Error("docId is required");

    const anchor = options.anchor ? sanitizeAnchor(options.anchor) : "";
    const href = `${KB_DOC_SCHEME}${trimmed}${anchor ? `#${anchor}` : ""}`;
    const format = options.format ?? "token";

    if (format === "token") return href;

    const title = (options.title ?? trimmed).replace(/[[\]]/g, "").trim() || trimmed;
    return `[${title}](${href})`;
}

/**
 * Extracts Knowledge Base document IDs from any text containing `kb_doc:<docId>` references.
 */
export function extractKbDocIds(text: string): string[] {
    if (!text) return [];
    const ids = new Set<string>();
    const regex = /\bkb_doc:([A-Za-z0-9_-]{6,})\b/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        ids.add(match[1]);
    }
    return [...ids];
}
