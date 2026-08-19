# PAYLOAD — Implementation Plan

> Plan eksekusi production-ready. Dokumen ini hidup di root repo dan menjadi acuan utama
> saat mengeksekusi tiap fase via Claude Code. Referensi desain: `docs/GDD.md`.
> Prinsip: **sim deterministik adalah jantungnya** — semua dibangun mengelilinginya.

---

## 0. Keputusan Teknis (final untuk v1)

| Area | Keputusan | Alasan |
|---|---|---|
| Bahasa | **TypeScript end-to-end** | Sim ditulis SEKALI, dijalankan identik di server (resolusi battle) dan klien (preview & validasi replay). Menghilangkan risiko desync dua implementasi. |
| Klien mobile | **Web (Canvas 2D) + Capacitor** | Prototype HTML canvas sudah terbukti; Capacitor membungkusnya jadi APK/IPA + akses push notification. Renderer time-driven portabel ke web viewer (share replay via link) tanpa kerja tambahan. |
| Server | **Node.js (Fastify) + PostgreSQL** | Ringan, familiar dengan tooling deploy user (Docker + VPS + PostgreSQL). |
| Realtime | Tidak perlu — game async. REST + push notification (FCM). | |
| Matematika sim | **Integer/fixed-point (skala 1000)** | Determinisme lintas platform; float dilarang di dalam `packages/sim`. |
| Monorepo | **pnpm workspaces + Turborepo** | Sim, renderer, klien, server dalam satu repo; Claude Code bisa lintas-package dalam satu sesi. |
| Testing | Vitest (unit + property-based via fast-check), Playwright (e2e klien) | Sim deterministik = sangat mudah di-unit-test. |
| CI/CD | GitHub Actions → build, test, **battle-regression suite**, docker push → deploy VPS | |

Yang secara sadar TIDAK dipakai di v1: game engine (Unity/Godot — overkill untuk render node-link 2D), WebSocket, microservices (monolith dulu, modular di level package).

---

## 1. Struktur Repo

```
payload/
├── PLAN.md                  ← dokumen ini
├── docs/
│   ├── GDD.md               ← game design document
│   ├── RULESET.md           ← spesifikasi angka & formula (source of truth balancing)
│   └── ADR/                 ← architecture decision records (1 file per keputusan)
├── packages/
│   ├── sim/                 ← ★ deterministic battle simulation (pure TS, ZERO deps)
│   │   ├── src/
│   │   │   ├── types.ts     (VirusDesign, DefenseGraph, BattleLog, Ruleset)
│   │   │   ├── rng.ts       (PRNG seeded — mulberry32/xoshiro, integer only)
│   │   │   ├── graph.ts     (pathfinding, validasi topologi)
│   │   │   ├── blocks/      (1 file per blok logika virus)
│   │   │   ├── nodes/       (1 file per tipe node pertahanan)
│   │   │   ├── engine.ts    (tick loop → BattleLog)
│   │   │   └── rulesets/    (v1.json, v2.json… — versi ruleset immutable)
│   │   └── test/            (unit + golden logs + property tests)
│   ├── replay/              ← time-driven replay compiler + renderer (Canvas 2D)
│   │   ├── src/
│   │   │   ├── ease.ts      (mix, interpolate, easeOutCubic, easeOutBack…)
│   │   │   ├── compile.ts   (BattleLog → Timeline deklaratif: fungsi dari T)
│   │   │   ├── camera.ts    (cue-based sequencing: intro/follow/klimaks/outro)
│   │   │   ├── draw.ts      (renderer murni: draw(timeline, T, ctx))
│   │   │   └── export.ts    (render offscreen frame-by-frame → WebM/GIF)
│   │   └── test/
│   ├── shared/              ← DTO & zod schemas (kontrak API klien↔server)
│   └── ui/                  ← komponen UI reusable (chips, panel, timeline scrubber)
├── apps/
│   ├── client/              ← app mobile (Vite + Capacitor)
│   │   └── src/screens/     (home, virus-lab, defense-grid, scan, replay, research, league)
│   ├── server/              ← Fastify API
│   │   ├── src/modules/     (auth, battle, defense, matchmaking, league, notify)
│   │   └── migrations/      (SQL, via node-pg-migrate)
│   └── replay-viewer/       ← web viewer publik: buka replay dari kode share (reuse packages/replay)
├── infra/
│   ├── docker-compose.yml   (server + postgres + nginx, untuk VPS)
│   └── github-actions/
└── tools/
    ├── balance-lab/         ← CLI: simulasi massal NxM matchup → laporan winrate
    └── seed-defenses/       ← generator pertahanan AI untuk populasi awal
```

**Aturan dependensi (ditegakkan via eslint boundaries):**
`sim` tidak boleh import apa pun. `replay` hanya boleh import `sim` (types). `server` & `client` boleh import `sim`, `replay`, `shared`. Tidak ada import antar-app.

---

## 2. Kontrak Data Inti

Ini API internal terpenting — kunci dulu sebelum menulis fitur apa pun (Fase 1).

```ts
// packages/sim — semua angka integer (posisi ×1000, waktu dalam tick; 1 tick = 50ms)
simulate(input: BattleInput): BattleLog

interface BattleInput {
  rulesetVersion: string;      // "v1" — replay lama tetap valid setelah patch
  seed: number;
  virus: VirusDesign;          // rantai blok + tier
  defense: DefenseGraph;       // nodes, edges, tier
}

interface BattleLog {
  input: BattleInput;          // log SELALU self-contained → replayable selamanya
  events: BattleEvent[];       // {tick, type, actor, target?, delta?}
  result: { winner: 'attacker'|'defender'; score: Score };
}

// packages/replay
compileTimeline(log: BattleLog, layout: Layout): Timeline
drawFrame(timeline: Timeline, T: number, ctx: CanvasRenderingContext2D): void
// drawFrame WAJIB fungsi murni dari (timeline, T) — tidak ada state internal.
```

**Invarian yang dijaga test:** (1) `simulate(x)` selalu identik untuk input sama; (2) `drawFrame(tl, T)` identik untuk (tl, T) sama — di-scrub bolak-balik hasilnya sama; (3) BattleLog versi ruleset lama tetap ter-replay setelah ruleset baru rilis.

---

## 3. Fase Eksekusi

Setiap fase = beberapa sesi Claude Code. Format task: `[ID] deskripsi — acceptance criteria`.
Aturan main per sesi: baca PLAN.md + RULESET.md → kerjakan 1–3 task → test hijau → update checklist di bawah → commit dengan pesan `feat(scope): [ID] …`.

### Fase 0 — Fondasi repo (±1 sesi)
- [x] **F0.1** Scaffold monorepo pnpm+turbo, tsconfig strict, eslint+boundaries, vitest — `pnpm test` & `pnpm build` hijau di repo kosong.
- [x] **F0.2** CI GitHub Actions: lint+test+build di tiap PR — badge hijau.
- [x] **F0.3** Tulis `docs/RULESET.md` v1: seluruh angka dari GDD (§4–6) dalam tabel + formula damage — draft ditulis, **menunggu review manual** sebelum lanjut ke Fase 1 (lihat status banner & §9 di RULESET.md).

### Fase 1 — Sim engine (jantung; ±3–4 sesi)
- [x] **S1.1** Types + PRNG + fixed-point helpers — property test: PRNG sequence identik lintas run.
- [x] **S1.2** Graph & validasi topologi (setiap Entry punya jalur ke Core; budget node) — unit test kasus valid/invalid.
- [x] **S1.3** Engine tick loop + movement blocks (Shortest Path, Random Walk seeded, Backtrack) — golden log test: 3 skenario di-freeze sebagai snapshot. **Catatan:** scope murni movement; node combat (S1.4) & logic blocks (S1.5) belum ada, Core arrival masih instant-win stub — lihat docs/ADR/0001.
- [x] **S1.4** Node pertahanan: Router, Firewall, ICE, Honeypot, Scanner, Trap, Core — tiap node ≥3 unit test perilaku.
- [x] **S1.5** Blok Sensor/Condition/Attack/Stealth/Utility (12 blok v1 sesuai RULESET) — tiap blok ≥2 test.
- [x] **S1.6** Determinisme lintas platform: jalankan suite di Node Linux + browser (CI matrix) — hash BattleLog identik.
- [x] **S1.7** `tools/balance-lab`: N virus archetype × M defense archetype → tabel winrate — CLI jalan, output markdown (lihat `tools/balance-lab/REPORT.md`). **Catatan jujur:** bar "tidak ada matchup >75% winrate" belum sepenuhnya tercapai — 1 perbaikan sistemik diterapkan (passive drain 10→15, lihat RULESET.md §9) dan itu menyelesaikan masalah paling parah (virus non-Attack 0% lawan segala Firewall), tapi sebagian besar dari 20 matchup arketipe S1.7 masih di luar rentang. Sebagian besar itu memang rock-paper-scissors yang GDD inginkan (arketipe sengaja ekstrem untuk stress-test batas sistem), KECUALI satu temuan nyata ("ICE Nest" menang 100% lawan semua 5 arketipe virus) yang dicatat sebagai prioritas v2 di RULESET.md §9, bukan diselesaikan sekarang.

### Fase 2 — Replay engine (vertical slice yang "menjual"; ±3 sesi)
- [x] **R2.1** `ease.ts` + `compile.ts`: BattleLog → Timeline — test: scrub maju lalu mundur ke T sama → frame hash identik.
- [x] **R2.2** `draw.ts`: bahasa visual penuh (paket+wobble+trail, tembakan ICE, crack firewall easeOutBack, trap, drain core, burst menang/kalah) — review visual manual dengan 5 golden log. **Catatan:** `drawFrame(timeline, T, ctx)` murni fungsi (timeline, T) lewat `DrawContext2D` custom (bukan lib DOM), diverifikasi determinism + scrub-safety di test; 5 golden log (clean win, firewall breach, ICE gauntlet, trap/honeypot, timeout stalemate) dirender ke PNG contact-sheet via `@napi-rs/canvas` (tool preview sekali-pakai, bukan dependency package) dan dikirim untuk review manual.
- [ ] **R2.3** Kamera cue-based: intro→follow→slow-mo klimaks→outro; bisa dimatikan (mode overview utk scrub) — durasi cue dihitung dari log.
- [ ] **R2.4** Komponen scrubber (packages/ui): bar+markers+speed+“momen kritis” — Playwright test interaksi.
- [ ] **R2.5** `export.ts`: render offscreen → WebM (MediaRecorder) + fallback GIF — file valid terputar di device uji.

### Fase 3 — Klien: builders (±3–4 sesi)
- [ ] **C3.1** Shell app (Vite+router+state via zustand) + tema visual (palet GDD §11) — navigasi 7 screen kosong.
- [ ] **C3.2** Virus Lab: builder rantai blok drag&drop vertikal, payload budget, validasi — simulasi kering lokal (pakai packages/sim di klien!) vs 3 pertahanan latihan.
- [ ] **C3.3** Defense Grid: editor node (tap-place, drag-move, pinch-zoom), validator jalur real-time — tidak bisa save topologi invalid.
- [ ] **C3.4** Onboarding 5 battle tutorial vs AI (defense statis) — tutorial replay pertama memaksa 1x scrub mundur.
- [ ] **C3.5** Capacitor wrap Android — APK debug terpasang & jalan 60fps di device mid-range.

### Fase 4 — Server & async loop (±3–4 sesi)
- [ ] **B4.1** Auth (email magic-link / device token) + skema DB (users, defenses, viruses, battles, seasons) — migrasi up/down bersih.
- [ ] **B4.2** Endpoint battle: `POST /attack` → server jalankan `simulate()` → simpan BattleLog+seed → kembalikan log — klien memutar replay dari respons; hash log klien==server (validasi anti-cheat dasar).
- [ ] **B4.3** Matchmaking scan-list (rentang rating, refresh cooldown), shield anti dog-pile, revenge 1x — aturan sesuai GDD §8, integration test.
- [ ] **B4.4** Rating (Glicko-2 sederhana) + liga musiman + reset lunak — cron musiman teruji dengan clock mock.
- [ ] **B4.5** Notifikasi FCM "basmu diserang" + inbox battle log — tap notif → langsung buka replay.
- [ ] **B4.6** Replay share code + `apps/replay-viewer` publik — link dibuka di browser tanpa login, memutar replay penuh.
- [ ] **B4.7** Deploy: docker-compose (server+postgres+nginx TLS) ke VPS + backup DB harian — staging hidup, healthcheck & alert dasar.

### Fase 5 — Meta & ekonomi (±2–3 sesi)
- [ ] **M5.1** Research tree (unlock blok/node, cabang stealth vs brute) — state di server, anti-tamper.
- [ ] **M5.2** Currency Data + loot + misi harian (sesuai GDD §9) — misi ter-track server-side.
- [ ] **M5.3** Loadout virus (5 slot) + preset starter per archetype.
- [ ] **M5.4** Seed populasi: `tools/seed-defenses` menghasilkan 200 pertahanan AI 3 tingkat kesulitan — scan list tidak pernah kosong.

### Fase 6 — Polish, monetisasi, rilis (±3 sesi)
- [ ] **P6.1** Kosmetik (skin virus, tema jaringan, frame export) + battle pass scaffold — pemisahan ketat: kosmetik tidak menyentuh packages/sim.
- [ ] **P6.2** IAP (Google Play Billing) + validasi receipt server-side.
- [ ] **P6.3** Audio: SFX dipetakan ke event log + musik — audio ikut ter-scrub tanpa desync (dijadwalkan dari T).
- [ ] **P6.4** Performa: object pooling render, target 60fps device low-mid; export adaptif.
- [ ] **P6.5** Telemetri privacy-sane (funnel onboarding, retensi D1/D7) + crash reporting.
- [ ] **P6.6** Store listing + soft launch 1 negara → ukur retensi & winrate live → patch ruleset v2.

---

## 4. Definition of Done (berlaku semua task)

1. Test tertulis dan hijau (unit untuk sim/replay; integration untuk server; Playwright untuk UI kritikal).
2. `pnpm lint && pnpm build` bersih; tidak ada `any` baru tanpa alasan tertulis.
3. Perubahan angka gameplay HANYA lewat `docs/RULESET.md` + file ruleset versi baru — tidak pernah hardcode di logic.
4. Jika keputusan arsitektur diambil → tulis ADR pendek di `docs/ADR/`.
5. Checklist fase di PLAN.md diupdate dalam commit yang sama.

## 5. Battle-Regression Suite (gerbang CI khusus)

Folder `packages/sim/test/golden/` menyimpan ±20 BattleInput + hash BattleLog-nya.
CI menjalankan ulang semuanya di tiap PR:
- Hash berubah TANPA bump versi ruleset → **CI merah** (regresi determinisme).
- Bump ruleset → golden log lama tetap dijalankan dengan ruleset lama (arsip immutable) → harus tetap identik.

Ini satu-satunya cara aman menyentuh engine setelah live — replay pemain tidak boleh rusak oleh patch.

## 6. Risiko Teknis & Mitigasi

- **Determinisme bocor** (float, `Date.now`, iterasi object non-deterministik) → lint rule custom di packages/sim: larang `Math.random`, `Date`, float ops pada state; CI matrix Node+browser (S1.6).
- **Performa canvas di low-end** → renderer dirancang stateless per frame sejak awal (mudah di-profile), dirty-region + pooling di P6.4; batas keras: 1 battle ≤ 400 event.
- **Balancing meledak** → balance-lab (S1.7) jalan di CI mingguan; blok baru hanya masuk lewat laporan winrate.
- **Populasi awal sepi** → seed defenses (M5.4) sejak hari pertama soft launch.
- **Scope creep** → fitur baru masuk `docs/BACKLOG.md`, tidak pernah menyela fase berjalan.

## 7. Urutan Mulai (sesi Claude Code pertama)

1. Sesi 1: F0.1 + F0.2 (scaffold + CI).
2. Sesi 2: F0.3 — tulis RULESET.md v1 bersama (ini sesi diskusi, bukan coding).
3. Sesi 3+: masuk Fase 1. Jangan sentuh UI sebelum S1.6 hijau — semua yang lain dibangun di atas sim yang terbukti deterministik.
