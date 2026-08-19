import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_VERSION } from "../src/index.js";

describe("@payload/shared scaffold", () => {
  it("exposes a package version placeholder until DTOs/zod schemas land", () => {
    expect(SHARED_PACKAGE_VERSION).toBe("0.0.0");
  });
});
