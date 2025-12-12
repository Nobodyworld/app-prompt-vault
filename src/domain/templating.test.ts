import { describe, it, expect } from "vitest";
import { extractTemplateVariables, renderTemplate } from "./templating.js";

describe("templating", () => {
    it("extracts unique variables from a template", () => {
        const vars = extractTemplateVariables("Hello {{name}}, {{ today }}. Again {{name}}.");
        expect(vars.sort()).toEqual(["name", "today"]);
    });

    it("renders variables and reports missing ones", () => {
        const result = renderTemplate("Hi {{name}} {{missing}}", { name: "Bob" });
        expect(result.rendered).toContain("Bob");
        expect(result.missingVariables).toEqual(["missing"]);
    });

    it("uses built-in variables when not provided", () => {
        const result = renderTemplate("Now {{now}} and id {{uuid}}", {});
        expect(result.rendered).not.toContain("{{now}}");
        expect(result.rendered).not.toContain("{{uuid}}");
        expect(result.missingVariables).toEqual([]);
    });

    it("prefers provided variables over built-ins", () => {
        const result = renderTemplate("Today {{today}}", { today: "override" });
        expect(result.rendered).toBe("Today override");
    });
});

