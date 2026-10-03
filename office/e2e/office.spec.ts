import { expect, test } from "@playwright/test";

test.describe("ออฟฟิศบอท", () => {
  test("shows the live team status from the agents' status file", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ออฟฟิศบอท" })).toBeVisible();
    const roster = page.getByRole("list", { name: "สถานะทีม" });
    await expect(roster.locator('[data-role="lead"] .chip')).toHaveText("รออนุมัติ");
    await expect(roster.locator('[data-role="dev"] .chip')).toHaveText("กำลังทำงาน");
    await expect(roster.locator('[data-role="dev"] .task')).toHaveText("งาน 1/2: สร้างหน้าเว็บ");
    await expect(roster.locator('[data-role="qa"] .chip')).toHaveText("ว่าง");
    await expect(page.locator("canvas")).toBeAttached();
    await expect(page.locator(".bot-label")).toHaveCount(3);
  });

  test("follows the OS theme by default", async ({ browser }) => {
    for (const scheme of ["dark", "light"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await context.close();
    }
  });

  test("theme icon in the card corner cycles and is remembered", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/");
    const toggle = page.locator(".card-head .theme-toggle");
    await expect(toggle).toHaveAttribute("data-pref", "system");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator(".theme-toggle")).toHaveAttribute("data-pref", "dark");
    await page.locator(".theme-toggle").click();
    await expect(page.locator(".theme-toggle")).toHaveAttribute("data-pref", "system");
    await context.close();
  });

  test("camera button switches between following and the whole office", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "กล้องตามบอทที่ทำงาน" });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(page.getByRole("button", { name: "มุมกว้างทั้งออฟฟิศ" })).toHaveAttribute("aria-pressed", "false");
  });

  test("demo mode works with no agents running", async ({ page }) => {
    await page.goto("/?demo=1");
    await expect(page.getByText("โหมดตัวอย่าง")).toBeVisible();
    await expect(page.locator(".roster-row")).toHaveCount(3);
  });

  test("status API is read-only JSON with security headers", async ({ request }) => {
    const res = await request.get("/api/status");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    const body = await res.json();
    expect(body.agents.map((a: { role: string }) => a.role)).toEqual(["lead", "dev", "qa"]);
    expect((await request.post("/api/status")).status()).toBe(405);
  });
});
