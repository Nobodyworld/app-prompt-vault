import { expect, test } from "@playwright/test";

/**
 * Stable shell checks for the standalone Prompt Vault product surface.
 */
test.describe("Desktop App Smoke Tests", () => {
  test("loads the focused prompt library", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Prompt Vault Desktop");
    await expect(
      page.getByRole("link", { name: "Prompt Vault home" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your prompt library" }),
    ).toBeVisible();
  });

  test("displays only the primary navigation", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New prompt" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Advanced tools" }),
    ).not.toBeVisible();
  });

  test("provides an accessible settings entry point", async ({ page }) => {
    await page.goto("/");

    const settingsLink = page.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();
    await settingsLink.focus();
    await expect(settingsLink).toBeFocused();
  });

  test("navigates between library and prompt creation", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "New prompt" }).click();
    await expect(page).toHaveURL(/.*\/create/);
    await expect(page.getByRole("heading", { name: "New prompt" })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Prompt", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/.*\/$/);
  });

  test("keeps prompt saving explicit and preserves an unfinished draft", async ({
    page,
  }) => {
    await page.goto("/create");

    const title = page.getByRole("textbox", { name: "Title", exact: true });
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await title.fill("Draft prompt title");
    await prompt.fill("Draft prompt body");

    await page.getByRole("link", { name: "New prompt" }).click();
    await expect(title).toHaveValue("Draft prompt title");
    await expect(prompt).toHaveValue("Draft prompt body");
    await expect(
      page.getByText("Prompt creation requires the desktop runtime."),
    ).not.toBeVisible();

    await page.getByRole("link", { name: "Library" }).click();
    await page.getByRole("link", { name: "New prompt" }).click();
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("Draft prompt title");
    await expect(
      page.getByRole("textbox", { name: "Prompt", exact: true }),
    ).toHaveValue("Draft prompt body");
  });

  test("keeps advanced utilities outside the everyday library", async ({
    page,
  }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Backup and local data" }),
    ).toBeVisible();
    const advancedLink = page.getByRole("link", { name: "Open advanced tools" });
    await expect(advancedLink).toBeVisible();
    await advancedLink.click();
    await expect(page).toHaveURL(/.*\/advanced/);
  });

  test("remains functional after keyboard input", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Control+KeyK");
    await expect(page.getByLabel("Search prompts")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Your prompt library" }),
    ).toBeVisible();
  });

  test("renders at supported viewport sizes", async ({ page }) => {
    await page.goto("/");

    for (const viewport of [
      { width: 400, height: 600 },
      { width: 768, height: 1024 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByRole("heading", { name: "Your prompt library" }),
      ).toBeVisible();
    }
  });

  test("does not show the error boundary during normal startup", async ({
    page,
  }) => {
    await page.goto("/");

    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], .error-boundary',
    );
    await expect(errorBoundary).not.toBeVisible();
  });
});
