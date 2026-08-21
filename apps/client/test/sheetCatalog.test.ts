import { ACTION_SPECS_V2, CONDITION_SPECS_V2 } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { ACTION_CATALOG, CATALOG_COVERS_EVERY_KIND, CONDITION_CATALOG } from "../src/data/sheetCatalog.js";

/**
 * sheetCatalog.ts's own completeness net (PLAN.md 8.4): a kind the sim prices but the client has
 * nothing to say about would only ever surface as `findConditionEntry`/`findActionEntry` throwing
 * deep inside the editor. `CATALOG_COVERS_EVERY_KIND` already computes this; this test is what
 * makes CI actually fail when it goes false, instead of the constant sitting unused.
 */
describe("sheetCatalog completeness", () => {
  it("gives every v2 condition and action kind a catalog entry", () => {
    expect(CATALOG_COVERS_EVERY_KIND).toBe(true);
  });

  it("names exactly the kinds ruleset-v2.ts prices, no more and no fewer", () => {
    expect(CONDITION_CATALOG.map((entry) => entry.kind).sort()).toEqual(CONDITION_SPECS_V2.map((spec) => spec.kind).sort());
    expect(ACTION_CATALOG.map((entry) => entry.kind).sort()).toEqual(ACTION_SPECS_V2.map((spec) => spec.kind).sort());
  });

  it("gives set-flag both of its parameters — the two-parameter chip PLAN.md 8.4 flags for a manual 390px check", () => {
    const entry = ACTION_CATALOG.find((candidate) => candidate.kind === "set-flag")!;
    expect(entry.params.map((param) => param.key).sort()).toEqual(["flagIndex", "flagValue"]);
  });

  it("never gives a param spec a key the corresponding instance field doesn't exist for", () => {
    // A cross-check that would otherwise only fail at runtime the first time that condition/action renders.
    const knownConditionKeys = new Set(["targetNodeType", "integrityThresholdPermille", "thresholdPermille", "hops", "ticks", "flagIndex", "count"]);
    const knownActionKeys = new Set(["targetNodeType", "flagIndex", "flagValue"]);
    for (const entry of CONDITION_CATALOG) {
      for (const param of entry.params) {
        expect(knownConditionKeys.has(param.key)).toBe(true);
      }
    }
    for (const entry of ACTION_CATALOG) {
      for (const param of entry.params) {
        expect(knownActionKeys.has(param.key)).toBe(true);
      }
    }
  });
});
