import { simulate } from "@payload/sim";
import type { BattleInput, DefenseGraph, DefenseNode } from "@payload/sim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileTimeline, type Layout, type Timeline } from "../src/compile.js";
import { exportReplay, exportToGif, exportToWebM, isWebMExportSupported } from "../src/export.js";

// entry(1)/(2) -> router(3) -> core(4): a short, uneventful win — export.ts just needs *some*
// non-trivial Timeline, the interesting behavior here is the encoding pipeline, not the battle.
const GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 400 },
    { from: 2, to: 3, lengthDu: 400 },
    { from: 3, to: 4, lengthDu: 600 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 100,
};
const LAYOUT: Layout = { positions: { 1: { x: 20, y: 20 }, 2: { x: 20, y: 100 }, 3: { x: 100, y: 60 }, 4: { x: 180, y: 60 } } };
const INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: GRAPH };

function buildTimeline(): Timeline {
  return compileTimeline(simulate(INPUT), LAYOUT);
}

let canvas: HTMLCanvasElement;

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});

afterEach(() => {
  canvas.remove();
});

describe("isWebMExportSupported", () => {
  it("reports a boolean, reflecting this real browser's actual MediaRecorder support", () => {
    expect(typeof isWebMExportSupported()).toBe("boolean");
  });
});

describe("exportToGif", () => {
  it("produces bytes starting with the GIF89a header and ending with the trailer", () => {
    const timeline = buildTimeline();
    const bytes = exportToGif(timeline, canvas, { width: 64, height: 48, fps: 10 });
    const header = String.fromCharCode(...bytes.slice(0, 6));
    expect(header).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("resizes the canvas to the requested export dimensions", () => {
    const timeline = buildTimeline();
    exportToGif(timeline, canvas, { width: 123, height: 77, fps: 10 });
    expect(canvas.width).toBe(123);
    expect(canvas.height).toBe(77);
  });

  it("encodes more Image Descriptors for a longer battle at the same fps", () => {
    // a much longer, uneventful trip -> proportionally more sampled frames.
    const longGraph: DefenseGraph = { ...GRAPH, edges: GRAPH.edges.map((edge) => ({ ...edge, lengthDu: edge.lengthDu * 20 })) };
    const shortTimeline = compileTimeline(simulate(INPUT), LAYOUT);
    const longTimeline = compileTimeline(simulate({ ...INPUT, defense: longGraph }), LAYOUT);
    expect(longTimeline.durationSeconds).toBeGreaterThan(shortTimeline.durationSeconds);

    const countFrames = (bytes: Uint8Array): number => Array.from(bytes).filter((byte) => byte === 0x2c).length;
    const shortBytes = exportToGif(shortTimeline, canvas, { width: 32, height: 32, fps: 10 });
    const longBytes = exportToGif(longTimeline, canvas, { width: 32, height: 32, fps: 10 });
    expect(countFrames(longBytes)).toBeGreaterThan(countFrames(shortBytes));
  });
});

describe.skipIf(!isWebMExportSupported())("exportToWebM (skipped when this browser has no MediaRecorder/WebM support)", () => {
  it("produces a non-empty video/webm Blob starting with the EBML container magic", async () => {
    const timeline = buildTimeline();
    const blob = await exportToWebM(timeline, canvas, { width: 64, height: 48, fps: 10 });
    expect(blob.type).toContain("video/webm");
    expect(blob.size).toBeGreaterThan(0);

    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // EBML magic number (Matroska/WebM's container format) — proves this is a real container, not just non-empty bytes.
    expect(Array.from(header)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it("resizes the canvas to the requested export dimensions", async () => {
    const timeline = buildTimeline();
    await exportToWebM(timeline, canvas, { width: 96, height: 54, fps: 10 });
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(54);
  });
});

describe("exportReplay", () => {
  it("picks WebM when supported, GIF otherwise, and returns that format's real payload", async () => {
    const timeline = buildTimeline();
    const result = await exportReplay(timeline, canvas, { width: 48, height: 32, fps: 10 });
    if (isWebMExportSupported()) {
      expect(result.format).toBe("webm");
      expect((result as { format: "webm"; blob: Blob }).blob.size).toBeGreaterThan(0);
    } else {
      expect(result.format).toBe("gif");
      expect((result as { format: "gif"; bytes: Uint8Array }).bytes.length).toBeGreaterThan(0);
    }
  });
});
