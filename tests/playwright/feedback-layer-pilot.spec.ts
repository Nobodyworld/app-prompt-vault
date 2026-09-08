import { expect, test } from "@playwright/test";

test.describe("Feedback Layer development pilot surfaces", () => {
  test("stays disabled by default while preserving semantic and private UI boundaries", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(
      page.locator('[data-feedback-id="prompt-vault.shell"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-feedback-id="prompt-vault.library.workspace"]'),
    ).toBeVisible();
    await expect(
      page.locator('script[src*="feedback-layer"]'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => "FeedbackLayer" in window),
    ).toBe(false);

    const search = page.getByRole("searchbox", { name: "Search prompts" });
    await expect(search).toHaveAttribute(
      "data-feedback-id",
      "prompt-vault.library.search",
    );
    await expect(search).toHaveAttribute("data-feedback-private", "true");
    await expect(search).toHaveAttribute("data-feedback-redact", "true");

    await page.getByRole("button", { name: "More filters" }).click();
    for (const name of ["Tag", "Category"]) {
      const filter = page.getByRole("combobox", { name });
      await expect(filter).toHaveAttribute("data-feedback-private", "true");
      await expect(filter).toHaveAttribute("data-feedback-redact", "true");
    }

    await page.getByRole("button", { name: "New prompt" }).click();
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    const body = page.getByRole("textbox", { name: "Prompt", exact: true });
    await title.fill("Synthetic pilot prompt");
    const privateBody = crypto.randomUUID();
    await body.fill(privateBody);
    await expect(title).toHaveAttribute("data-feedback-private", "true");
    await expect(body).toHaveAttribute("data-feedback-redact", "true");
    await page.getByText("More options", { exact: true }).click();
    for (const [name, id] of [
      ["Category", "prompt-vault.editor.create.category"],
      ["Rating", "prompt-vault.editor.create.rating"],
    ] as const) {
      const input = page.getByRole("textbox", { name, exact: true });
      await expect(input).toHaveAttribute("data-feedback-id", id);
      await expect(input).toHaveAttribute("data-feedback-private", "true");
      await expect(input).toHaveAttribute("data-feedback-redact", "true");
    }
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "data-feedback-id",
      "prompt-vault.editor.create.cancel",
    );
    await page.getByRole("button", { name: "Save prompt" }).click();

    const row = page.getByTestId("prompt-row");
    await expect(row).toBeVisible();
    const promptId = await row.getAttribute("data-prompt-id");
    expect(promptId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    await expect(row).toHaveAttribute(
      "data-feedback-id",
      `prompt-vault.prompt.${promptId}`,
    );
    await expect(row).toHaveAttribute("data-feedback-private", "true");
    await expect(row).toHaveAttribute("data-feedback-redact", "true");
    await expect(
      page.getByRole("button", { name: "Copy prompt Synthetic pilot prompt" }),
    ).toHaveAttribute(
      "data-feedback-id",
      `prompt-vault.prompt.${promptId}.copy`,
    );

    const anchorIds = await page
      .locator("[data-feedback-id]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-feedback-id")),
      );
    expect(new Set(anchorIds).size).toBe(anchorIds.length);
    const rowAttributes = await row.evaluate((element) =>
      Array.from(element.attributes)
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .join("\n"),
    );
    expect(rowAttributes).not.toContain(privateBody);

    await page.setViewportSize({ width: 400, height: 600 });
    await expect(
      page.locator('[data-feedback-id="prompt-vault.library.results"]'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
