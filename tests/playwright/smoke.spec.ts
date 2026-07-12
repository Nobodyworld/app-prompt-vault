import { expect, test } from "@playwright/test";

/**
 * Smoke tests for the Prompt Vault browser-rendered desktop interface.
 * These tests intentionally cover only stable, public-facing shell behavior.
 */
test.describe("Desktop App Smoke Tests", () => {
  test("loads the application", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Prompt Vault Desktop");
    await expect(page.getByRole("heading", { name: "Prompt Vault" })).toBeVisible();
  });

  test("displays the primary navigation", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create" })).toBeVisible();
  });

  test("provides an accessible settings entry point", async ({ page }) => {
    await page.goto("/");

    const settingsLink = page.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();
    await settingsLink.focus();
    await expect(settingsLink).toBeFocused();
  });

  test("navigates between library and create pages", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL(/.*\/create/);

    await page.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/.*\/$/);
  });

  test("remains functional after keyboard input", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Prompt Vault" })).toBeVisible();

    await page.getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL(/.*\/create/);

    await page.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/.*\/$/);
  });

  test("renders at supported viewport sizes", async ({ page }) => {
    await page.goto("/");

    for (const viewport of [
      { width: 400, height: 600 },
      { width: 768, height: 1024 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("heading", { name: "Prompt Vault" })).toBeVisible();
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
