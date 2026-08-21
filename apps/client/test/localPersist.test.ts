import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { highestIdSuffix, storageKey } from "../src/state/localPersist.js";
import { useDefendStore } from "../src/state/defendStore.js";
import { useVirusLabStore } from "../src/state/virusLabStore.js";

/**
 * Offline-first, step 1: what the player authored survives a reload.
 *
 * A reload can't be staged inside one test run, so these drive the real thing a reload does —
 * write to storage, then `persist.rehydrate()` — rather than asserting on the JSON alone. The
 * id-collision cases matter most: they only ever appear *after* a restore, which is exactly when
 * nobody is watching.
 */

const VIRUS_KEY = storageKey("virus-lab");
const DEFEND_KEY = storageKey("defend");

beforeEach(() => {
  localStorage.removeItem(VIRUS_KEY);
  localStorage.removeItem(DEFEND_KEY);
  useVirusLabStore.getState().reset();
  useDefendStore.getState().reset();
});

afterEach(() => {
  localStorage.removeItem(VIRUS_KEY);
  localStorage.removeItem(DEFEND_KEY);
});

function storedState<T>(key: string): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    throw new Error(`nothing stored under ${key}`);
  }
  return JSON.parse(raw).state as T;
}

describe("highestIdSuffix", () => {
  it("finds the largest counter suffix across mixed prefixes", () => {
    expect(highestIdSuffix(["row-1", "cond-12", "act-7"])).toBe(12);
  });

  it("ignores ids it cannot read a number out of, and handles an empty list", () => {
    expect(highestIdSuffix([])).toBe(0);
    expect(highestIdSuffix(["row-", "weird", "act-3"])).toBe(3);
  });
});

describe("Virus Lab persistence", () => {
  it("writes the authored sheet to storage on every edit", () => {
    const rowId = useVirusLabStore.getState().rows[0]!.id;
    useVirusLabStore.getState().addAction(rowId, "brute-force");

    const stored = storedState<{ rows: { actions: { kind: string }[] }[] }>(VIRUS_KEY);
    expect(stored.rows[0]!.actions.map((action) => action.kind)).toEqual(["move-toward-core", "brute-force"]);
  });

  it("stores only the sheet — never the store's own actions", () => {
    useVirusLabStore.getState().addRow(null);
    expect(Object.keys(storedState<object>(VIRUS_KEY))).toEqual(["rows"]);
  });

  it("restores a saved sheet, and never hands out an id that sheet already uses", () => {
    localStorage.setItem(
      VIRUS_KEY,
      JSON.stringify({
        version: 1,
        state: { rows: [{ id: "row-9", conditions: [{ id: "cond-11", kind: "at-node", negate: false, tier: 1, targetNodeType: "firewall", integrityThresholdPermille: 500 }], actions: [], children: [], once: null }] },
      }),
    );
    useVirusLabStore.persist.rehydrate();

    expect(useVirusLabStore.getState().rows.map((row) => row.id)).toEqual(["row-9"]);

    useVirusLabStore.getState().addRow(null);
    const ids = useVirusLabStore.getState().rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).not.toBe("row-9");
  });

  it("falls back to the starter sheet for a version it cannot read, instead of rehydrating a broken shape", () => {
    localStorage.setItem(VIRUS_KEY, JSON.stringify({ version: 99, state: { rows: "not a sheet at all" } }));
    useVirusLabStore.persist.rehydrate();

    const rows = useVirusLabStore.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actions.map((action) => action.kind)).toEqual(["move-toward-core"]);
  });
});

describe("Defend persistence", () => {
  it("writes the node layout to storage on every edit", () => {
    useDefendStore.getState().addNode("firewall", 400, 0, 1);
    const stored = storedState<{ nodes: { type: string }[] }>(DEFEND_KEY);
    expect(stored.nodes.map((node) => node.type)).toEqual(["entry", "core", "firewall"]);
  });

  it("stores the layout but not the camera — the page re-frames the whole graph on open", () => {
    useDefendStore.getState().panBy(120, 90);
    expect(Object.keys(storedState<object>(DEFEND_KEY))).toEqual(["nodes"]);
  });

  it("restores a saved layout, and never hands out a node id that layout already uses", () => {
    localStorage.setItem(
      DEFEND_KEY,
      JSON.stringify({
        version: 1,
        state: {
          nodes: [
            { id: 2, type: "entry", x: -120, y: 0 },
            { id: 1, type: "core", x: 120, y: 0 },
            { id: 7, type: "firewall", tier: 1, x: 0, y: 0 },
          ],
        },
      }),
    );
    useDefendStore.persist.rehydrate();

    expect(useDefendStore.getState().nodes.map((node) => node.id)).toEqual([2, 1, 7]);

    useDefendStore.getState().addNode("router", 600, 0);
    const ids = useDefendStore.getState().nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeGreaterThan(7);
  });

  it("reset clears the saved layout back to the starting pair", () => {
    useDefendStore.getState().addNode("firewall", 400, 0, 1);
    useDefendStore.getState().reset();
    expect(storedState<{ nodes: unknown[] }>(DEFEND_KEY).nodes).toHaveLength(2);
  });
});
