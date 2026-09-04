import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function expectReadableMinimumFontSize(page: Page) {
  const undersizedText = await page.locator("body *").evaluateAll((elements) => elements.flatMap((element) => {
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
    const rect = element.getBoundingClientRect();
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    if (directText === "" || rect.width === 0 || rect.height === 0 || fontSize >= 12) return [];
    return [`${element.tagName.toLowerCase()}.${element.className}: ${fontSize}px (${directText.slice(0, 48)})`];
  }));
  expect(undersizedText).toEqual([]);
}

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
  await expect(belief.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(belief.locator(".evidence-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Potential conflicts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reflection history" })).toBeVisible();
  await expect(page.locator(".timeline li")).toHaveCount(1);
  await expectReadableMinimumFontSize(page);
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: "test-results/memoryos-explorer.png", fullPage: true });
});

test("browses a Context graph without Search and opens a Claim", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?project=agent-memory&mode=map");

  await expect(page.getByRole("tab", { name: "Context map" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".context-section__label").getByText("Context", { exact: true })).toBeVisible();
  await expect(page.locator(".context-strip button").first()).toBeVisible();
  await page.locator(".context-strip button").first().click();
  const canvas = page.getByTestId("knowledge-graph");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(720);
  await expect(page.getByTestId("graph-navigator")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit all" })).toBeVisible();

  const picker = page.getByLabel("Inspect graph node");
  const claimValue = await picker.locator("option").evaluateAll((options) =>
    options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? "" }))
      .find((option) => option.text.startsWith("Claim:"))?.value ?? "");
  expect(claimValue).not.toBe("");
  await picker.selectOption(claimValue);
  await expect(page.getByTestId("belief-panel")).toBeVisible();
  await expect(page.getByTestId("belief-panel").getByRole("heading", { name: "Evidence" })).toBeVisible();

  await page.getByRole("button", { name: "Hide details" }).click();
  await expect(page.locator(".map-inspector")).toBeHidden();
  await page.getByRole("button", { name: "Show details" }).click();
  const inspector = page.locator(".map-inspector");
  await expect(inspector).toBeVisible();
  await inspector.locator("details").evaluateAll((details) => {
    details.forEach((detail) => { (detail as HTMLDetailsElement).open = true; });
  });
  await expect(inspector).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => inspector.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await inspector.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await inspector.evaluate((element) => { element.scrollTop = 0; });

  await page.getByText("Unscoped", { exact: true }).click();
  await expect(page.getByTestId("knowledge-graph")).toBeVisible();
  await expectReadableMinimumFontSize(page);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "test-results/memoryos-context-map.png", fullPage: true });
});
