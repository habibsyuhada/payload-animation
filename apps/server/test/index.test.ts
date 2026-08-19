import { describe, expect, it } from "vitest";
import { SERVER_APP_VERSION } from "../src/index.js";

describe("@payload/server scaffold", () => {
  it("exposes a version placeholder until B4.1 (Fastify + DB schema) lands", () => {
    expect(SERVER_APP_VERSION).toBe("0.0.0");
  });
});
