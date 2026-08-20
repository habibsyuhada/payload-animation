import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Defend } from "../src/screens/Defend.js";
import { CORE_ID, ENTRY_ID, useDefendStore } from "../src/state/defendStore.js";
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
    // Centre of the screen in world coordinates, per the camera's own transform.
    const { zoom, offsetX, offsetY } = useDefendStore.getState();
    const rect = viewport().getBoundingClientRect();
    const added = nodePosition(ADDED_NODE_ID);
    expect(added.x * zoom + offsetX).toBeCloseTo(rect.width / 2, 0);
    expect(added.y * zoom + offsetY).toBeCloseTo(rect.height / 2, 0);
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
