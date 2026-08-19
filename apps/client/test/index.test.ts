import { describe, expect, it } from "vitest";
import { CLIENT_APP_VERSION } from "../src/index.js";

describe("@payload/client scaffold", () => {
  it("exposes a version placeholder until C3.1 (Vite shell) lands", () => {
    expect(CLIENT_APP_VERSION).toBe("0.0.0");
  });
});
