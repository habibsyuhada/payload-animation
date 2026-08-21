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

/**
 * Empty as of PLAN.md 8.8 — "ICE Nest" (2x ICE Sentry II covering one choke point, RULESET.md §9)
 * is no longer dominant. Two things changed since it was last recorded here: 8.2b's "one virus, one
 * hit per tick" cap, and — the part that actually closed it — 8.4's `target-strike` giving a sheet
 * a way to kill the sentries outright instead of only tanking or evading their fire, plus 8.8's
 * sheet-generator.ts finally exercising it (its params weren't in the random generator's coverage
 * until this phase). Re-measured directly: the banded dominance search (`searchDominanceByBand`)
 * comes back clean on ICE Nest in every band 1-4 with the current population.
 */
export const KNOWN_DOMINANCE: KnownDominance = {
  viruses: [],
  defenses: [],
};
