import { page } from "@vitest/browser/context";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefenseGrid } from "../src/screens/DefenseGrid.js";
import { useDefenseGridStore } from "../src/state/defenseGridStore.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useDefenseGridStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<DefenseGrid />));
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

async function waitForNodeCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (page.getByTestId("grid-node").elements().length !== count) {
      throw new Error(`expected ${count} nodes`);
    }
  });
}

async function waitForEdgeCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (page.getByTestId("grid-edge").elements().length !== count) {
      throw new Error(`expected ${count} edges`);
    }
  });
}

const VIEWBOX_WIDTH = 560;
const VIEWBOX_HEIGHT = 500;

/** x/y are in the SVG's own viewBox units (matching the positions baked into defenseGridStore's
 * INITIAL_NODES) — converted to actual screen coordinates via the rendered/viewBox size ratio,
 * mirroring the DefenseGrid component's own clientToSvgPoint (see its comment: the rendered pixel
 * box is very unlikely to equal the viewBox 1:1, `preserveAspectRatio="none"` keeps this a simple
 * per-axis ratio with no letterboxing offset to account for). */
function clickCanvasAt(x: number, y: number): void {
  const canvas = page.getByTestId("grid-canvas").element() as SVGSVGElement;
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + x * (rect.width / VIEWBOX_WIDTH);
  const clientY = rect.top + y * (rect.height / VIEWBOX_HEIGHT);
  canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
}

/** Opens the Node tool's picker modal, clicks the entry matching `label` (e.g. "Router",
 * "Firewall" — the modal card's own text, not the old inline palette button's "Label (Npt+)"
 * text), and waits for the modal to close — mirroring the real flow: pick a type, then tap the
 * grid (clickCanvasAt) to actually place it. */
async function armNodeViaModal(label: string): Promise<void> {
  await page.getByTestId("tool-node").click();
  await findByTestId("node-modal");
  await page.getByText(label).click();
  await vi.waitFor(() => {
    if (page.getByTestId("node-modal").query()) {
      throw new Error("node-picker modal is still open");
    }
  });
}

/** Drags the empty canvas background (a point away from every fixed node) by a client-pixel
 * delta, panning the camera — mirrors dragNode below but starting the press on the canvas itself
 * rather than a node group. */
function dragBackgroundBy(dxClient: number, dyClient: number): void {
  const canvas = page.getByTestId("grid-canvas").element() as SVGSVGElement;
  const rect = canvas.getBoundingClientRect();
  // (300, 60) in viewBox units sits well clear of Core (480,250) and both Entries (40,100 / 40,400).
  const startX = rect.left + 300 * (rect.width / VIEWBOX_WIDTH);
  const startY = rect.top + 60 * (rect.height / VIEWBOX_HEIGHT);
  canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 9 }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 9 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 9 }));
}

function nodeGroup(id: number): SVGGElement {
  return document.querySelector(`[data-node-id="${id}"]`) as SVGGElement;
}

/** Nodes render as different SVG shapes (circle/rect/polygon) depending on type — see NodeGlyph
 * in DefenseGrid.tsx — so tests read a node's world position off the group's own data-node-x/y
 * (set directly from the store's node.x/y) rather than parsing shape-specific geometry attrs. */
function nodePosition(id: number): { x: number; y: number } {
  const group = nodeGroup(id);
  return { x: Number(group.getAttribute("data-node-x")), y: Number(group.getAttribute("data-node-y")) };
}

function tapNode(id: number): void {
  const group = nodeGroup(id);
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1, pointerId: 1 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 1, clientY: 1, pointerId: 1 }));
}

/** A tap with a couple of pixels of incidental wobble between press and release, same as a real
 * finger or mouse produces — must still count as a tap (see DRAG_THRESHOLD_PX's comment in
 * DefenseGrid.tsx), not a drag. */
function tapNodeWithJitter(id: number, jitterPx: number): void {
  const group = nodeGroup(id);
  const startX = 100;
  const startY = 100;
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 3 }));
  document.querySelector("[data-testid=grid-canvas]")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + jitterPx, clientY: startY, pointerId: 3 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + jitterPx, clientY: startY, pointerId: 3 }));
}

function dragNode(id: number, dxClient: number, dyClient: number): void {
  const group = nodeGroup(id);
  const startX = 100;
  const startY = 100;
  group.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: startY, pointerId: 2 }));
  document.querySelector("[data-testid=grid-canvas]")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
  group.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX + dxClient, clientY: startY + dyClient, pointerId: 2 }));
}

describe("DefenseGrid", () => {
  it("starts with exactly 3 fixed nodes (2 Entry + 1 Core), no edges, and the Hand tool active", async () => {
    await waitForNodeCount(3);
    const edges = page.getByTestId("grid-edge").elements();
    expect(edges).toHaveLength(0);
    const handTool = (await findByTestId("tool-hand")) as HTMLButtonElement;
    expect(handTool.getAttribute("aria-pressed")).toBe("true");
  });

  it("reports an unreachable-entry validation error initially (no edges at all)", async () => {
    const panel = await findByTestId("validation-panel");
    expect(panel.textContent).toContain("has no path to core");
  });

  it("places a new node on the canvas after arming a type via the Node-tool picker and tapping the grid", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(250, 250);
    await waitForNodeCount(4);
    const budgetText = await findByTestId("defense-budget-text");
    expect(budgetText.textContent).toContain("1 / 20 pt");
  });

  it("keeps the Node tool armed after placing (stamp mode), so tapping again places another of the same type", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(200, 200);
    await waitForNodeCount(4);
    clickCanvasAt(320, 320);
    await waitForNodeCount(5);
    const budgetText = await findByTestId("defense-budget-text");
    expect(budgetText.textContent).toContain("2 / 20 pt");
  });

  it("switching to the Hand or Line tool disarms the Node tool", async () => {
    await armNodeViaModal("Router");
    await findByTestId("armed-strip");
    await page.getByTestId("tool-hand").click();
    expect(page.getByTestId("armed-strip").elements()).toHaveLength(0);
  });

  it("pans the camera by dragging the empty background, shifting where new nodes land on-screen", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(250, 250);
    await waitForNodeCount(4);
    const first = nodePosition(4);
    expect(Math.abs(first.x - 250)).toBeLessThanOrEqual(2);
    expect(Math.abs(first.y - 250)).toBeLessThanOrEqual(2);

    dragBackgroundBy(-120, -60);

    await armNodeViaModal("Firewall");
    clickCanvasAt(250, 250); // same screen spot as before — should now land at a different world point
    await waitForNodeCount(5);
    const second = nodePosition(5);

    expect(second.x).not.toBeCloseTo(first.x, 0);
    expect(second.y).not.toBeCloseTo(first.y, 0);
  });

  it("shows a tier selector in the armed strip for tiered node types but not for Router", async () => {
    await armNodeViaModal("Router");
    expect(page.getByTestId("pending-tier-select").elements()).toHaveLength(0);
    await armNodeViaModal("Firewall");
    await findByTestId("pending-tier-select");
  });

  it("removes a placed node via its remove marker, taking its edges with it", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(250, 250);
    await waitForNodeCount(4);
    await page.getByTestId("grid-node-remove").click();
    await waitForNodeCount(3);
  });

  it("links two nodes into an edge on tap-tap under the Line tool, and un-links on tap-tap again", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);

    await page.getByTestId("tool-line").click();
    tapNode(2); // entry 1
    tapNode(4); // the new router
    await waitForEdgeCount(1);

    tapNode(4);
    tapNode(2);
    await waitForEdgeCount(0);
  });

  it("deletes an edge by clicking directly on its line, regardless of the active tool", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-line").click();
    tapNode(2);
    tapNode(4);
    await waitForEdgeCount(1);

    await page.getByTestId("tool-hand").click(); // direct edge-click deletion isn't Line-tool-only
    page.getByTestId("grid-edge").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForEdgeCount(0);
  });

  it("shows a node's detail card on a clean tap under the Hand tool, and closes it on tapping again", async () => {
    await armNodeViaModal("Firewall");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-hand").click();

    tapNode(4);
    const detail = await findByTestId("node-detail");
    expect(detail.textContent).toContain("Firewall");
    expect(detail.textContent).toContain("Tier 1");

    tapNode(4);
    await vi.waitFor(() => {
      if (page.getByTestId("node-detail").query()) {
        throw new Error("detail card is still open");
      }
    });
  });

  it("still shows the detail card despite a couple of pixels of jitter between press and release", async () => {
    await armNodeViaModal("Firewall");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-hand").click();

    tapNodeWithJitter(4, 3); // below DRAG_THRESHOLD_PX (6) — ordinary finger/mouse wobble
    const detail = await findByTestId("node-detail");
    expect(detail.textContent).toContain("Firewall");
  });

  it("closes an open node detail card when tapping empty background", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-hand").click();

    tapNode(4);
    await findByTestId("node-detail");
    clickCanvasAt(500, 450); // empty background, far from any node
    await vi.waitFor(() => {
      if (page.getByTestId("node-detail").query()) {
        throw new Error("detail card is still open");
      }
    });
  });

  it("does not link nodes on tap-tap while the Hand tool is active", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-hand").click();

    tapNode(2);
    tapNode(4);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(page.getByTestId("grid-edge").elements()).toHaveLength(0);
  });

  it("moves a placed node when dragged under the Hand tool, changing its rendered position", async () => {
    await armNodeViaModal("Router");
    clickCanvasAt(260, 250);
    await waitForNodeCount(4);
    await page.getByTestId("tool-hand").click();
    const beforeX = nodePosition(4).x;

    dragNode(4, 60, 20);

    await vi.waitFor(() => {
      if (nodePosition(4).x === beforeX) {
        throw new Error("node has not moved yet");
      }
    });
  });

  it("does not move fixed Core/Entry nodes when dragged", async () => {
    const before = nodePosition(1); // core
    dragNode(1, 80, 80);
    // give any (incorrect) move a moment to have applied, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(nodePosition(1)).toEqual(before);
  });

  it("zooms in and out with the mouse wheel over the canvas", async () => {
    const canvas = page.getByTestId("grid-canvas").element() as SVGSVGElement;
    expect((await findByTestId("zoom-level")).textContent).toBe("100%");

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200 }));
    const zoomedInPct = await vi.waitFor(() => {
      const pct = Number(page.getByTestId("zoom-level").element()!.textContent!.replace("%", ""));
      if (pct <= 100) {
        throw new Error("zoom has not increased yet");
      }
      return pct;
    });

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 400 }));
    await vi.waitFor(() => {
      const pct = Number(page.getByTestId("zoom-level").element()!.textContent!.replace("%", ""));
      if (pct >= zoomedInPct) {
        throw new Error("zoom has not decreased yet");
      }
    });
  });

  it("disables Save until the topology is valid, then saves once both entries reach Core", async () => {
    const saveButton = (await findByTestId("save-defense")) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await armNodeViaModal("Router");
    clickCanvasAt(260, 250); // far enough from every fixed node to keep every edge within [200, 2000] DU
    await waitForNodeCount(4);

    await page.getByTestId("tool-line").click();
    tapNode(2);
    tapNode(4);
    await waitForEdgeCount(1);
    tapNode(3);
    tapNode(4);
    await waitForEdgeCount(2);
    tapNode(4);
    tapNode(1);
    await waitForEdgeCount(3);

    await vi.waitFor(() => {
      const status = page.getByTestId("validation-status").query();
      if (!status) {
        throw new Error("not valid yet");
      }
    });

    const button = (await findByTestId("save-defense")) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await page.getByTestId("save-defense").click();
    const confirmation = await findByTestId("save-confirmation");
    expect(confirmation.textContent).toContain("4 node, 3 edge");
  });
});
