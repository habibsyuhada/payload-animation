import type { DefenseNodeType } from "@payload/sim";
import { easeOutBack, easeOutCubic, mix, type Vec2 } from "./ease.js";
import { entityIdForTrackId, findNode, findTrack, samplePosition, trackIdForEntity, type EntityTrack, type Timeline, type TimelineMarker } from "./compile.js";

/**
 * draw.ts — PLAN.md §2 contract: `drawFrame(timeline, T, ctx)`, a PURE function of (timeline, T).
 * No module-level mutable state, no reading Date/Math.random — every visual is derived from T
 * alone, which is what makes scrubbing back and forth produce byte-identical frames (S1.6-style
 * determinism, applied to pixels instead of game state).
 *
 * Bahasa visual (GDD §7.1 / PLAN.md R2.2): virus = pixel packet with a sine wobble + fading
 * trail; ICE Sentry hits = a snapping tracer line; Firewall hits = an easeOutBack shake, a crack
 * flash on destroy; Trap = a burst flash; Core = a pulse on every drain tick, a big burst on win;
 * death = a glitch burst on the virus itself.
 */

/** Narrow Canvas 2D subset draw.ts actually uses — real CanvasRenderingContext2D (browser or
 * node-canvas) structurally satisfies this, and it's trivial to mock in tests without a DOM. */
export interface DrawContext2D {
  readonly canvas: { readonly width: number; readonly height: number };
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

// Colors/radii mirrored by hand in apps/client's defenseNodeCatalog.ts (same values — see that
// file's header for why it's a duplicate, not an import: eslint boundaries forbid app -> replay
// internals). The five v2-only types (RULESET.md §14, PLAN.md 8.2a) were seeded here as router's
// placeholder colors in 8.1a purely to keep these Records exhaustive; these are their real values.
const NODE_COLOR: Record<DefenseNodeType, string> = {
  entry: "#7fd8a0",
  router: "#5b6478",
  firewall: "#e0555a",
  "ice-sentry": "#5ac8e6",
  honeypot: "#e0c15a",
  scanner: "#b05ae0",
  trap: "#e05a9c",
  core: "#ffd75a",
  "patch-server": "#5ae08a",
  tarpit: "#8a6a3a",
  jammer: "#7a5ae0",
  turnstile: "#5b6478",
  alarm: "#e07a2a",
};

const NODE_RADIUS: Record<DefenseNodeType, number> = {
  entry: 8,
  router: 6,
  firewall: 14,
  "ice-sentry": 10,
  honeypot: 12,
  scanner: 10,
  trap: 10,
  core: 22,
  "patch-server": 9,
  tarpit: 9,
  jammer: 9,
  turnstile: 8,
  alarm: 10,
};

/** GDD §11: "gelap (near-black biru)" — also the erase color every frame draws over (see
 * `drawFrame`), instead of leaving the canvas transparent, so an exported frame (R2.5) always has
 * real background pixels for a WebM/GIF encoder to read instead of holes. */
const BACKGROUND_COLOR = "#12141c";

const VIRUS_COLOR = "#eaf6ff";
const VIRUS_RADIUS = 7;
const WOBBLE_AMPLITUDE_PX = 3;
const WOBBLE_FREQUENCY_HZ = 6;
const TRAIL_STEPS = 5;
const TRAIL_STEP_SECONDS = 0.03;

/** One-shot marker effects (shot lines, cracks, bursts) stay visible for this long around their t. */
const EFFECT_WINDOW_SECONDS = 0.3;

function drawEdges(timeline: Timeline, ctx: DrawContext2D): void {
  ctx.strokeStyle = "#2a3040";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 1;
  for (const edge of timeline.edges) {
    const from = findNode(timeline, edge.from);
    const to = findNode(timeline, edge.to);
    if (!from || !to) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(from.position.x, from.position.y);
    ctx.lineTo(to.position.x, to.position.y);
    ctx.stroke();
  }
}

/** Firewall shake offset while it's mid-crack: an easeOutBack "impact" that snaps back to rest. */
function shakeOffset(progress: number): Vec2 {
  const settle = 1 - easeOutBack(Math.min(1, progress));
  const wobble = Math.sin(progress * Math.PI * 6) * settle;
  return { x: wobble * 4, y: 0 };
}

function drawNodes(timeline: Timeline, t: number, ctx: DrawContext2D): void {
  for (const node of timeline.nodes) {
    const radius = NODE_RADIUS[node.type];
    let position = node.position;

    const recentDamage = timeline.markers.find((marker) => marker.kind === "damage" && marker.nodeId === node.id && node.type === "firewall" && Math.abs(marker.t - t) <= EFFECT_WINDOW_SECONDS && marker.t <= t);
    if (recentDamage) {
      const progress = (t - recentDamage.t) / EFFECT_WINDOW_SECONDS;
      const offset = shakeOffset(progress);
      position = { x: position.x + offset.x, y: position.y + offset.y };
    }

    const destroyed = timeline.markers.find((marker) => marker.kind === "destroyed" && marker.nodeId === node.id && marker.t <= t);

    ctx.save();
    ctx.globalAlpha = destroyed ? 0.25 : 1;
    ctx.fillStyle = NODE_COLOR[node.type];
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (destroyed && t - destroyed.t <= EFFECT_WINDOW_SECONDS) {
      drawBurst(position, (t - destroyed.t) / EFFECT_WINDOW_SECONDS, NODE_COLOR[node.type], ctx);
    }
  }
}

function drawBurst(center: Vec2, progress: number, color: string, ctx: DrawContext2D): void {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = mix(4, 28, easeOutCubic(clamped));
  ctx.save();
  ctx.globalAlpha = 1 - clamped;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTracer(from: Vec2, to: Vec2, progress: number, ctx: DrawContext2D): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress * 1.5);
  ctx.strokeStyle = "#5ac8e6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function activeEffectMarkers(timeline: Timeline, t: number): TimelineMarker[] {
  return timeline.markers.filter((marker) => marker.t <= t && t - marker.t <= EFFECT_WINDOW_SECONDS);
}

/**
 * Effects that are about a DEFENSE node, not any specific body (PLAN.md 8.3e): drawn once per
 * frame regardless of how many bodies are alive, at the source node's own position. A Trap/
 * Honeypot/Core hit, or a status change (Scanner aura, Alarm Relay), looks the same no matter which
 * body triggered it — drawing this once per entity, like the ICE tracer below has to, would stack
 * identical bursts on top of each other.
 */
function drawSharedEffects(timeline: Timeline, t: number, ctx: DrawContext2D): void {
  for (const marker of activeEffectMarkers(timeline, t)) {
    const progress = (t - marker.t) / EFFECT_WINDOW_SECONDS;
    const node = findNode(timeline, marker.nodeId);

    if (marker.kind === "damage" && (node?.type === "trap" || node?.type === "honeypot")) {
      drawBurst(node.position, progress, NODE_COLOR[node.type], ctx);
    } else if (marker.kind === "damage" && node?.type === "core") {
      drawBurst(node.position, progress, NODE_COLOR.core, ctx);
    } else if (marker.kind === "status" && node) {
      drawBurst(node.position, progress, "#ffffff", ctx);
    }
  }
}

/** The ICE Sentry tracer IS about a specific body — it snaps to wherever THAT body actually is,
 * so it has to be drawn once per entity rather than shared like `drawSharedEffects`. A marker with
 * no `entityId` (a log that never splits) defaults to entity 0, the only body such a log ever has. */
function drawIceTracer(timeline: Timeline, entityId: number, t: number, virusPosition: Vec2, ctx: DrawContext2D): void {
  for (const marker of activeEffectMarkers(timeline, t)) {
    if (marker.kind !== "damage" || (marker.entityId ?? 0) !== entityId) {
      continue;
    }
    const node = findNode(timeline, marker.nodeId);
    if (node?.type === "ice-sentry") {
      drawTracer(node.position, virusPosition, (t - marker.t) / EFFECT_WINDOW_SECONDS, ctx);
    }
  }
}

function drawVirusTrail(track: EntityTrack, t: number, fallback: Vec2, ctx: DrawContext2D): void {
  for (let step = TRAIL_STEPS; step >= 1; step -= 1) {
    const sampleT = t - step * TRAIL_STEP_SECONDS;
    if (sampleT < 0) {
      continue;
    }
    const position = samplePosition(track, sampleT, fallback);
    ctx.save();
    ctx.globalAlpha = (1 - step / (TRAIL_STEPS + 1)) * 0.4;
    ctx.fillStyle = VIRUS_COLOR;
    ctx.beginPath();
    ctx.arc(position.x, position.y, VIRUS_RADIUS * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * This body's own most recent "became dead" tick as of T, or undefined if it's currently alive —
 * derived from its Integrity track rather than a `died` marker (PLAN.md 8.3e), because only a
 * respawning body's death gets an explicit per-entity `died` marker at all (RULESET.md §13); a
 * body that just dies outright never does. Walking the Integrity keyframes works for both: it
 * resets to "alive" the moment a later positive keyframe appears (a repair or a `set-checkpoint`
 * respawn), so a body that comes back stops reading as dead without needing to know which of those
 * two reasons brought it back.
 */
function deathTickFor(timeline: Timeline, entityId: number, t: number): number | undefined {
  const track = timeline.virusIntegrityByEntity.get(entityId);
  if (!track) {
    return undefined;
  }
  let deathTick: number | undefined;
  for (const keyframe of track) {
    if (keyframe.t > t) {
      break;
    }
    deathTick = keyframe.value <= 0 ? keyframe.t : undefined;
  }
  return deathTick;
}

function drawVirusBody(timeline: Timeline, entityId: number, t: number, ctx: DrawContext2D): void {
  const track = findTrack(timeline, trackIdForEntity(entityId));
  if (!track) {
    return;
  }
  const fallback = timeline.nodes[0]?.position ?? { x: 0, y: 0 };
  const deathTick = deathTickFor(timeline, entityId, t);
  if (deathTick !== undefined) {
    if (t - deathTick <= EFFECT_WINDOW_SECONDS) {
      drawBurst(samplePosition(track, deathTick, fallback), (t - deathTick) / EFFECT_WINDOW_SECONDS, "#ff5a5a", ctx);
    }
    return; // this body is gone — nothing more to draw for it.
  }

  drawVirusTrail(track, t, fallback, ctx);

  const basePosition = samplePosition(track, t, fallback);
  const wobble = Math.sin(t * WOBBLE_FREQUENCY_HZ * Math.PI * 2) * WOBBLE_AMPLITUDE_PX;
  const position: Vec2 = { x: basePosition.x, y: basePosition.y + wobble };

  drawIceTracer(timeline, entityId, t, position, ctx);

  ctx.save();
  ctx.fillStyle = VIRUS_COLOR;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(position.x, position.y, VIRUS_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Battle-level, drawn once regardless of how many bodies are still standing when it happens. */
function drawWinBurst(timeline: Timeline, t: number, ctx: DrawContext2D): void {
  const won = timeline.markers.find((marker) => marker.kind === "won");
  if (won && t >= won.t && t - won.t <= EFFECT_WINDOW_SECONDS) {
    const core = timeline.nodes.find((node) => node.type === "core");
    if (core) {
      drawBurst(core.position, (t - won.t) / EFFECT_WINDOW_SECONDS, NODE_COLOR.core, ctx);
    }
  }
}

/** Pure function of (timeline, T) — same inputs always produce the same sequence of draw calls. */
export function drawFrame(timeline: Timeline, t: number, ctx: DrawContext2D): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawEdges(timeline, ctx);
  drawNodes(timeline, t, ctx);
  drawSharedEffects(timeline, t, ctx);
  for (const track of timeline.tracks) {
    drawVirusBody(timeline, entityIdForTrackId(track.id), t, ctx);
  }
  drawWinBurst(timeline, t, ctx);
}
