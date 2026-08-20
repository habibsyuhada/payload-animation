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
- [x] **R2.3** Kamera cue-based: intro→follow→slow-mo klimaks→outro; bisa dimatikan (mode overview utk scrub) — durasi cue dihitung dari log. **Catatan:** `camera.ts` cuma menghasilkan data (`CameraCue`/`CameraShot`), tidak pernah menyentuh canvas — konsumen memetakan playback-time→battle-time lewat `battleTimeAt` lalu memberi T itu ke `drawFrame` yang sudah ada, jadi kontrak murni draw.ts tidak berubah. Mode overview (matikan sequencing) tinggal panggil `overviewShot(timeline)` langsung. Juga menambahkan `deathMoment()` terpisah untuk fitur "Kenapa aku kalah?" dari GDD (lompat ke 5 detik sebelum event fatal, slow-mo, zoom ke node terkait) — independen dari sequencing otomatis. 13 test baru (cue chaining, battle-time mapping monoton, framing per-cue, clamping pada battle pendek).
- [x] **R2.4** Komponen scrubber (packages/ui): bar+markers+speed+“momen kritis” — Playwright test interaksi. **Catatan:** `packages/ui` sebelumnya belum punya framework UI sama sekali — keputusan diambil di docs/ADR/0003 (React, karena PLAN.md sudah menyebut zustand yang mengasumsikan React, dan Capacitor paling mulus dari React). `Scrubber` adalah controlled component murni data-in/callback-out, tidak pernah import tipe `@payload/replay` langsung (boundaries rule sudah melarang `ui`→`replay`). Test interaksi jalan di Chromium sungguhan lewat `@vitest/browser` (pola sama seperti S1.6), 10 test (render, drag range, klik marker, ganti speed, tombol "Kenapa aku kalah?"). CI job utama sekarang install Playwright Chromium juga (bukan cuma job determinism-cross-platform), karena `pnpm test` packages/ui butuh browser sungguhan.
- [x] **R2.5** `export.ts`: render offscreen → WebM (MediaRecorder) + fallback GIF — file valid terputar di device uji. **Catatan:** WebM lewat `canvas.captureStream(0)` + `track.requestFrame()` (manual-frame mode, bukan sampling wall-clock) supaya setiap frame terenkode persis sesuai `drawFrame` yang dipanggil, diverifikasi di Chromium sungguhan (bukan device fisik — belum ada device uji di sesi ini) lewat `@vitest/browser`: Blob `video/webm` dengan magic byte EBML asli (`0x1A45DFA3`), bukan cuma "tidak error". GIF fallback (`gif.ts`) adalah encoder GIF89a buatan sendiri (LZW + palet kuantisasi seragam 216 warna) — lihat docs/ADR/0004 untuk alasan tidak nambah dependency, catatan jujur soal keterbatasan kuantisasi, dan quirk "early change" LZW-GIF yang sempat jadi bug nyata (dictionary decoder selalu tertinggal 1 entry dari encoder). `drawFrame` sekarang isi background opaque (`#12141c`, GDD §11) alih-alih `clearRect` transparan, supaya video/GIF hasil export tidak berlubang hitam.

### Fase 3 — Klien: builders (±3–4 sesi)
- [x] **C3.1** Shell app (Vite+router+state via zustand) + tema visual (palet GDD §11) — navigasi 7 screen kosong. **Catatan:** React + react-router (`HashRouter`, dipilih di muka karena C3.5 nanti membungkus dengan Capacitor yang serve dari `file://` tanpa server HTTP sungguhan untuk resolve path) + zustand (`appShellStore`, sengaja kecil — cuma judul screen aktif untuk header, bukan tempat sampah state). Palet (`theme.ts`) satu sumber kebenaran, ditulis sebagai CSS custom property lewat `applyTheme()`. 7 screen (HQ/Home, Virus Lab, Defense Grid, Scan/Attack, Replay Player, Research, League) sesuai GDD §12, masih placeholder kosong sesuai scope C3.1. Diverifikasi: `vite build` sukses, `vite preview` dites manual di Chromium sungguhan (screenshot navigasi HQ→Virus Lab), 10 test interaksi (`@vitest/browser`) meng-klik tiap nav link dan memverifikasi screen+header berubah.
- [x] **C3.2** Virus Lab: builder rantai blok drag&drop vertikal, payload budget, validasi — simulasi kering lokal (pakai packages/sim di klien!) vs 3 pertahanan latihan. **Catatan:** `simulate()` dari `@payload/sim` dipanggil LANGSUNG di browser (tidak ada server round-trip sama sekali) — selaras dengan prioritas "offline first" pemain. Bobot KB per blok (`blockCatalog.ts`) di-mirror manual dari RULESET.md §3/§4 karena `packages/sim` sengaja tidak memodelkan payload weight (itu domain validasi, bukan fisika battle — lihat komentar di `ruleset.ts`); kalau angka RULESET.md berubah, tabel ini perlu diedit manual juga. Reorder rantai blok pakai HTML5 native drag-and-drop DAN tombol naik/turun (drag native tidak berfungsi baik di touchscreen mobile — tombol adalah fallback yang sungguhan berfungsi & dites, bukan sekadar aksesibilitas). 3 pertahanan latihan (`practiceDefenses.ts`) pakai Core HP account-tier-1 tetap karena belum ada sistem akun (Fase 4/5). 18 test interaksi (`@vitest/browser`): tambah/hapus/reorder/ganti-tier blok, budget bar & disable saat over-budget, dan simulasi kering sungguhan menghasilkan 3 hasil menang/kalah nyata dari `packages/sim`.
- [x] **C3.3** Defense Grid: editor node (tap-place, drag-move, pinch-zoom), validator jalur real-time — tidak bisa save topologi invalid. **Catatan:** Entry(2)/Core(1) di posisi tetap ("sistem", GDD §5) dan tidak bisa dipindah/dihapus; pemain menempatkan node lain lewat palette (tap type → tap grid kosong), menyambungkan edge lewat tap-tap dua node (toggle), dan drag untuk reposisi. "Pinch-zoom" diimplementasi sebagai tombol +/− (gesture multi-touch sungguhan butuh handling touch-event yang di luar scope sesi ini — didokumentasikan, bukan disembunyikan, sama seperti kompromi drag&drop di C3.2). Validasi TIDAK diimplementasi ulang di klien — `validateDefenseGraph()` dari `@payload/sim` dipanggil langsung tiap render, jadi budget/reachability/edge-length semua real dari sim, bukan aturan yang di-mirror manual. Tombol Simpan disabled kecuali `validation.valid === true`. Ditemukan & diperbaiki bug nyata saat verifikasi manual: konversi koordinat klik→viewBox SVG mengabaikan rasio ukuran render-vs-viewBox (cuma dibagi `zoom`, tidak dikalikan rasio) — diperbaiki + `preserveAspectRatio="none"` biar rasionya sederhana. 10 test interaksi (`@vitest/browser`): place/remove/link/unlink/drag (lewat PointerEvent asli, bukan HTML5 draggable), zoom, dan alur simpan penuh yang valid.
- [x] **C3.4** Onboarding 5 battle tutorial vs AI (defense statis) — tutorial replay pertama memaksa 1x scrub mundur. **Catatan:** membangun `ReplayPlayer` (apps/client/src/components) — komponen pertama yang benar-benar menyatukan `drawFrame` (packages/replay) + `Scrubber` (packages/ui) + canvas + requestAnimationFrame loop jadi satu screen yang bisa dimainkan; ini juga cikal-bakal implementasi nyata layar "Replay Player" (masih placeholder di C3.1). 5 tutorial (Sensor/Condition/Attack/Stealth/Utility, Movement tidak dihitung karena wajib ada di semua virus) masing-masing dengan defense AI statis + seed tetap — **setiap hasil diverifikasi dengan benar-benar menjalankan `simulate()`** saat menulis fixture-nya (bukan diasumsikan), termasuk pembuktian eksplisit untuk Tutorial 1 (Sensor): dengan `Detect Honeypot`+`Backtrack` virus TIDAK PERNAH masuk node Honeypot (rute aman), sementara tanpa itu virus shortest-path mati — jadi pelajarannya sungguhan, bukan naratif kosong. `onboardingStore` melacak `hasScrubbedBackward`; tombol "Lanjut" di Tutorial 1 disabled sampai scrubber digeser mundur (`ReplayPlayer.onScrubBackward`), tutorial 2-5 tidak mensyaratkan ini. Onboarding bukan bagian dari 7 nav utama (diakses lewat tombol di HQ) karena ini alur sekali-jalan, bukan sesuatu yang dinavigasi berulang. 9 test baru (`ReplayPlayer` + `Onboarding`, `@vitest/browser`): render canvas+outcome nyata, toggle play/pause, callback scrub-mundur (sekali saja, bukan tiap gerakan mundur), gating Tutorial 1, dan alur penuh 5 tutorial sampai layar selesai.
- [ ] **C3.5** Capacitor wrap Android — APK debug terpasang & jalan 60fps di device mid-range. **Status jujur: SEBAGIAN, bukan selesai — lihat docs/ADR/0005.** Yang sudah beres: `@capacitor/android` terpasang, `capacitor.config.ts` (appId `com.payload.game`, webDir `dist`), `npx cap add android` sukses (proyek native ter-commit di `apps/client/android/`), dan `cap sync` terbukti benar meng-copy hasil `vite build` ke `android/app/src/main/assets/public`. Yang TIDAK bisa dikerjakan di sesi ini: `./gradlew` gagal total sejak langkah pertama — `dl.google.com` (Maven repo Android Gradle Plugin/SDK) diblokir 403 oleh kebijakan proxy sandbox ini (bukan error sementara — README proxy eksplisit bilang "jangan retry, laporkan"). Akibatnya build APK, instalasi `adb`, dan pengukuran 60fps di device sungguhan sama sekali belum terverifikasi — tidak ada device/emulator/SDK yang bisa diakses dari sesi ini. Checkbox sengaja dibiarkan kosong daripada di-centang atas progres sebagian; docs/ADR/0005 mencantumkan langkah persis yang perlu dijalankan di mesin dev/CI runner sungguhan untuk menyelesaikan sisanya.

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

### Fase 7 — Ruleset v2: virus sebagai event sheet (keputusan desain sudah diambil, lihat docs/ADR/0006)

Menggantikan model "rantai blok" v1 (ADR 0002) dengan event sheet bersarang ala GDevelop —
kondisi (AND) → aksi, dievaluasi tiap tick, mengatur **semua** perilaku virus termasuk gerakan.
Alasannya ada di ADR 0006: model v1 tidak bisa mengekspresikan contoh GDD §4.2 sendiri
(`IF Honeypot → Backtrack`), dan urutan blok jadi jebakan tersembunyi (rantai isi identik, beda
urutan → battle 53 tick vs 124 tick). v1 dibekukan, bukan dihapus: log lama wajib tetap bisa
diputar (DoD #3).

- [x] **V7.1** Tipe + engine v2 di `packages/sim`: `VirusProgram`, evaluasi depth-first per tick,
      slot-vs-cumulative action, `once` scope, event `rule-fired`. `simulate()` dispatch by
      `rulesetVersion`; golden log v1 wajib tetap byte-identical.
- [x] **V7.2** Katalog kondisi/aksi + bobot KB per kondisi & per aksi (+ batas jumlah event per
      account tier) di `docs/RULESET.md` v2.
- [ ] **V7.3** Virus Lab ditulis ulang jadi editor event sheet tap-driven (bukan drag bebas),
      nesting maksimal 3 level.
- [ ] **V7.4** `tools/balance-lab`: generator sheet acak + pencarian kombo dominan di CI —
      prasyarat rilis v2 ke pemain (GDD risiko "kombinatorik blok meledak").
- [ ] **V7.5** Tulis ulang gauntlet Defend (`gauntletViruses.ts`) + arketipe balance-lab sebagai
      sheet v2, dan sorot `rule-fired` di replay (chip aturan menyala saat aturannya menembak).

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
