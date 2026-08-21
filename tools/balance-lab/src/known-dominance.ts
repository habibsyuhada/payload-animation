/**
 * Dominance findings that are already known, already written down, and already waiting on a design
 * decision. The CI check (`pnpm --filter @payload/balance-lab dominance`) fails on anything NOT in
 * this list, which is the point of the search: catching the *next* ICE Nest, not re-reporting this
 * one every run.
 *
 * A name here is a debt, not an exemption. Each entry has to say what is wrong, what would fix it,
 * and where the decision is being tracked — and removing an entry (because the balance changed) is
 * the goal, not adding one.
 */

export interface KnownDominanceEntry {
  readonly name: string;
  readonly reason: string;
}

export interface KnownDominance {
  readonly viruses: readonly KnownDominanceEntry[];
  readonly defenses: readonly KnownDominanceEntry[];
}

export const KNOWN_DOMINANCE: KnownDominance = {
  viruses: [],
  defenses: [
    {
      name: "ICE Nest",
      reason:
        "Two overlapping ICE Sentry II covering one choke point beat everything in v1 too (RULESET.md §9, recorded there as the top v2 priority and explicitly left undecided: cap ICE radius overlap? lower tier II accuracy?). v2's tick-based Cloak was one of the candidate fixes and is not enough on its own — the search now measures that instead of assuming it. Still open; the fix is a design decision, not a calibration.",
    },
  ],
};
