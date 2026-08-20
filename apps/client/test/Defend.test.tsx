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

const ROUTER_ID = 7;

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

function nodeGroup(id: number): SVGGElement {
  return document.querySelector(`[data-node-id="${id}"]`) as SVGGElement;
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
    expect((await findByTestId("defend-detail-position")).textContent).toContain("-170, 0");

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
