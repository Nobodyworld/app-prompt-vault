import { describe, expect, it } from "vitest";
import { extractKbDocIds, formatKbDocLink } from "./kbLinking.js";

describe("kbLinking", () => {
    it("formats token links", () => {
        expect(formatKbDocLink("doc_123456")).toBe("kb_doc:doc_123456");
    });

    it("formats markdown links", () => {
        expect(formatKbDocLink("doc_123456", { format: "markdown", title: "My Doc" })).toBe(
            "[My Doc](kb_doc:doc_123456)",
        );
    });

    it("extracts unique doc ids", () => {
        const text = "See kb_doc:doc_123456 and kb_doc:doc_123456 and kb_doc:doc_abcdef";
        expect(extractKbDocIds(text).sort()).toEqual(["doc_123456", "doc_abcdef"].sort());
    });
});
