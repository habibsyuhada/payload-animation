import { describe, expect, it } from "vitest";
import { REPLAY_VIEWER_APP_VERSION } from "../src/index.js";

describe("@payload/replay-viewer scaffold", () => {
  it("exposes a version placeholder until B4.6 (public share viewer) lands", () => {
    expect(REPLAY_VIEWER_APP_VERSION).toBe("0.0.0");
  });
});
