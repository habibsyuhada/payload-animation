import { defineConfig } from "vitest/config";

/**
 * Two projects so the exact same test/**.test.ts files run under both Node and a real browser
 * engine (S1.6) — `pnpm test` (Node only) stays the fast default everyone runs locally and in
 * the main CI job; `pnpm test:browser` (or `test:all-platforms` for both) is the determinism
 * cross-check, wired into its own CI job since it needs Playwright's Chromium installed.
 */
// Only set locally, e.g. to point at a pre-installed browser instead of Playwright's own
// managed download (see the environment notes on this repo's dev sandbox). Real CI runs a
// normal `playwright install chromium` and leaves this unset, so the provider uses its default.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["test/determinism.test.ts"],
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
      },
    ],
  },
});
