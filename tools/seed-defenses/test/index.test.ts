import { describe, expect, it } from "vitest";
import { SEED_DEFENSES_VERSION } from "../src/index.js";

describe("@payload/seed-defenses scaffold", () => {
  it("exposes a version placeholder until M5.4 (AI defense generator) lands", () => {
    expect(SEED_DEFENSES_VERSION).toBe("0.0.0");
  });
});
