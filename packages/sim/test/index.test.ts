import { describe, expect, it } from "vitest";
import { SIM_PACKAGE_VERSION } from "../src/index.js";

describe("@payload/sim scaffold", () => {
  it("exposes a package version placeholder until S1.1 lands", () => {
    expect(SIM_PACKAGE_VERSION).toBe("0.0.0");
  });
});
