import { describe, expect, it } from "vitest";
import { UI_PACKAGE_VERSION } from "../src/index.js";

describe("@payload/ui scaffold", () => {
  it("exposes a package version placeholder until reusable components land", () => {
    expect(UI_PACKAGE_VERSION).toBe("0.0.0");
  });
});
