import { expect, test } from "@playwright/test";

test("keeps the shared prompt list neutral and selectable on Advanced", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/create");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Advanced Layout Check");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Disposable advanced-page prompt");
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.setViewportSize({ width: 400, height: 600 });
  await page.goto("/advanced");

  const list = page.getByRole("list", { name: "Visible prompts" });
  await expect(list).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy prompt Advanced Layout Check" }),
  ).toBeVisible();

  const selection = page.getByRole("checkbox", {
    name: "Select prompt Advanced Layout Check",
  });
  await selection.check();
  await expect(selection).toBeChecked();
  await expect(
    page.getByText("1 selected", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /favorite/i }),
  ).toHaveCount(0);

  await expect
    .poll(() =>
      list.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          listStyleType: style.listStyleType,
          marginTop: style.marginTop,
          marginRight: style.marginRight,
          marginBottom: style.marginBottom,
          marginLeft: style.marginLeft,
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
        };
      }),
    )
    .toEqual({
      listStyleType: "none",
      marginTop: "0px",
      marginRight: "0px",
      marginBottom: "0px",
      marginLeft: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
    });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const listElement = document.querySelector(".prompt-list");
        if (!listElement) return false;
        const listBounds = listElement.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth &&
          listBounds.left >= 0 &&
          listBounds.right <= document.documentElement.clientWidth
        );
      }),
    )
    .toBe(true);
});
