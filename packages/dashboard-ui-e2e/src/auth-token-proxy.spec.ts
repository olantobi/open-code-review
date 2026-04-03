import { test, expect } from "@playwright/test";

/**
 * Regression test for the dev proxy port mismatch bug.
 *
 * When the Vite proxy targeted the wrong Express server port, the
 * /auth/token request returned Vite's index.html (HTML) instead of
 * JSON. The client tried to parse it as JSON and failed with:
 *   "Unexpected token '<', <!DOCTYPE... is not valid JSON"
 */

test.describe("auth proxy", () => {
  test("/auth/token through the proxy returns JSON, not HTML", async ({
    request,
  }) => {
    // Direct API request through the Vite proxy — the most deterministic
    // way to verify the proxy forwards to the correct Express server.
    // Does not depend on client boot behavior.
    const res = await request.get("/auth/token");

    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");

    const body = await res.json();
    expect(body).toHaveProperty("token");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  test("dashboard loads without SyntaxError on auth", async ({ page }) => {
    // Full page load — verifies the client successfully parses the
    // /auth/token response. If the proxy is wrong, this fails with
    // "Unexpected token '<'" in the console.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // Give the app a moment to complete its auth flow
    await page.waitForTimeout(2_000);

    const syntaxErrors = consoleErrors.filter((e) =>
      e.includes("SyntaxError"),
    );
    expect(syntaxErrors).toHaveLength(0);
  });
});
