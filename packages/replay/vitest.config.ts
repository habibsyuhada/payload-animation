import { defineConfig } from "vitest/config";

/**
 * Same two-project split as packages/sim's S1.6 setup and packages/ui's browser project: most of
 * this package (ease/compile/camera/draw/gif) is portable and runs under plain Node, but
 * export.ts (R2.5) needs a real `HTMLCanvasElement` + `MediaRecorder`, so its test needs an actual
 * browser engine.
 */
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/export.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["test/export.test.ts"],
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
