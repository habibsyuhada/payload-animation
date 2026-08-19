# Balance Lab — winrate report (ruleset v1)

5 virus archetype x 4 defense archetype, 200 seeds per matchup.
Attacker winrate shown; flagged (**bold**) if outside [25%, 75%] — PLAN.md's S1.7 bar.

| Virus \ Defense | Firewall Wall | ICE Nest | Honeypot Maze | Balanced Gauntlet |
|---|---|---|---|---|
| Brute Rush | **100%** | **0%** | **100%** | **100%** |
| Ghost Crawler | **0%** | **0%** | **100%** | **0.5%** |
| Scanner Hunter | **100%** | **0%** | **100%** | **100%** |
| Survivor | **77%** | **0%** | **17.5%** | **3%** |
| Ghost Scout | **0%** | **0%** | **100%** | **0%** |

## Flagged matchups

- **Brute Rush** vs **Firewall Wall**: 100% attacker winrate (200/200).
- **Brute Rush** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Brute Rush** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Brute Rush** vs **Balanced Gauntlet**: 100% attacker winrate (200/200).
- **Ghost Crawler** vs **Firewall Wall**: 0% attacker winrate (0/200).
- **Ghost Crawler** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Ghost Crawler** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Ghost Crawler** vs **Balanced Gauntlet**: 0.5% attacker winrate (1/200).
- **Scanner Hunter** vs **Firewall Wall**: 100% attacker winrate (200/200).
- **Scanner Hunter** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Scanner Hunter** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Scanner Hunter** vs **Balanced Gauntlet**: 100% attacker winrate (200/200).
- **Survivor** vs **Firewall Wall**: 77% attacker winrate (154/200).
- **Survivor** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Survivor** vs **Honeypot Maze**: 17.5% attacker winrate (35/200).
- **Survivor** vs **Balanced Gauntlet**: 3% attacker winrate (6/200).
- **Ghost Scout** vs **Firewall Wall**: 0% attacker winrate (0/200).
- **Ghost Scout** vs **ICE Nest**: 0% attacker winrate (0/200).
- **Ghost Scout** vs **Honeypot Maze**: 100% attacker winrate (200/200).
- **Ghost Scout** vs **Balanced Gauntlet**: 0% attacker winrate (0/200).

## Virus archetypes

- **Brute Rush**: Shortest Path + Brute Force I + Exploit I (2150 KB) — pure aggression, no evasion or sustain.
- **Ghost Crawler**: Backtrack + Cloak I + Slow Crawl I + Detect Honeypot I + Self Repair I (2200 KB) — pure evasion, no Attack blocks at all.
- **Scanner Hunter**: Shortest Path + "IF Node=Firewall" I gating Exploit I, plus unconditional Brute Force I (2270 KB) — GDD's own example combo.
- **Survivor**: "IF Integrity<50%" I gating Brute Force I, plus Self Repair II and Sacrifice Decoy II (2400 KB, exact budget) — tanky, reactive aggression.
- **Ghost Scout**: Backtrack + Scan Ahead III + Detect Honeypot III + Cloak I (2250 KB) — maximum detection/evasion, zero combat capability.

## Defense archetypes

- **Firewall Wall**: 2x Firewall II (10pt) + ICE I + Trap I (18pt total) — brute-force resistance on both entry paths.
- **ICE Nest**: 2x ICE II (12pt) covering a shared Firewall I + Scanner I choke point (19pt total).
- **Honeypot Maze**: Dead-end Honeypot I decoys off each entry router (lures Random Walk), real path guarded by Firewall I + Trap I (16pt total).
- **Balanced Gauntlet**: One of every non-structural node type in a single line: Scanner I, ICE I, Honeypot I decoy, Firewall I, Trap I (15pt total).

