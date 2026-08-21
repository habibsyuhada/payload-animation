import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageKey } from "../src/state/localPersist.js";
import { useDefendStore } from "../src/state/defendStore.js";
import { useResearchStore } from "../src/state/researchStore.js";
import { useVirusLabStore } from "../src/state/virusLabStore.js";

/**
 * researchStore.test.ts — PLAN.md 8.7's acceptance criteria not already covered by
 * research-gating.test.tsx/Research.test.tsx: `research()`'s own spend/refuse rules, `claimOnce`'s
 * once-per-source guarantee, and the two things that only show up across a real reload —
 * persistence and the ADR 0009 §D one-time migration ("sheet lama yang tersimpan tetap legal").
 * Same "drive the real reload, not just the JSON" discipline as localPersist.test.ts.
 */

const RESEARCH_KEY = storageKey("research");
const VIRUS_KEY = storageKey("virus-lab");
const DEFEND_KEY = storageKey("defend");

beforeEach(() => {
  localStorage.removeItem(RESEARCH_KEY);
  localStorage.removeItem(VIRUS_KEY);
  localStorage.removeItem(DEFEND_KEY);
  useResearchStore.getState().reset();
  useVirusLabStore.getState().reset();
  useDefendStore.getState().reset();
});

afterEach(() => {
  localStorage.removeItem(RESEARCH_KEY);
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

describe("research()", () => {
  it("spends Data and completes a node whose prerequisites are met", () => {
    useResearchStore.getState().grantData(150);
    expect(useResearchStore.getState().research("serbuan.exploit.1")).toBe(true);
    expect(useResearchStore.getState().data).toBe(0);
    expect(useResearchStore.getState().completed).toContain("serbuan.exploit.1");
  });

  it("refuses when Data is short, without spending or completing anything", () => {
    useResearchStore.getState().grantData(100); // exploit.1 costs 150.
    expect(useResearchStore.getState().research("serbuan.exploit.1")).toBe(false);
    expect(useResearchStore.getState().data).toBe(100);
    expect(useResearchStore.getState().completed).not.toContain("serbuan.exploit.1");
  });

  it("refuses when a prerequisite is missing", () => {
    useResearchStore.getState().grantData(1000);
    // serbuan.exploit.2 requires serbuan.exploit.1, not yet researched.
    expect(useResearchStore.getState().research("serbuan.exploit.2")).toBe(false);
    expect(useResearchStore.getState().data).toBe(1000);
  });

  it("refuses an unknown node id", () => {
    useResearchStore.getState().grantData(1000);
    expect(useResearchStore.getState().research("not-a-real-node")).toBe(false);
  });
});

describe("claimOnce()", () => {
  it("pays out the first time and refuses every time after, for the same sourceId", () => {
    expect(useResearchStore.getState().claimOnce("dry-simulation:latihan-1", 80)).toBe(true);
    expect(useResearchStore.getState().data).toBe(80);
    expect(useResearchStore.getState().claimOnce("dry-simulation:latihan-1", 80)).toBe(false);
    expect(useResearchStore.getState().data).toBe(80);
  });

  it("tracks distinct sourceIds independently", () => {
    useResearchStore.getState().claimOnce("layout:abc", 200);
    useResearchStore.getState().claimOnce("layout:def", 200);
    expect(useResearchStore.getState().data).toBe(400);
  });
});

describe("unlockNode()", () => {
  it("adds a node to completed without touching Data, and is idempotent", () => {
    useResearchStore.getState().unlockNode("bayangan.cloak.1");
    expect(useResearchStore.getState().completed).toContain("bayangan.cloak.1");
    expect(useResearchStore.getState().data).toBe(0);
    const before = useResearchStore.getState().completed.length;
    useResearchStore.getState().unlockNode("bayangan.cloak.1");
    expect(useResearchStore.getState().completed.length).toBe(before);
  });
});

describe("persistence", () => {
  it("writes Data, completed, and claimed to storage on every edit — never the actions", () => {
    useResearchStore.getState().grantData(50);
    expect(Object.keys(storedState<object>(RESEARCH_KEY)).sort()).toEqual(["claimed", "completed", "data", "version"]);
  });

  it("survives a reload: Data, completed nodes, and claimed sources are all restored", () => {
    useResearchStore.getState().grantData(500);
    useResearchStore.getState().research("serbuan.exploit.1");
    useResearchStore.getState().claimOnce("layout:xyz", 200);

    useResearchStore.persist.rehydrate();

    expect(useResearchStore.getState().data).toBe(500 - 150 + 200);
    expect(useResearchStore.getState().completed).toContain("serbuan.exploit.1");
    expect(useResearchStore.getState().claimed["layout:xyz"]).toBeDefined();
  });
});

describe("ADR 0009 §D migration — legacy sheet/layout stays legal", () => {
  it("on a device with an empty `completed` list, grants the Inti starter set plus every kind the saved sheet/layout already use", async () => {
    // Simulate a pre-research player: a sheet using `exploit` (unresearched by default) and a
    // layout with an `ice-sentry` tier 2 (also unresearched), saved before research existed.
    const rowId = useVirusLabStore.getState().rows[0]!.id;
    useVirusLabStore.getState().addAction(rowId, "exploit");
    useDefendStore.getState().addNode("ice-sentry", 400, 0, 2);

    localStorage.setItem(RESEARCH_KEY, JSON.stringify({ version: 1, state: { data: 0, completed: [], claimed: {} } }));
    useResearchStore.persist.rehydrate();

    await vi.waitFor(() => {
      if (useResearchStore.getState().completed.length === 0) {
        throw new Error("migration has not run yet");
      }
    });

    const completed = useResearchStore.getState().completed;
    expect(completed).toContain("inti.move-toward-core"); // Inti starter set.
    expect(completed).toContain("serbuan.exploit.1"); // covers the used `exploit` action.
    // ice-sentry tier 2 needs coverage up to tier 2 — tier 1's node alone would leave it locked.
    expect(completed).toContain("pengintaian.ice-sentry.2");
  });

  it("never re-runs once `completed` is non-empty — a later rehydrate does not reset progress researched since", async () => {
    useResearchStore.getState().grantData(1000);
    useResearchStore.getState().research("bayangan.cloak.1");
    const before = [...useResearchStore.getState().completed];

    useResearchStore.persist.rehydrate();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let any stray microtask settle.

    expect(useResearchStore.getState().completed).toEqual(before);
  });
});
