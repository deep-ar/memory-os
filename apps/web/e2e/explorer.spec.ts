import { expect, test } from "@playwright/test";

test("searches a Claim and explains why MemoryOS believes it", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?project=agent-memory&mode=search");

  await expect(page.getByRole("heading", { name: "MemoryOS implementation" })).toBeVisible();
  await expect(page.getByText("agent-memory", { exact: true })).toBeVisible();

  await expect(page.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");

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

test("browses a Context graph without Search and opens a Claim", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?project=agent-memory&mode=map");

  await expect(page.getByRole("tab", { name: "Context map" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Browse memory without Search" })).toBeVisible();
  await expect(page.locator(".context-strip button").first()).toBeVisible();
  await page.locator(".context-strip button").first().click();
  await expect(page.getByTestId("knowledge-graph")).toBeVisible();

  const picker = page.getByLabel("Inspect graph node");
  const claimValue = await picker.locator("option").evaluateAll((options) =>
    options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? "" }))
      .find((option) => option.text.startsWith("Claim:"))?.value ?? "");
  expect(claimValue).not.toBe("");
  await picker.selectOption(claimValue);
  await expect(page.getByTestId("belief-panel")).toBeVisible();

  await page.getByText("Unscoped", { exact: true }).click();
  await expect(page.getByTestId("knowledge-graph")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "test-results/memoryos-context-map.png", fullPage: true });
});
