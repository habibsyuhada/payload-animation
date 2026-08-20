# ADR 0006 — Event-sheet virus programming (ruleset v2)

**Status:** proposed — design agreed, no code written yet
**Supersedes:** ADR 0002 (logic block chain semantics) for ruleset v2 onward; v1 stays frozen and replayable
**Context:** `packages/sim/`, `apps/client/src/screens/VirusLab.tsx`, `docs/GDD.md` §4, `docs/RULESET.md` §4

## Problem

A v1 virus is a flat `LogicBlock[]` where a Condition block gates **the single block at the next
array index** (ADR 0002, decision 1). That model has three problems that surfaced the moment real
battles were watched on the Defend page:

1. **It doesn't express what the GDD asks for.** GDD §4.2's own example is
   `IF Honeypot → Backtrack` + `IF Firewall → Exploit` — condition/action pairs, i.e. an event
   sheet. "Gates the next index" is the weakest possible reading of that.
2. **Order is a hidden trap.** `[IF node=Firewall, Exploit, Brute Force]` and
   `[IF node=Firewall, Brute Force, Exploit]` contain identical blocks, but measured against the
   same defense the second takes **124 ticks instead of 53** — because the condition happens to
   guard a different neighbour. Nothing on screen explains that, which directly contradicts GDD
   pillar 1 ("readable depth").
3. **Movement is outside the language.** One global movement block decides all pathing, so a virus
   can't react ("back off this node", "hold still while repairing") no matter what else it carries.

## Decision

Ruleset v2 replaces the block chain with a **nested event sheet**, in the GDevelop sense: an
ordered list of events, each event being *a set of conditions (ANDed) and an ordered list of
actions*, with child events that only run when their parent's conditions hold.

```
[node = Firewall] AND [integrity > 50%]
   → Exploit, Brute Force
   └ [firewall HP < 20%]
        → Overload
[honeypot ahead]
   → Backtrack
[always]
   → Move toward Core
```

### 1. Shape

```ts
interface VirusProgram {           // replaces VirusDesign for v2
  readonly events: readonly SheetEvent[];
}
interface SheetEvent {
  readonly conditions: readonly SheetCondition[];   // ANDed; empty = "always"
  readonly actions: readonly SheetAction[];         // run in order
  readonly children: readonly SheetEvent[];         // run only if conditions held
  readonly once?: OnceScope;                        // see 4
}
interface SheetCondition { readonly kind: ConditionKind; readonly negate?: boolean; /* + params */ }
interface SheetAction { readonly kind: ActionKind; readonly tier?: BlockTier; /* + params */ }
```

`negate` covers NOT. OR is expressed as sibling events, exactly as GDevelop does — no OR group in
v2, because it doubles the editor's UI surface for a case two rows already handle.

### 2. Evaluation

Once per tick, depth-first, top to bottom, in array order. A parent whose conditions fail skips
its actions *and* its whole subtree. Evaluation itself never consumes RNG — only actions that the
ruleset says are random do.

**Nesting depth is capped at 3** (root + 2 levels). Not a technical limit: it is the deepest
indent that stays readable on a 390 px portrait screen, which GDD §3 makes a hard constraint.

### 3. Action conflicts: slots take the FIRST writer, cumulative actions stack

Two classes of action:

- **Cumulative** (Brute Force, Exploit, Self Repair, …): every one that runs this tick applies.
- **Slot** (movement intent, and any status that is simply on/off this tick): the **first** action
  to write the slot in a tick wins; later writes are ignored.

This is a deliberate deviation from GDevelop, where the last action executed wins. Rationale: a
sheet is read top-down as a priority list, and the common shape is specific rules on top with a
generic `[always] → Move toward Core` at the bottom. Last-wins would make that fallback silently
override every reaction above it — the exact class of hidden-order trap this ADR exists to remove.
The editor must show the slot rule in plain language ("aturan paling atas yang menang").

### 4. Trigger-once

An event may carry `once: "battle" | "node" | "arrival"`. This replaces v1's hardcoded bookkeeping
(Exploit's "once per node" lived in `exploitedNodeIds` inside the engine). Making it a property of
the event means a player can write "detonate once per node" for anything, and the engine keeps one
generic fired-set instead of per-block special cases.

### 5. Cost: per condition and per action, in KB

Payload budget already exists (RULESET.md §1, 2400 KB at tier 1) and already carries the GDD §4.1
trade-off "virus pintar = berat = lambat". v2 keeps that lever and extends it:

- each **condition** and each **action** carries its own KB weight (the numbers migrate from the
  block weights that already exist in `blockCatalog.ts`, split between the condition half and the
  action half of what used to be one block),
- each **event row** costs a small structural weight, so ten one-line rules cost more than one
  rule with ten actions,
- **nesting is free** — depth is a readability tool, not a resource,
- an **event-count cap per account tier** on top of the KB budget, so the worst case a server has
  to evaluate stays bounded regardless of how cheap a sheet is.

### 6. Determinism, safety, and log size

- No jumps, no loops, no goto: a sheet is a finite tree walked once per tick, so evaluation is
  O(sheet) per tick and cannot diverge. Battle length stays bounded by `BATTLE_TICK_LIMIT`.
- A per-tick action cap backs up the event-count cap.
- **New log event `rule-fired`** (event id + tick), emitted only for events whose actions actually
  had an effect. This is what lets the replay highlight the rule that fired — the feature that
  makes an event sheet teachable — and what the Defend page's test window needs to explain *why*
  an attacker got through. Budget: bounded by (events × ticks), which the caps above already bound.

### 7. Migration: v2 is a new ruleset version, v1 is frozen

`BattleLog` is self-contained and carries `rulesetVersion` (PLAN.md §2), and DoD #3 requires old
logs to stay replayable after a patch. Therefore:

- `simulate()` dispatches on `input.rulesetVersion`: `"v1"` keeps today's chain engine untouched,
  `"v2"` runs the sheet engine. v1's golden logs must keep passing byte-identical.
- `BattleInput.virus` becomes a discriminated union (`VirusDesign` for v1, `VirusProgram` for v2).
- No automatic migration of saved v1 viruses: they are rebuilt in the new editor. There are no
  real players yet, so this costs nothing and avoids a translation layer that would have to
  reproduce the very order-trap semantics we're deleting.

### 8. Mapping the 12 v1 blocks

| v1 block | v2 form |
|---|---|
| Shortest Path / Random Walk / Backtrack | actions: `move-toward-core`, `move-random`, `move-back` |
| Brute Force, Exploit, Overload | actions (Exploit as `once: "node"`) |
| IF integrity < X / IF node = T / IF scanned | conditions |
| Scan Ahead, Detect Honeypot | conditions (`honeypot-ahead`, `node-ahead-is`) — they stop being blocks that "produce input for condition blocks" and simply *become* the conditions |
| Cloak, Slow Crawl | actions applying a status for N ticks |
| Self Repair | action; its v1 hardcoded gates ("no damage this tick", "not on a breach node") become conditions the player can see and write |
| Sacrifice Decoy | action arming a charge |

Two of these are genuine mechanic changes worth calling out, not just repackaging:

- **Cloak becomes duration-in-ticks instead of duration-in-nodes.** RULESET.md §9 already records
  the per-node model as a v2 mechanic fix ("Cloak tidak membantu begitu virus berhenti bergerak",
  and on a 4-node map it conversely covers the entire journey). The rewrite is the natural moment.
- **Self Repair's conditions become visible.** Today a player cannot tell why their repair never
  fires; in v2 the gates are rows they wrote themselves.

### 9. Editor (GDevelop-style, phone-first)

Tap-driven, never free drag: each event is a card; `+ kondisi` / `+ aksi` opens a picker sheet
listing what's available with its KB cost; children indent one step; long-press a row to
reorder/delete. The existing node-picker modal on the Defend page is the template for the picker.

### 10. Balance

Expressiveness multiplies the combination space, which GDD's own risk list flags ("balancing
kombinatorik blok meledak"). `tools/balance-lab` must grow from 5 hand-written archetypes to a
random-sheet generator plus a dominance search, run in CI, before v2 ships to players — otherwise
the next "ICE Nest" (RULESET.md §9: one defense composition beating all five archetypes 100%) is
found by players instead of by us.

## Consequences

- ADR 0002's chain semantics stop being the model new work is built on, but stay the specification
  of the frozen v1 engine. Its "subject to revision once C3.2 needs richer configurability" status
  is now resolved.
- `packages/sim` gains a second engine path. The tick loop's phase order (ADR 0001) is unchanged —
  what changes is *who decides* what happens in each phase.
- Virus Lab (C3.2) is rewritten, not extended. Its drag-to-reorder chain UI does not survive.
- The Defend page's gauntlet (`gauntletViruses.ts`) must be re-authored as v2 sheets, and
  `tools/balance-lab`'s archetypes with it.
- A sheet with no movement action leaves the virus parked until timeout. This is legal but is a
  beginner trap: the editor ships a starter template containing `[always] → Move toward Core`, and
  the Virus Lab validator warns (not blocks) on a sheet with no movement action.

## Open questions

1. **Sheet-level vs per-node evaluation for movement.** Movement intent is decided every tick, but
   the virus only *acts* on it when it is standing on a node (ADR 0001's movement model). Does an
   intent written mid-transit queue for arrival, or is it discarded? Recommendation: queue the last
   intent written during transit, applied on arrival — but this needs one worked example before it
   is locked.
2. **Do conditions see the node ahead, or only the current node?** Scan Ahead / Detect Honeypot
   become conditions about a node the virus has not reached; ADR 0002 decision 3 deliberately made
   v1's `IF node = T` about the *current* node. v2 needs both, named unambiguously in the editor
   (`node saat ini` vs `node di depan`).
