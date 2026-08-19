import { describe, expect, it } from "vitest";
import { BALANCE_LAB_VERSION } from "../src/index.js";

describe("@payload/balance-lab scaffold", () => {
  it("exposes a version placeholder until S1.7 (winrate CLI) lands", () => {
    expect(BALANCE_LAB_VERSION).toBe("0.0.0");
  });
});
