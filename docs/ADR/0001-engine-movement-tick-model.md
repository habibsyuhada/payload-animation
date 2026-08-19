# ADR 0001 — Engine tick timing model & entry-point selection (S1.3)

**Status:** accepted (v1, subject to revision once S1.4 adds node combat)
**Context:** `packages/sim/src/engine.ts`, `packages/sim/src/movement.ts`

## Problem

`docs/RULESET.md` §0/§7 fixes the *balance numbers* and the *order of resolution steps* per
tick, but doesn't pin down two mechanical details needed to actually implement S1.3's tick loop:

1. Which Entry node does the virus start at, given a defense always has exactly 2 (§6)?
2. When a virus arrives at a node mid-battle, does it pick its next edge the **same** tick it
   arrives, or the **next** tick?

Both are genuine gameplay/determinism decisions, not just implementation details — they affect
tick counts in every `BattleLog`, hence DoD #4 (short ADR for architecture decisions).

## Decision

1. **Entry selection is the first RNG draw of the battle.** `rng.nextInt(entryNodeIds.length)`
   is called before tick 0 begins, uniformly picking one of the (always 2, v1) Entry nodes. This
   keeps `BattleInput` self-contained (no extra field needed) while still being deterministic and
   replayable from `seed` alone. Documented in RULESET.md §0's RNG draw-order list.
2. **Arrival and departure never happen in the same tick.** The tick a virus's edge-transit
   counter reaches 0 is spent entirely on arriving (emits `virus-entered-node`, runs the
   Core-arrival win check). The very next tick is the earliest the movement algorithm picks a new
   outgoing edge. Symmetrically, tick 0 has the virus already resting at its Entry node, so the
   first movement decision (and the start of its transit) happens at tick 0 itself. This means an
   edge of `ticksToCrossEdge(length, speed) = N` ticks takes exactly `N` ticks end-to-end
   (departure tick + (N-1) further transit ticks = arrival at tick `N` relative to departure) —
   matches the formula in RULESET.md §0 with no off-by-one surprises once you know the rule.

## Consequences / explicit stub

Node combat (Firewall counter-damage, ICE Sentry shots, Honeypot/Trap triggers, Scanner aura —
S1.4) and logic blocks (S1.5) don't exist yet. Within S1.3's scope every node the virus passes
through other than Core behaves like a Router (no effect), and **reaching Core is an instant
Attacker win with no HP tracking** — Core HP, passive breach drain, and Attack-block damage land
in S1.4. `Score.integrityRatioPermille`/`coreRatioPermille` are stubbed to "undamaged" values
(1000‰ for whichever side didn't win outright) until real HP exists. This is called out inline in
`engine.ts` and in the S1.3 golden-log tests so it isn't mistaken for final behavior.

Backtrack (§3) is specified as "like Shortest Path, but routes around Sensor-detected hazards" —
since Sensor blocks don't exist until S1.5, `knownHazardNodeIds` is always empty in S1.3, so
Backtrack is observably identical to Shortest Path for now. The implementation already takes an
`avoid` set (threaded through `graph.ts`'s `shortestPath`) so S1.5 only needs to populate that
set, not touch the movement algorithm itself.

## Alternatives considered

- **Player-chosen entry point at attack time:** rejected — GDD §5 explicitly says Entry positions
  (and by extension, which one is used) are system-determined, not a player decision; adding an
  explicit field to `BattleInput` for this would also complicate the "always exactly 2, v1"
  simplicity RULESET.md §6 deliberately keeps for now.
- **Same-tick arrival+departure:** rejected — it would make a 0-length-in-practice edge complete
  in 0 observable ticks once chained, blurring "how many ticks did the virus dwell here" for
  future node-combat ticks-per-node accounting (S1.4 needs a clean per-node dwell tick count for
  Firewall counter-damage and passive breach drain).
