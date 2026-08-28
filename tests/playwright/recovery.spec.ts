import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(180_000);

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 400, height: 600 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function chooseBackup(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByText("Validation complete")).toBeVisible();
  await expect(page.getByText(/Format 2\.0/)).toBeVisible();
  await assertNoHorizontalOverflow(page);
}

async function confirmAndExecute(page: Page): Promise<void> {
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Execute transactional restore" })
    .click();
  await expect(page.getByText("Restore verified")).toBeVisible();
  await assertNoHorizontalOverflow(page);
}

test.describe("Data safety and recovery", () => {
  test("exports full history, previews safely, exercises conflicts, and persists restored history", async ({
    page,
  }) => {
    page.setDefaultTimeout(10_000);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.goto("/create");
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Recovery source");
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Original recovery body");
    await page.getByRole("textbox", { name: /Tags/ }).fill("recovery, full-history");
    await page.getByRole("button", { name: "Save prompt" }).click();
    await page
      .getByRole("button", { name: "Edit prompt Recovery source" })
      .click();
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Second recovery body");
    await page.getByText("Version and organization").click();
    await page.getByRole("textbox", { name: /Changelog/ }).fill("Second version");
    await page.getByRole("button", { name: "Save changes" }).click();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Data safety and recovery" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export verified backup 2.0" }).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).not.toBeNull();
    const backup = JSON.parse(await readFile(backupPath!, "utf8"));
    expect(backup).toMatchObject({
      format: "prompt-vault-backup",
      version: "2.0",
      summary: { promptCount: 1, versionCount: 2 },
    });
    expect(backup.prompts[0].versions.map((version: { body: string }) => version.body)).toEqual([
      "Original recovery body",
      "Second recovery body",
    ]);

    await chooseBackup(page, backupPath!);
    await expect(page.getByText("Exact duplicate: 1")).toBeVisible();
    await page.getByRole("button", { name: "Cancel preview" }).click();
    await page.goto("/");
    await expect(page.getByText("1 prompt")).toBeVisible();

    await page.goto("/settings");
    await chooseBackup(page, backupPath!);
    await confirmAndExecute(page);
    await expect(page.getByText(/1 prompts skipped/)).toBeVisible();

    await page.getByRole("button", { name: "Start a new preview" }).click();
    await chooseBackup(page, backupPath!);
    await page
      .getByRole("combobox", { name: "Conflict policy" })
      .selectOption("import-as-copy");
    await confirmAndExecute(page);
    await expect(page.getByText(/1 copied/)).toBeVisible();
    await page.goto("/");
    await expect(page.getByText("2 prompts")).toBeVisible();
    await expect(page.getByText("Recovery source (imported copy)")).toBeVisible();

    const source = backup.prompts[0];
    await page.evaluate(
      ({ sourcePrompt }) => {
        const firstVersion = sourcePrompt.versions[0];
        localStorage.setItem(
          "prompt-vault:inMemoryStore:v1",
          JSON.stringify({
            prompts: [
              {
                id: "one-version-current",
                slug: sourcePrompt.slug,
                title: sourcePrompt.title,
                description: sourcePrompt.description ?? undefined,
                category: sourcePrompt.category ?? undefined,
                isFavorite: sourcePrompt.isFavorite,
                rating: sourcePrompt.rating,
                tags: sourcePrompt.tags,
                createdAt: sourcePrompt.createdAt,
                updatedAt: firstVersion.updatedAt,
                latestVersion: {
                  id: "one-version",
                  semanticVersion: firstVersion.semanticVersion,
                  body: firstVersion.body,
                  changelog: firstVersion.changelog,
                  createdAt: firstVersion.createdAt,
                  updatedAt: firstVersion.updatedAt,
                },
                versions: [
                  {
                    id: "one-version",
                    semanticVersion: firstVersion.semanticVersion,
                    body: firstVersion.body,
                    changelog: firstVersion.changelog,
                    createdAt: firstVersion.createdAt,
                    updatedAt: firstVersion.updatedAt,
                  },
                ],
              },
            ],
          }),
        );
      },
      { sourcePrompt: source },
    );
    await page.reload();
    await page.goto("/settings");
    await chooseBackup(page, backupPath!);
    await expect(page.getByText("Missing versions available: 1")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Conflict policy" })
      .selectOption("add-missing-versions");
    await confirmAndExecute(page);
    await expect(page.getByText(/1 versions merged/)).toBeVisible();

    await page.goto("/");
    await page
      .getByRole("button", { name: "Edit prompt Recovery source" })
      .click();
    await page.getByText("Version and organization").click();
    await expect(page.getByText("2 version(s)")).toBeVisible();
    const previews = page.getByRole("button", { name: "Preview" });
    await previews.nth(1).click();
    await expect(page.getByText("Preview v1.0.0")).toBeVisible();
    await expect(
      page.getByText("Original recovery body", { exact: true }),
    ).toBeVisible();
    await page.getByText("Compare with current version").click();
    await expect(page.getByRole("table", { name: /line comparison/ })).toBeVisible();
    await page.reload();
    await page.getByText("Version and organization").click();
    await expect(page.getByText("2 version(s)")).toBeVisible();

    await page.goto("/settings");
    await page.evaluate(() => localStorage.setItem("prompt-vault:inMemoryStore:v1", JSON.stringify({ prompts: [] })));
    await page.reload();
    await chooseBackup(page, backupPath!);
    await expect(page.getByText("New prompt: 1")).toBeVisible();
    await confirmAndExecute(page);
    await page.reload();
    await page.goto("/");
    await expect(page.getByText("1 prompt")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy prompt Recovery source" }),
    ).toBeVisible();
  });
});
