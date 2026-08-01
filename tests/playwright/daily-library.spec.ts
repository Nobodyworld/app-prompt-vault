import { expect, test, type Page } from "@playwright/test";

interface PromptFixture {
  readonly title: string;
  readonly body: string;
  readonly tags: string;
  readonly category: string;
  readonly rating: string;
  readonly favorite: boolean;
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function createPrompt(page: Page, fixture: PromptFixture): Promise<void> {
  await page.goto("/create");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(fixture.title);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill(fixture.body);
  await page
    .getByRole("textbox", { name: /Tags/ })
    .fill(fixture.tags);

  await page.getByText("More options", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Category", exact: true })
    .fill(fixture.category);
  await page
    .getByRole("textbox", { name: "Rating", exact: true })
    .fill(fixture.rating);
  if (fixture.favorite) {
    await page.getByRole("checkbox", { name: "Mark as favorite" }).check();
  }

  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("button", { name: `Copy prompt ${fixture.title}` }),
  ).toBeVisible();
}

async function visibleRowTitles(page: Page): Promise<string[]> {
  return page.getByTestId("prompt-row").evaluateAll((rows) =>
    rows.map((row) => {
      const title = row.querySelector(".prompt-row__title");
      return title?.textContent?.trim() ?? "";
    }),
  );
}

test.describe("Daily Library workspace", () => {
  test("creates, organizes, copies, edits, favorites, reloads, and resets disposable prompts", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await createPrompt(page, {
      title: "Alpha Daily Brief",
      body: "Alpha clipboard body",
      tags: "daily, reporting",
      category: "Work",
      rating: "5",
      favorite: true,
    });
    await createPrompt(page, {
      title: "Zulu Standup",
      body: "Zulu clipboard body",
      tags: "daily, team",
      category: "Work",
      rating: "2",
      favorite: false,
    });
    await createPrompt(page, {
      title: "Beta Client Note",
      body: "Beta clipboard body",
      tags: "client, notes",
      category: "Clients",
      rating: "4",
      favorite: false,
    });

    await expect.poll(() => visibleRowTitles(page)).toEqual([
      "Alpha Daily Brief",
      "Beta Client Note",
      "Zulu Standup",
    ]);

    await page.getByRole("combobox", { name: "Sort" }).selectOption("title");
    await expect.poll(() => visibleRowTitles(page)).toEqual([
      "Alpha Daily Brief",
      "Beta Client Note",
      "Zulu Standup",
    ]);

    await page
      .getByRole("button", { name: "Favorites", exact: true })
      .click();
    await expect(page.getByText("1 of 3 prompts")).toBeVisible();
    await expect.poll(() => visibleRowTitles(page)).toEqual([
      "Alpha Daily Brief",
    ]);

    await page.getByRole("button", { name: "More filters" }).click();
    await page
      .getByRole("searchbox", { name: "Search prompts" })
      .fill("daily");
    await page.getByRole("combobox", { name: "Tag" }).selectOption("reporting");
    await page
      .getByRole("combobox", { name: "Category" })
      .selectOption("Work");
    const activeFilters = page.getByLabel("Active filters");
    await expect(activeFilters).toContainText("Query: daily");
    await expect(activeFilters).toContainText("Favorites");
    await expect(activeFilters).toContainText("Tag: reporting");
    await expect(activeFilters).toContainText("Category: Work");

    await page
      .getByRole("heading", { name: "Your prompt library" })
      .click();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Prompt copied.")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Alpha clipboard body");

    await page
      .getByRole("heading", { name: "Your prompt library" })
      .click();
    await page.keyboard.press("e");
    await expect(page).toHaveURL(/\/edit\//);
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Alpha Daily Brief Updated");
    await page
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("Alpha updated clipboard body");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page
      .getByRole("button", {
        name: "Remove Alpha Daily Brief Updated from favorites",
      })
      .click();
    await expect(page.getByText("Removed from favorites.")).toBeVisible();

    await page.reload();
    const restoredCopy = page.getByRole("button", {
      name: "Copy prompt Alpha Daily Brief Updated",
    });
    await expect(restoredCopy).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Add Alpha Daily Brief Updated to favorites",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue(
      "title",
    );

    await restoredCopy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Alpha updated clipboard body");

    await page
      .getByRole("button", { name: "Favorites", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "No prompts match the active filters" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset all filters" }).click();
    await expect(page.getByText("3 prompts")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search prompts" });
    await search.fill("Alpha");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByText("3 prompts")).toBeVisible();

    await search.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Favorites", exact: true }),
    ).toBeFocused();

    await page.setViewportSize({ width: 400, height: 600 });
    await page.getByRole("button", { name: "More filters" }).click();
    await expect(page.getByRole("combobox", { name: "Tag" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });
});
