import { defineConfig } from "vitest/config";

/** Same pattern as packages/ui (ADR 0003): the client shell is DOM/JSX by nature, so its whole suite runs against a real Chromium via the Playwright provider. */
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
