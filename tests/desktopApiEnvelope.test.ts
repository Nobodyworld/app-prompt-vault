import { describe, expect, it } from "vitest";
import { unwrapApiEnvelope } from "../desktop/src/services/promptApi.js";

describe("desktop API envelope", () => {
    it("unwraps { data } payloads", () => {
        const result = unwrapApiEnvelope<{ value: number }>({ data: { value: 123 } });
        expect(result).toEqual({ value: 123 });
    });

    it("throws on missing data envelope", () => {
        expect(() => unwrapApiEnvelope({ ok: true })).toThrow(
            "Invalid API response: missing data envelope",
        );
    });
});
