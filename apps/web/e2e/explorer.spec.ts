import { expect, test } from "@playwright/test";

test("searches a Claim and explains why MemoryOS believes it", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MemoryOS implementation" })).toBeVisible();
  await expect(page.getByText("agent-memory", { exact: true })).toBeVisible();

  const search = page.getByLabel("Search project memory");
  await search.fill("How does MemoryOS expose agent tools?");
  await page.getByRole("button", { name: "Search memory" }).click();

  const claim = page.getByRole("button", {
    name: /MemoryOS exposes eight canonical task-oriented tools/,
  });
  await expect(claim).toBeVisible();
  await claim.click();

  const belief = page.getByTestId("belief-panel");
  await expect(belief.getByRole("heading", { name: "WHY DO WE BELIEVE THIS?" })).toBeVisible();
  await expect(belief.locator(".evidence-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Potential conflicts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reflection history" })).toBeVisible();
  await expect(page.locator(".timeline li")).toHaveCount(1);
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: "test-results/memoryos-explorer.png", fullPage: true });
});
