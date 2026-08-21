# Balance Lab — winrate report (ruleset v2)

5 virus archetype x 4 defense archetype, 200 seeds per matchup.
Attacker winrate shown; flagged (**bold**) if outside [25%, 75%] — PLAN.md's S1.7 bar.

| Virus \ Defense | Firewall Wall | ICE Nest | Honeypot Maze | Balanced Gauntlet |
|---|---|---|---|---|
| Brute Rush | **100%** | **0%** | **100%** | **100%** |
| Ghost Crawler | **0%** | **0%** | 65.5% | **0.5%** |
| Scanner Hunter | **100%** | **0%** | **100%** | **100%** |
| Survivor | **92.5%** | **0%** | **17.5%** | **3%** |
| Ghost Scout | **0%** | **0%** | **100%** | **0%** |

## Flagged matchups

- **Brute Rush** vs **Firewall Wall**: 100% attacker winrate (200/200).
- **Brute Rush** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Brute Rush** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Brute Rush** vs **Balanced Gauntlet**: 100% attacker winrate (200/200).
- **Ghost Crawler** vs **Firewall Wall**: 0% attacker winrate (0/200).
- **Ghost Crawler** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Ghost Crawler** vs **Balanced Gauntlet**: 0.5% attacker winrate (1/200).
- **Scanner Hunter** vs **Firewall Wall**: 100% attacker winrate (200/200).
- **Scanner Hunter** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Scanner Hunter** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Scanner Hunter** vs **Balanced Gauntlet**: 100% attacker winrate (200/200).
- **Survivor** vs **Firewall Wall**: 92.5% attacker winrate (185/200).
- **Survivor** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Survivor** vs **Honeypot Maze**: 17.5% attacker winrate (35/200).
- **Survivor** vs **Balanced Gauntlet**: 3% attacker winrate (6/200).
- **Ghost Scout** vs **Firewall Wall**: 0% attacker winrate (0/200).
- **Ghost Scout** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Ghost Scout** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Ghost Scout** vs **Balanced Gauntlet**: 0% attacker winrate (0/200).

## Virus archetypes

- **Brute Rush**: Satu baris: Brute Force I + Exploit I + jalan ke Core (2190 KB) — agresi murni, tanpa evasi atau sustain.
- **Ghost Crawler**: Memutari Honeypot yang terdeteksi, lalu merayap sambil memperbaiki diri (2280 KB) — nol blok serang.
- **Scanner Hunter**: Exploit hanya saat berdiri di Firewall, Brute Force selalu (2350 KB) — kombo contoh GDD §4.2, sekarang bisa ditulis apa adanya.
- **Survivor**: Self Repair II + Decoy I yang menyala di bawah 50% Integrity, agresi konstan di bawahnya (2380 KB).
- **Ghost Scout**: Sensor maksimal, tempur nol (2370 KB): selalu memutari bahaya, dan merayap begitu ada Honeypot/Trap dalam radius.

## Defense archetypes

- **Firewall Wall**: 2x Firewall II (10pt) + ICE I + Trap I (18pt total) — brute-force resistance on both entry paths.
- **ICE Nest**: 2x ICE II (12pt) covering a shared Firewall I + Scanner I choke point (19pt total).
- **Honeypot Maze**: Dead-end Honeypot I decoys off each entry router (lures Random Walk), real path guarded by Firewall I + Trap I (16pt total).
- **Balanced Gauntlet**: One of every non-structural node type in a single line: Scanner I, ICE I, Honeypot I decoy, Firewall I, Trap I (15pt total).

## Dominance search (V7.4, ruleset v2)

45 generated sheets x 4 defense archetypes, 40 seeds per matchup, generator seed `700000`.

A build is flagged as **dominant** only when it beats *every* opponent it met: a virus above 75% against all defenses, or a defense holding every attacker below 25%.

- No generated sheet beat every defense archetype.
- **ICE Nest** holds every generated sheet to at most 7.5% — the RULESET §9 "ICE Nest" shape.

Known and already tracked (CI does not fail on these — see `src/known-dominance.ts`):

- **ICE Nest** — Two overlapping ICE Sentry II covering one choke point beat everything in v1 too (RULESET.md §9, recorded there as the top v2 priority and explicitly left undecided: cap ICE radius overlap? lower tier II accuracy?). v2's tick-based Cloak was one of the candidate fixes and is not enough on its own — the search now measures that instead of assuming it. PLAN.md 8.2b implemented the third candidate ('satu virus, satu tembakan per tick') — measured, and also not enough alone: it caps simultaneous same-tick double-hits, but two sentries with staggered (not synchronized) cooldowns still deliver a much higher SUSTAINED fire rate than one sentry ever could, and that staggered-coverage effect is what the archetype's ≤7.5% ceiling actually comes from, not simultaneity. Still open — PLAN.md 8.8 is where this gets resolved (candidates now narrowed to: shared cooldown pool across sentries covering the same node, or a hard cap on overlapping defense-node radii at save/validate time) or the archetype composition itself gets revised.

