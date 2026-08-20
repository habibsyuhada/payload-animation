# ADR 0002 — Logic block chain semantics (S1.5)

**Status:** accepted for ruleset v1, now **frozen** — superseded from v2 onward by ADR 0006
(event-sheet virus programming). This document remains the specification of the v1 engine, which
stays in the codebase so v1 battle logs keep replaying (DoD #3).
**Context:** `packages/sim/src/engine.ts`, `packages/sim/src/blocks/`

## Problem

`docs/RULESET.md` §4 fixes each of the 12 v1 blocks' own numbers, but GDD's "rantai blok" (block
chain) concept — Condition blocks gating "the block right after them" — isn't a fully specified
execution model. `VirusDesign.blocks` is a flat `LogicBlock[]`; nothing in the type system encodes
branch targets. Four concrete gaps needed a decision before S1.5 could be implemented.

## Decisions

1. **A Condition gates the block at the next array index, nothing else.** `blocks[i]` being a
   Condition kind makes `blocks[i+1]` (if it's Brute Force/Exploit/Overload) apply only on ticks
   the condition is true; every other block ignores its neighbors entirely. This is the simplest
   reading of GDD's "rantai blok" that's still mechanically meaningful, and it directly matches
   GDD §4.3's own example ("IF Firewall → Exploit").
2. **Attack blocks are unconditional unless gated this way.** RULESET.md §4.3's own wording for
   Brute Force/Exploit/Overload has no "only if preceded by a Condition" qualifier — Condition is
   an opt-in accelerant, not a prerequisite.
3. **"IF Node = Firewall" evaluates the node the virus is CURRENTLY occupying, not RULESET.md
   §4.2's literal "node tujuan" (destination) wording.** The blocks it gates (Attack blocks) only
   ever apply during Breach-node occupancy, never in anticipation of one — so evaluating "the node
   I'm at right now" is what actually makes the gate fire at a useful moment. Documented at the
   source in `blocks/if-node-type.ts`.
4. **Configurable Condition parameters (tier II/III's player-chosen Integrity threshold, tier
   III's multi-type Firewall/ICE target) are modeled as optional `LogicBlock` fields
   (`integrityThresholdPermille`, `targetNodeTypes`) rather than tier-driven defaults**, since
   RULESET.md is explicit these are player choices, not fixed numbers. Sim just reads whatever a
   caller sets; exposing them in a UI is C3.2's job, not S1.5's.

## Other simplifications made in the same pass (documented at their source, listed here for one place to check)

- Cloak's tier-III "-50% Scanner detection radius" sub-clause is skipped — Cloak already grants
  full Scanner-status immunity while active, which strictly dominates a radius reduction, so the
  sub-clause has no observable effect to implement (`ruleset.ts`'s `getCloakDurationNodes`).
- Scan Ahead's "reveal node type 1-2 ahead" is implemented as an undirected hop-radius check
  (reusing the same mechanism as ICE Sentry/Scanner range), not a true directed along-the-path
  lookahead — its only currently-wired mechanical effect is tier III's Trap-reveal feeding
  Backtrack's hazard set (`engine.ts`'s Sensor phase).
- Sacrifice Decoy's first arm threshold is a literal 200‰ (RULESET.md §4.2's "turun ≤200"), not
  1000‰ minus one re-arm step — re-arms after that are each a further 200‰ drop
  (`blocks/sacrifice-decoy.ts`).

None of these are numeric changes to RULESET.md's balance figures — they're execution-model
choices the ruleset prose didn't pin down. Flagging them here (DoD #4) rather than silently
encoding them keeps the gap visible for whoever builds C3.2 or revises the ruleset later.
