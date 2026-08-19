import { describe, expect, it } from "vitest";
import { compatibleSimVersion } from "../src/index.js";

describe("@payload/replay scaffold", () => {
  it("can import types/values from @payload/sim across the workspace boundary", () => {
    expect(compatibleSimVersion).toBe("0.0.0");
  });
});
