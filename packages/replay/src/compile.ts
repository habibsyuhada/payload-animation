import type { BattleEvent, BattleEventType, BattleLog, BlockTier, DefenseNodeType } from "@payload/sim";
import { type EasingFn, linear, mix, mixVec2, type Vec2 } from "./ease.js";

/**
 * BattleLog -> Timeline compiler (PLAN.md §2 contract: `compileTimeline(log, layout): Timeline`).
 * Reads ONLY the log's event data — packages/replay must never recompute gameplay math (pathing,
 * damage, RNG); see the commit that added `virus-departed-node` to the sim event vocabulary
 * specifically so this compiler wouldn't need to.
 */

/** 1 tick = 50ms (docs/RULESET.md §0). Replay owns this conversion as a rendering concern — it
 * mirrors, but deliberately doesn't import, sim's TICK_MS constant (packages/replay may only
 * import sim's *types*, not its runtime values, so it never becomes a second interpreter of
 * gameplay rules). */
const TICK_SECONDS = 0.05;

export type { Vec2 };

export interface Keyframe<T> {
  readonly t: number;
  readonly value: T;
  /** Eases the transition INTO this keyframe from the previous one. Defaults to linear. */
  readonly easing?: EasingFn;
}

export interface EntityTrack {
  readonly id: string;
  readonly position: readonly Keyframe<Vec2>[];
  readonly opacity: readonly Keyframe<number>[];
}

/** "damage" is always damage taken by the VIRUS (its source node is the marker's nodeId);
 * "node-hit" is the mirror image — damage the virus dealt TO a node, which is what chewing
 * through a Firewall or draining the Core looks like. Keeping them apart matters: a renderer that
 * confused the two would draw the Core's own HP loss as if the virus had been shot. */
export type TimelineMarkerKind = "damage" | "node-hit" | "destroyed" | "died" | "won" | "timeout" | "status";

export interface TimelineMarker {
  readonly t: number;
  readonly kind: TimelineMarkerKind;
  readonly label: string;
  /** The node this marker is about, when it's about one (damage source, node destroyed, status target). */
  readonly nodeId?: number;
  /** How much was dealt or healed, as a positive number — carried explicitly so a renderer can
   * show a combat number without parsing it back out of `label` (where the leading token is the
   * actor's node id, not the amount). */
  readonly amount?: number;
}

/**
 * A ruleset v2 sheet rule firing at a moment in time (sim's `rule-fired` event, ADR 0006 §6).
 * Kept off `markers` on purpose: every marker kind is about a place on the map, and a rule is
 * about a place in the *sheet* — a renderer that lumped them together would have to filter one
 * out of the other on every frame. `ruleId` is whatever the sim logged: the sheet author's own id
 * when they set one, otherwise the row's path ("2.0").
 */
export interface RuleFiring {
  readonly t: number;
  readonly ruleId: string;
}

/** A defense node's static (never-moving) render data — draw.ts needs this without a separate layout param. */
export interface StaticNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  readonly position: Vec2;
}

export interface StaticEdge {
  readonly from: number;
  readonly to: number;
}

export interface Timeline {
  readonly durationSeconds: number;
  readonly nodes: readonly StaticNode[];
  readonly edges: readonly StaticEdge[];
  readonly tracks: readonly EntityTrack[];
  readonly markers: readonly TimelineMarker[];
  /** The virus's health over time, as a 0..1 ratio of its starting Integrity — what a health bar
   * renders from. Compiled from the log's own damage/repair deltas, never recomputed. */
  readonly virusIntegrity: readonly Keyframe<number>[];
  /** The Core's health over time, same 0..1 shape. The battle is won when this hits 0, so it is
   * the other half of the story a health bar tells. */
  readonly coreHp: readonly Keyframe<number>[];
  /** Empty for every v1 log — the engine that produced them has no rules to fire. */
  readonly ruleFirings: readonly RuleFiring[];
}

/**
 * The Integrity every virus starts a battle with (engine.ts's `virusIntegrity: 1000`). Mirrored
 * rather than imported for the same reason TICK_SECONDS is: packages/replay may read sim's types
 * but not its runtime values, so it can never become a second interpreter of gameplay rules. The
 * log's deltas are absolute damage numbers, so turning them into a 0..1 bar needs the scale they
 * were measured against.
 */
const VIRUS_START_INTEGRITY = 1000;

/** Health-over-time, replayed from the events rather than simulated: every `virus-damaged` and
 * `virus-repaired` delta is applied in order, giving one keyframe per change. Damage lands on the
 * tick it happened — no easing into it — so a hit reads as a hit rather than a slow drain. */
function compileVirusIntegrityTrack(events: readonly BattleEvent[]): Keyframe<number>[] {
  const keyframes: Keyframe<number>[] = [{ t: 0, value: 1 }];
  let integrity = VIRUS_START_INTEGRITY;
  for (const event of events) {
    if (event.type === "virus-damaged" || event.type === "virus-repaired") {
      integrity = Math.max(0, Math.min(VIRUS_START_INTEGRITY, integrity + (event.delta ?? 0)));
    } else if (event.type === "virus-died") {
      integrity = 0;
    } else {
      continue;
    }
    keyframes.push({ t: event.tick * TICK_SECONDS, value: integrity / VIRUS_START_INTEGRITY });
  }
  return keyframes;
}

/** Node id -> screen position. Layout is provided by the caller (e.g. Defense Grid's saved node positions) — compileTimeline never invents one. */
export interface Layout {
  readonly positions: Readonly<Record<number, Vec2>>;
}

function layoutPosition(layout: Layout, nodeIdText: string | undefined): Vec2 {
  const nodeId = Number(nodeIdText);
  const position = layout.positions[nodeId];
  if (!position) {
    throw new Error(`compileTimeline: layout has no position for node ${nodeIdText}`);
  }
  return position;
}

function compileVirusPositionTrack(events: readonly BattleEvent[], layout: Layout): Keyframe<Vec2>[] {
  const keyframes: Keyframe<Vec2>[] = [];
  for (const event of events) {
    if (event.type !== "virus-entered-node" && event.type !== "virus-departed-node") {
      continue;
    }
    // "entered" keyframes land on the arrival node, "departed" on the node just left — placed
    // back-to-back this naturally produces a hold (two keyframes at the same position, while the
    // virus dwells) followed by a move (interpolating to the next arrival), with no extra logic.
    keyframes.push({ t: event.tick * TICK_SECONDS, value: layoutPosition(layout, event.target) });
  }
  return keyframes;
}

const MARKER_KIND_BY_EVENT: Partial<Record<BattleEventType, TimelineMarkerKind>> = {
  "virus-damaged": "damage",
  "node-damaged": "node-hit",
  "node-destroyed": "destroyed",
  "virus-died": "died",
  "battle-won": "won",
  "battle-timeout": "timeout",
  "status-applied": "status",
  "decoy-absorbed": "status",
};

function describeEvent(event: BattleEvent): string {
  switch (event.type) {
    case "virus-damaged":
      return `${event.actor} deals ${Math.abs(event.delta ?? 0)} damage`;
    case "node-destroyed":
      return `node ${event.target} destroyed`;
    case "virus-died":
      return "virus died";
    case "battle-won":
      return "attacker wins";
    case "battle-timeout":
      return "defender wins (timeout)";
    case "status-applied":
      return `${event.actor} status applied`;
    case "decoy-absorbed":
      return `${event.actor} absorbed by decoy`;
    default:
      return event.type;
  }
}

/**
 * "virus-damaged" is about its damage SOURCE (event.actor); "node-damaged"/"node-destroyed" and
 * decoy/status events are about their TARGET (for damage) or actor (for status/decoy) — whichever
 * field names an actual defense node id. Neither field is a node id for "virus"/block-name actors
 * like "self-repair" — Number(...) on those is NaN, so the id simply comes back undefined.
 */
function resolveMarkerNodeId(event: BattleEvent, nodeIds: ReadonlySet<number>): number | undefined {
  const candidates = event.type === "virus-damaged" ? [event.actor] : [event.target, event.actor];
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && nodeIds.has(id)) {
      return id;
    }
  }
  return undefined;
}

function compileMarkers(events: readonly BattleEvent[], nodeIds: ReadonlySet<number>): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const event of events) {
    const kind = MARKER_KIND_BY_EVENT[event.type];
    if (!kind) {
      continue;
    }
    const nodeId = resolveMarkerNodeId(event, nodeIds);
    const amount = event.delta === undefined ? undefined : Math.abs(event.delta);
    markers.push({ t: event.tick * TICK_SECONDS, kind, label: describeEvent(event), ...(nodeId !== undefined ? { nodeId } : {}), ...(amount !== undefined ? { amount } : {}) });
  }
  return markers;
}

/** The Core's health, replayed from the `node-damaged` events aimed at it. Unlike the virus's
 * Integrity there's no constant to mirror: the log carries the Core's starting HP in its own
 * input, so the ratio is exact for any account tier. */
function compileCoreHpTrack(log: BattleLog): Keyframe<number>[] {
  const coreId = String(log.input.defense.coreNodeId);
  const startingHp = log.input.defense.coreHp;
  const keyframes: Keyframe<number>[] = [{ t: 0, value: 1 }];
  if (startingHp <= 0) {
    return keyframes;
  }
  let hp = startingHp;
  for (const event of log.events) {
    if (event.type !== "node-damaged" || event.target !== coreId) {
      continue;
    }
    hp = Math.max(0, Math.min(startingHp, hp + (event.delta ?? 0)));
    keyframes.push({ t: event.tick * TICK_SECONDS, value: hp / startingHp });
  }
  return keyframes;
}

function compileRuleFirings(events: readonly BattleEvent[]): RuleFiring[] {
  return events.filter((event) => event.type === "rule-fired").map((event) => ({ t: event.tick * TICK_SECONDS, ruleId: event.actor }));
}

export function compileTimeline(log: BattleLog, layout: Layout): Timeline {
  const lastEvent = log.events[log.events.length - 1];
  const staticNodes: StaticNode[] = log.input.defense.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    ...(node.tier !== undefined ? { tier: node.tier } : {}),
    position: layoutPosition(layout, String(node.id)),
  }));
  const virusTrack: EntityTrack = {
    id: "virus",
    position: compileVirusPositionTrack(log.events, layout),
    opacity: [],
  };
  return {
    durationSeconds: (lastEvent?.tick ?? 0) * TICK_SECONDS,
    nodes: staticNodes,
    edges: log.input.defense.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    tracks: [virusTrack],
    markers: compileMarkers(log.events, new Set(staticNodes.map((node) => node.id))),
    virusIntegrity: compileVirusIntegrityTrack(log.events),
    coreHp: compileCoreHpTrack(log),
    ruleFirings: compileRuleFirings(log.events),
  };
}

/**
 * Which rules were firing at T, within `windowSeconds` of their moment. A window rather than an
 * exact match because a rule fires for one 50ms tick and nobody can see a 50ms flash — the same
 * reason the map's hit effects have one.
 */
export function rulesFiringAt(timeline: Timeline, t: number, windowSeconds: number): Set<string> {
  const firing = new Set<string>();
  for (const rule of timeline.ruleFirings) {
    if (rule.t <= t && t - rule.t <= windowSeconds) {
      firing.add(rule.ruleId);
    }
  }
  return firing;
}

/** Health at T as a 0..1 ratio — a step function, not an interpolation: a hit is instant, and
 * sampling between two hits must report the health it actually had then. */
function sampleStep(keyframes: readonly Keyframe<number>[], t: number): number {
  let value = keyframes[0]?.value ?? 1;
  for (const keyframe of keyframes) {
    if (keyframe.t > t) {
      break;
    }
    value = keyframe.value;
  }
  return value;
}

/** The virus's health at T, as a 0..1 ratio of what it started with. */
export function sampleIntegrity(timeline: Timeline, t: number): number {
  return sampleStep(timeline.virusIntegrity, t);
}

/** The Core's health at T, as a 0..1 ratio of what it started with. */
export function sampleCoreHp(timeline: Timeline, t: number): number {
  return sampleStep(timeline.coreHp, t);
}

function sampleKeyframes<T>(keyframes: readonly Keyframe<T>[], t: number, mixFn: (a: T, b: T, tt: number) => T, fallback: T): T {
  if (keyframes.length === 0) {
    return fallback;
  }
  const first = keyframes[0]!;
  if (t <= first.t) {
    return first.value;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (t >= last.t) {
    return last.value;
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const localT = span === 0 ? 1 : (t - a.t) / span;
      const eased = (b.easing ?? linear)(localT);
      return mixFn(a.value, b.value, eased);
    }
  }
  return last.value;
}

/** Pure function of (track, T, fallback) — the scrub-safety the whole Timeline design exists for. */
export function samplePosition(track: EntityTrack, t: number, fallback: Vec2): Vec2 {
  return sampleKeyframes(track.position, t, mixVec2, fallback);
}

export function sampleOpacity(track: EntityTrack, t: number): number {
  return sampleKeyframes(track.opacity, t, mix, 1);
}

export function findTrack(timeline: Timeline, id: string): EntityTrack | undefined {
  return timeline.tracks.find((track) => track.id === id);
}

export function findNode(timeline: Timeline, id: number | undefined): StaticNode | undefined {
  return id === undefined ? undefined : timeline.nodes.find((node) => node.id === id);
}
