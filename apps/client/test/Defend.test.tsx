import { EDGE_LENGTH_MIN_DU } from "@payload/sim";
import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Defend } from "../src/screens/Defend.js";
import { CORE_COST_PT, CORE_ID, DEFENSE_BUDGET_PT, ENTRY_COST_PT, ENTRY_ID, useDefendStore } from "../src/state/defendStore.js";
// The page is laid out entirely by CSS (fixed full-viewport shell, absolutely positioned action
// bar) — without the stylesheet its elements collapse to zero size and nothing here is clickable.
import "../src/theme.css";

let container: HTMLDivElement;
let root: Root;

/** Manually seeded node (via the store) — kept clear of the ids the page itself hands out. */
const ROUTER_ID = 7;
/** First id `addNode` assigns after a reset, i.e. the node the picker creates. */
const ADDED_NODE_ID = 3;

beforeEach(() => {
  useDefendStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() =>
    root.render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Defend />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  root.unmount();
  container.remove();
});

async function findByTestId(testId: string): Promise<Element> {
  return vi.waitFor(() => {
    const element = page.getByTestId(testId).query();
    if (!element) {
      throw new Error(`element not yet in the DOM: ${testId}`);
    }
    return element;
  });
}

async function expectGone(testId: string): Promise<void> {
  await vi.waitFor(() => {
    if (page.getByTestId(testId).query()) {
      throw new Error(`element is still in the DOM: ${testId}`);
    }
  });
}

/** Qualified by testid, not by data-node-id alone: range rings and off-screen markers carry the
 * same node id, so a bare attribute selector can land on one of those instead of the node. */
function nodeGroup(id: number): SVGGElement {
  return document.querySelector(`[data-testid=defend-node][data-node-id="${id}"]`) as SVGGElement;
}

function nodePosition(id: number): { x: number; y: number } {
  const group = nodeGroup(id);
  return { x: Number(group.getAttribute("data-node-x")), y: Number(group.getAttribute("data-node-y")) };
}

function viewport(): HTMLElement {
  return page.getByTestId("defend-viewport").element() as HTMLElement;
}

/** Waits for a node seeded straight into the store to actually reach the DOM — setState renders
 * asynchronously, so tapping right after it lands on nothing. */
async function waitForNode(id: number): Promise<void> {
  await vi.waitFor(() => {
    if (!nodeGroup(id)) {
      throw new Error(`node ${id} is not rendered yet`);
    }
  });
}

function tapNode(id: number): void {
  const group = nodeGroup(id);
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 120, pointerId: 1 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 120, clientY: 120, pointerId: 1 }));
}

/** Presses the move button and drags it — the gesture the page asks for: the node follows the
 * button, the node itself is never the drag handle. */
function dragMoveHandle(dxClient: number, dyClient: number): void {
  const handle = page.getByTestId("defend-action-move").element();
  const startX = 200;
  const startY = 200;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 2 }));
  viewport().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
  viewport().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
}

function dragBackground(dxClient: number, dyClient: number): void {
  const target = viewport();
  const startX = 60;
  const startY = 300;
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 3 }));
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 3 }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 3 }));
}

/** Two fingers moving apart by `spreadPx` on each side — a pinch-out (zoom in). */
function pinch(spreadPx: number): void {
  const target = viewport();
  const left = { x: 150, y: 300 };
  const right = { x: 250, y: 300 };
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: left.x, clientY: left.y, pointerId: 4 }));
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: right.x, clientY: right.y, pointerId: 5 }));
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: left.x - spreadPx, clientY: left.y, pointerId: 4 }));
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: right.x + spreadPx, clientY: right.y, pointerId: 5 }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: left.x - spreadPx, clientY: left.y, pointerId: 4 }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: right.x + spreadPx, clientY: right.y, pointerId: 5 }));
}

function zoomPercent(): number {
  return Number(page.getByTestId("defend-zoom-level").element()!.textContent!.replace("%", ""));
}

describe("Defend page", () => {
  it("starts with exactly one Entry and one Core node", async () => {
    await findByTestId("defend-canvas");
    const nodes = page.getByTestId("defend-node").elements();
    expect(nodes).toHaveLength(2);
    expect(nodeGroup(ENTRY_ID).getAttribute("data-node-type")).toBe("entry");
    expect(nodeGroup(CORE_ID).getAttribute("data-node-type")).toBe("core");
  });

  it("renders node silhouettes with a single uniform camera scale, so nothing stretches with the viewport shape", async () => {
    const canvas = (await findByTestId("defend-canvas")) as SVGSVGElement;
    // No viewBox at all: SVG user units are CSS pixels 1:1, and the only transform between world
    // and screen is `translate(...) scale(z)` — one z, both axes.
    expect(canvas.getAttribute("viewBox")).toBeNull();
    expect(canvas.querySelector("g")!.getAttribute("transform")).toMatch(/^translate\(-?[\d.]+ -?[\d.]+\) scale\([\d.]+\)$/);

    // Core is a diamond — equal width and height by construction, so a non-square rendered box
    // would mean the camera (or the viewport's own aspect) is stretching it.
    const core = nodeGroup(CORE_ID).querySelector("polygon")!.getBoundingClientRect();
    expect(Math.abs(core.width - core.height)).toBeLessThan(1);
  });

  it("tests the defense on demand and shows the verdict, every attacker's result, and a playable battle", async () => {
    await page.getByTestId("defend-test").click();

    const verdict = await findByTestId("defend-test-verdict");
    // Entry + Core with nothing in between: every attacker strolls in.
    expect(verdict.getAttribute("data-verdict")).toBe("too-easy");

    const trials = page.getByTestId("defend-test-trial").elements();
    expect(trials).toHaveLength(5);
    expect(trials.every((trial) => Number(trial.getAttribute("data-wins")) > 0)).toBe(true);

    const caption = await findByTestId("defend-test-showcase-caption");
    expect(caption.textContent).toContain("seed");

    await page.getByTestId("defend-test-close").click();
    await expectGone("defend-test-result");
    await expectGone("defend-playback");
  });

  it("plays the battle on the map itself — virus, health bar and sentry fire, inside the map's own camera", async () => {
    // A sentry wired between Entry and Core, so the attacker has to walk past something shooting.
    useDefendStore.setState({
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -240, y: 0 },
        { id: 10, type: "ice-sentry", tier: 1, x: 0, y: 0 },
        { id: CORE_ID, type: "core", x: 240, y: 0 },
      ],
    });

    await page.getByTestId("defend-test").click();
    const playback = await findByTestId("defend-playback");
    // Rendered inside the SVG's zoom/pan group, not as a separate canvas overlay: the battle is
    // drawn in world coordinates and inherits the camera the player set.
    expect(playback.closest("[data-testid=defend-canvas] g")).not.toBeNull();
    await findByTestId("defend-playback-virus");
    await findByTestId("defend-playback-hp");

    // Health drains as the sentry lands hits, and a tracer is drawn while a shot is live.
    const startHp = Number((await findByTestId("defend-playback-hp")).getAttribute("data-integrity"));
    await vi.waitFor(
      () => {
        const hp = Number(page.getByTestId("defend-playback-hp").query()?.getAttribute("data-integrity") ?? startHp);
        if (hp >= startHp) {
          throw new Error(`virus has not been damaged yet (${hp}%)`);
        }
      },
      { timeout: 6000 },
    );
    await vi.waitFor(
      () => {
        if (page.getByTestId("defend-playback-shot").elements().length === 0) {
          throw new Error("no sentry tracer on screen yet");
        }
      },
      { timeout: 6000 },
    );
  });

  it("can pause and scrub the battle, and scrubbing back restores the health it had then", async () => {
    await page.getByTestId("defend-test").click();
    await findByTestId("defend-playback-controls");

    await page.getByTestId("defend-playback-toggle").click(); // pause
    const scrub = (await findByTestId("defend-playback-scrub")) as HTMLInputElement;
    const late = Number(scrub.max) * 0.9;
    scrub.value = String(late);
    scrub.dispatchEvent(new Event("input", { bubbles: true }));
    const lateHp = await vi.waitFor(() => Number(page.getByTestId("defend-playback-hp").query()?.getAttribute("data-integrity") ?? "100"));

    scrub.value = "0";
    scrub.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      const hp = Number(page.getByTestId("defend-playback-hp").query()?.getAttribute("data-integrity") ?? "0");
      if (hp !== 100) {
        throw new Error(`expected full health at t=0, got ${hp}`);
      }
    });
    expect(lateHp).toBeLessThanOrEqual(100);
  });

  it("calls out a defense nothing can breach", async () => {
    // The ICE Nest composition from RULESET.md §9 — structurally fine, and unbeatable.
    useDefendStore.setState({
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -240, y: 0 },
        { id: 10, type: "firewall", tier: 3, x: 0, y: 0 },
        { id: 11, type: "ice-sentry", tier: 2, x: 0, y: -120 },
        { id: 12, type: "ice-sentry", tier: 2, x: 0, y: 120 },
        { id: CORE_ID, type: "core", x: 240, y: 0 },
      ],
    });

    await page.getByTestId("defend-test").click();
    const verdict = await findByTestId("defend-test-verdict");
    expect(verdict.getAttribute("data-verdict")).toBe("impenetrable");
    expect(verdict.textContent).toContain("ditolak");
    // With no breach anywhere, the showcase is the closest failed attempt instead.
    expect((await findByTestId("defend-test-showcase-caption")).textContent).toContain("nyaris");
  });

  it("shows the selected node's link range as a ring, and only that node's", async () => {
    await findByTestId("defend-canvas");
    expect(page.getByTestId("defend-node-range").elements()).toHaveLength(0);

    tapNode(CORE_ID);
    const ring = await findByTestId("defend-node-range");
    expect(ring.getAttribute("data-node-id")).toBe(String(CORE_ID));
    expect(page.getByTestId("defend-node-range").elements()).toHaveLength(1);
    // Centred on the node it belongs to, in the same world units the nodes are placed in.
    expect(Number(ring.getAttribute("cx"))).toBe(nodePosition(CORE_ID).x);
  });

  it("wires nodes in range together with a glowing connector", async () => {
    await findByTestId("defend-canvas");
    const links = page.getByTestId("defend-link").elements();
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect([link.getAttribute("data-from"), link.getAttribute("data-to")].sort()).toEqual([String(CORE_ID), String(ENTRY_ID)].sort());
    // Glow = a wide pulsing halo stroke under a bright thin core, not one flat line.
    expect(link.querySelectorAll("line")).toHaveLength(3);
    expect(link.querySelector(".payload-defend-link-halo")).not.toBeNull();
  });

  it("breaks the connector when a node is dragged out of range, and remakes it on the way back", async () => {
    tapNode(CORE_ID);
    await findByTestId("defend-action-move");
    const { zoom } = useDefendStore.getState();
    // 240 DU apart to start against 260 DU of reach, so +40 DU already breaks it. Deliberately no
    // further than that: pushing the node off-screen would take its move button (and the drag
    // back) with it.
    const outOfRangePx = 40 * zoom;

    dragMoveHandle(outOfRangePx, 0);
    await vi.waitFor(() => {
      if (page.getByTestId("defend-link").elements().length !== 0) {
        throw new Error("connector is still there");
      }
    });

    dragMoveHandle(-outOfRangePx, 0);
    await vi.waitFor(() => {
      if (page.getByTestId("defend-link").elements().length !== 1) {
        throw new Error("connector has not come back");
      }
    });
  });

  it("spreads nodes added one after another instead of stacking them on the same spot", async () => {
    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId("defend-add-node").click();
      await findByTestId("defend-picker");
      // Scoped to the picker: once a Router is on the map, its own label matches "Router" too.
      (document.querySelector('[data-testid=defend-picker] [data-node-type=router]') as HTMLButtonElement).click();
      await expectGone("defend-picker");
    }
    await vi.waitFor(() => {
      if (page.getByTestId("defend-node").elements().length !== 5) {
        throw new Error("not all three routers are in yet");
      }
    });

    const placed = useDefendStore.getState().nodes;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y)).toBeGreaterThan(0);
      }
    }
  });

  it("wires a newly added node to everything already in its range", async () => {
    await page.getByTestId("defend-add-node").click();
    await findByTestId("defend-picker");
    await page.getByText("Router").click();
    // Dropped at the centre of the screen, i.e. between Entry and Core: in range of both.
    await vi.waitFor(() => {
      if (page.getByTestId("defend-link").elements().length !== 3) {
        throw new Error("expected Entry-Core plus both new links");
      }
    });
  });

  it("shows the three node action buttons on tap, and hides them again on a second tap", async () => {
    tapNode(CORE_ID);
    const actions = await findByTestId("defend-node-actions");
    expect(actions).toBeDefined();
    await findByTestId("defend-action-move");
    await findByTestId("defend-action-detail");

    tapNode(CORE_ID);
    await expectGone("defend-node-actions");
  });

  it("hides the action buttons when tapping empty canvas", async () => {
    tapNode(CORE_ID);
    await findByTestId("defend-node-actions");
    viewport().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 40, pointerId: 8 }));
    viewport().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 40, pointerId: 8 }));
    await expectGone("defend-node-actions");
  });

  it("starts with a budget already spent on the Entry and the Core it came with", async () => {
    const budget = await findByTestId("defend-budget");
    expect(budget.textContent).toBe(`${ENTRY_COST_PT + CORE_COST_PT}/${DEFENSE_BUDGET_PT} pt`);
    expect(budget.getAttribute("data-remaining")).toBe(String(DEFENSE_BUDGET_PT - ENTRY_COST_PT - CORE_COST_PT));
  });

  it("lets the player add another Entry and another Core, charging the budget for both", async () => {
    await page.getByTestId("defend-add-node").click();
    await findByTestId("defend-picker");
    (document.querySelector("[data-testid=defend-picker] [data-node-type=entry]") as HTMLButtonElement).click();
    await expectGone("defend-picker");

    await page.getByTestId("defend-add-node").click();
    await findByTestId("defend-picker");
    (document.querySelector("[data-testid=defend-picker] [data-node-type=core]") as HTMLButtonElement).click();
    await expectGone("defend-picker");

    await vi.waitFor(() => {
      const nodes = useDefendStore.getState().nodes;
      if (nodes.filter((node) => node.type === "entry").length !== 2 || nodes.filter((node) => node.type === "core").length !== 2) {
        throw new Error("second Entry/Core not placed yet");
      }
    });
    expect((await findByTestId("defend-budget")).textContent).toBe(`${(ENTRY_COST_PT + CORE_COST_PT) * 2}/${DEFENSE_BUDGET_PT} pt`);
  });

  it("stops offering nodes it can no longer afford", async () => {
    // Leave 2 pt on the table: enough for a Router (1pt), not for an ICE Sentry (4pt).
    useDefendStore.setState({
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -240, y: 0 },
        { id: CORE_ID, type: "core", x: 240, y: 0 },
        { id: 20, type: "firewall", tier: 3, x: 0, y: 0 }, // 8pt
        { id: 21, type: "firewall", tier: 3, x: 0, y: 300 }, // 8pt — 20pt spent, 0 left...
      ],
    });
    await vi.waitFor(() => {
      if (page.getByTestId("defend-budget").query()?.getAttribute("data-remaining") !== "0") {
        throw new Error("budget has not updated yet");
      }
    });

    await page.getByTestId("defend-add-node").click();
    await findByTestId("defend-picker");
    const cards = page.getByTestId("defend-picker-entry").elements() as HTMLButtonElement[];
    expect(cards.length).toBeGreaterThan(0);
    // Nothing costs 0, so with an empty budget every card is refused.
    expect(cards.every((card) => card.disabled)).toBe(true);
    expect(cards.every((card) => card.getAttribute("data-affordable") === "false")).toBe(true);
  });

  it("refuses an unaffordable node even if something asks the store for it directly", async () => {
    useDefendStore.setState({
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -240, y: 0 },
        { id: CORE_ID, type: "core", x: 240, y: 0 },
        { id: 20, type: "firewall", tier: 3, x: 0, y: 0 },
        { id: 21, type: "firewall", tier: 3, x: 0, y: 300 },
      ],
    });
    const before = useDefendStore.getState().nodes.length;
    useDefendStore.getState().addNode("ice-sentry", 0, 600, 3);
    expect(useDefendStore.getState().nodes).toHaveLength(before);
  });

  it("allows deleting an extra Entry or Core, but never the last one", async () => {
    useDefendStore.setState({
      // Kept inside the camera's opening frame: the action bar hides for a node that's off
      // screen, and this test is about the buttons on it.
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -120, y: 0 },
        { id: 30, type: "entry", x: -120, y: 180 },
        { id: CORE_ID, type: "core", x: 120, y: 0 },
      ],
    });

    // Two entries: the extra one can go.
    await waitForNode(30);
    tapNode(30);
    await page.getByTestId("defend-action-remove").click();
    await vi.waitFor(() => {
      if (useDefendStore.getState().nodes.some((node) => node.id === 30)) {
        throw new Error("extra entry is still there");
      }
    });

    // One entry left: no delete button at all, and the store refuses it too.
    tapNode(ENTRY_ID);
    await findByTestId("defend-node-actions");
    expect(page.getByTestId("defend-action-remove").elements()).toHaveLength(0);
    useDefendStore.getState().removeNode(ENTRY_ID);
    expect(useDefendStore.getState().nodes.some((node) => node.id === ENTRY_ID)).toBe(true);
  });

  it("shows an ICE Sentry's fire range in hops, marking the nodes it actually covers", async () => {
    useDefendStore.setState({
      nodes: [
        { id: ENTRY_ID, type: "entry", x: -240, y: 0 },
        { id: 40, type: "ice-sentry", tier: 1, x: 0, y: 0 },
        { id: CORE_ID, type: "core", x: 240, y: 0 },
      ],
    });

    await waitForNode(40);
    tapNode(40);
    const range = await findByTestId("defend-fire-range");
    // Tier 1 reaches 1 hop; wired to both neighbours, that's Entry and Core.
    expect(range.getAttribute("data-hops")).toBe("1");
    expect(range.getAttribute("data-covered")).toBe("2");
    expect(page.getByTestId("defend-fire-target").elements()).toHaveLength(2);

    // A node that doesn't shoot doesn't get one.
    tapNode(CORE_ID);
    await expectGone("defend-fire-range");
  });

  it("offers no delete button for Entry or Core", async () => {
    tapNode(CORE_ID);
    await findByTestId("defend-node-actions");
    expect(page.getByTestId("defend-action-remove").elements()).toHaveLength(0);

    tapNode(CORE_ID);
    tapNode(ENTRY_ID);
    await findByTestId("defend-node-actions");
    expect(page.getByTestId("defend-action-remove").elements()).toHaveLength(0);
  });

  it("adds the picked node type at the centre of the screen, already selected", async () => {
    await page.getByTestId("defend-add-node").click();
    await findByTestId("defend-picker");
    await page.getByText("Router").click();
    await expectGone("defend-picker");

    await vi.waitFor(() => {
      if (page.getByTestId("defend-node").elements().length !== 3) {
        throw new Error("new node not rendered yet");
      }
    });
    expect(nodeGroup(ADDED_NODE_ID).getAttribute("data-node-type")).toBe("router");
    // Lands where the camera is looking — at the centre of the screen, or as close to it as the
    // minimum placement gap allows when something is already sitting there (see freeSpotNear).
    const { zoom, offsetX, offsetY } = useDefendStore.getState();
    const rect = viewport().getBoundingClientRect();
    const added = nodePosition(ADDED_NODE_ID);
    const screenX = added.x * zoom + offsetX;
    const screenY = added.y * zoom + offsetY;
    expect(Math.hypot(screenX - rect.width / 2, screenY - rect.height / 2)).toBeLessThanOrEqual(EDGE_LENGTH_MIN_DU * zoom + 1);
    // Still comfortably on screen, so "it appeared where I was looking" holds either way.
    expect(screenX).toBeGreaterThan(0);
    expect(screenX).toBeLessThan(rect.width);
    expect(screenY).toBeGreaterThan(0);
    expect(screenY).toBeLessThan(rect.height);
    // Selected on arrival, so its action buttons — delete included — are already up.
    await findByTestId("defend-node-actions");
    await findByTestId("defend-action-remove");
  });

  it("deletes an ordinary node via its delete button", async () => {
    useDefendStore.setState((state) => ({ nodes: [...state.nodes, { id: ROUTER_ID, type: "router" as const, x: 0, y: 120 }] }));
    await vi.waitFor(() => {
      if (page.getByTestId("defend-node").elements().length !== 3) {
        throw new Error("router node not rendered yet");
      }
    });

    tapNode(ROUTER_ID);
    await page.getByTestId("defend-action-remove").click();
    await vi.waitFor(() => {
      if (page.getByTestId("defend-node").elements().length !== 2) {
        throw new Error("router node is still there");
      }
    });
  });

  it("moves a node by dragging its move button, not the node itself", async () => {
    tapNode(CORE_ID);
    await findByTestId("defend-action-move");
    const before = nodePosition(CORE_ID);

    dragMoveHandle(48, 24);

    await vi.waitFor(() => {
      const after = nodePosition(CORE_ID);
      if (after.x === before.x || after.y === before.y) {
        throw new Error("node has not moved yet");
      }
    });
  });

  it("leaves the node where it is when the node itself is dragged", async () => {
    const before = nodePosition(CORE_ID);
    const group = nodeGroup(CORE_ID);
    group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 200, pointerId: 6 }));
    viewport().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 280, clientY: 240, pointerId: 6 }));
    group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 280, clientY: 240, pointerId: 6 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(nodePosition(CORE_ID)).toEqual(before);
  });

  it("opens a detail window for the node, and closes it again", async () => {
    tapNode(ENTRY_ID);
    await page.getByTestId("defend-action-detail").click();
    const detail = await findByTestId("defend-detail");
    expect(detail.textContent).toContain("Entry");
    expect((await findByTestId("defend-detail-position")).textContent).toContain("-120, 0");
    expect((await findByTestId("defend-detail-links")).textContent).toContain("1 node");

    await page.getByTestId("defend-detail-close").click();
    await expectGone("defend-detail");
  });

  it("pans the camera by dragging the background", async () => {
    const canvas = (await findByTestId("defend-canvas")) as SVGSVGElement;
    const before = canvas.querySelector("g")!.getAttribute("transform")!;
    dragBackground(70, 35);
    await vi.waitFor(() => {
      if (canvas.querySelector("g")!.getAttribute("transform") === before) {
        throw new Error("camera has not moved yet");
      }
    });
  });

  it("zooms in on a two-finger pinch-out and out on a pinch-in", async () => {
    await findByTestId("defend-zoom-level");
    const initial = zoomPercent();

    pinch(60);
    const zoomedIn = await vi.waitFor(() => {
      const pct = zoomPercent();
      if (pct <= initial) {
        throw new Error("pinch-out has not zoomed in yet");
      }
      return pct;
    });

    pinch(-40);
    await vi.waitFor(() => {
      if (zoomPercent() >= zoomedIn) {
        throw new Error("pinch-in has not zoomed out yet");
      }
    });
  });

  it("marks a node the camera has panned off-screen, pointing in its direction, and none while both are visible", async () => {
    await findByTestId("defend-canvas");
    expect(page.getByTestId("defend-offscreen-marker").elements()).toHaveLength(0);

    // Shove the camera far to the right of both nodes: they now lie off the left edge.
    const { zoom, offsetY } = useDefendStore.getState();
    useDefendStore.setState({ offsetX: -2000 * zoom, offsetY });

    const markers = await vi.waitFor(() => {
      const found = page.getByTestId("defend-offscreen-marker").elements();
      if (found.length !== 2) {
        throw new Error(`expected both nodes to be marked, got ${found.length}`);
      }
      return found;
    });
    for (const marker of markers) {
      // atan2 of a straight-left direction is ±180°.
      expect(Math.abs(Number(marker.getAttribute("data-angle")))).toBeGreaterThan(150);
      expect(marker.getAttribute("aria-label")).toMatch(/Entry|Core/);
    }
  });

  it("puts the action buttons away while their node is off-screen, and brings them back with it", async () => {
    tapNode(CORE_ID);
    await findByTestId("defend-node-actions");

    const { zoom, offsetX } = useDefendStore.getState();
    useDefendStore.setState({ offsetX: -2000 * zoom });
    await expectGone("defend-node-actions");

    useDefendStore.setState({ offsetX });
    await findByTestId("defend-node-actions");
  });

  it("brings a node back into view when its off-screen marker is tapped", async () => {
    const { zoom } = useDefendStore.getState();
    useDefendStore.setState({ offsetX: -2000 * zoom });
    await vi.waitFor(() => {
      if (!document.querySelector(`[data-testid=defend-offscreen-marker][data-node-id="${CORE_ID}"]`)) {
        throw new Error("Core's off-screen marker has not appeared yet");
      }
    });

    document.querySelector(`[data-testid=defend-offscreen-marker][data-node-id="${CORE_ID}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Core is back on screen, so its own marker is gone...
    await vi.waitFor(() => {
      if (document.querySelector(`[data-testid=defend-offscreen-marker][data-node-id="${CORE_ID}"]`)) {
        throw new Error("Core is still marked as off-screen");
      }
    });
    // ...and centred: its screen position is the middle of the viewport.
    const state = useDefendStore.getState();
    const rect = viewport().getBoundingClientRect();
    const core = state.nodes.find((node) => node.id === CORE_ID)!;
    expect(core.x * state.zoom + state.offsetX).toBeCloseTo(rect.width / 2, 0);
    expect(core.y * state.zoom + state.offsetY).toBeCloseTo(rect.height / 2, 0);
  });

  it("zooms with the mouse wheel too", async () => {
    await findByTestId("defend-zoom-level");
    const initial = zoomPercent();
    viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200 }));
    await vi.waitFor(() => {
      if (zoomPercent() <= initial) {
        throw new Error("wheel zoom has not applied yet");
      }
    });
  });
});
