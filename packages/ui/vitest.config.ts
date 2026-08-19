import { defineConfig } from "vitest/config";

/**
 * packages/ui's components are DOM/JSX by nature (ADR 0003), so — unlike packages/sim, which
 * runs its ordinary suite under Node and only cross-checks determinism in a browser — everything
 * here runs under a real browser engine via the Playwright provider, same shape as packages/sim's
 * "browser" project (S1.6).
 */
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [
        {
          browser: "chromium",
          ...(chromiumExecutablePath ? { launch: { executablePath: chromiumExecutablePath } } : {}),
        },
      ],
    },
  },
});
