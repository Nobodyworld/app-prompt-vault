import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PromptVaultService } from "../src/services/PromptVaultService.js";

// Validate that diagnostics expose migration and integrity metadata
// even on a fresh in-memory database.
describe("diagnostics", () => {
    it("reports migration and integrity state", async () => {
        const database = new Database(":memory:");
        const service = new PromptVaultService(database);

        const report = await service.runDiagnostics();

        expect(report.migration.latestVersion).toBeGreaterThan(0);
        expect(report.migration.currentVersion).toBe(report.migration.latestVersion);
        expect(report.integrity.status).toBe("ok");

        database.close();
    });
});
