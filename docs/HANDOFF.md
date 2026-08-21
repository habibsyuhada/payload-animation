# HANDOFF — Fase 8 sedang berjalan (node/blok/riset), 8.1–8.4 selesai

> Catatan serah-terima antar sesi. Ditulis 2026-08-21, branch
> `claude/plan-node-blok-logika-research-hm8xjl`. Menggantikan handoff Fase 7 (2026-08-20) — isinya
> sekarang bagian "sejarah" di §6.
> Dokumen acuan utama tetap `PLAN.md`; ini cuma peta jalan untuk sesi berikutnya.

## 1. Posisi sekarang

**Fase 7 (ruleset v2) selesai** (lihat §6 untuk ringkasannya). **Fase 8** (`docs/ADR/0007`, "node,
blok logika, riset") sedang berjalan: **8.1, 8.2, 8.3, 8.4 sudah landed**; 8.5 (dokumentasi — ADR
0008/0009, RULESET §11/§11a/§12a/§14, handoff ini) sedang ditulis di sesi yang sama dengan handoff
ini. 8.6–8.8 (pohon riset) **belum dimulai sama sekali**.

Yang sudah ada sejak Fase 7 selesai:

- **Tabel node v2 dipisah dari v1 yang beku** (8.1, ADR 0007 §A). `DefenseNodeType` jadi superset
  runtime-checked (`DEFENSE_NODE_TYPES_V1`/`_V2`), tabel angka v2 pindah ke `ruleset-v2.ts` +
  `nodes-v2/` (getter bersufiks `V2`, tidak me-re-export fungsi v1).
- **Lima node pertahanan baru** (8.2a, RULESET §14): Patch Server, Tarpit, Jammer, Turnstile,
  Alarm Relay — 11 tipe bisa dipasang sekarang, dari 6.
- **"ICE Nest" sebagian diperbaiki** (8.2b): satu virus hanya bisa kena satu tembakan ICE Sentry
  per tick. **Belum cukup** — masih dominan lewat cooldown yang tidak sinkron antar sentry, lihat
  §2(a).
- **Virus multi-entitas** (8.3a–8.3e, ADR 0008): `worm-split` memecah virus jadi 2–3 tubuh berbagi
  sheet yang sama; `detonate` sebagai pengorbanan sekali pakai; `set-checkpoint` + respawn.
  `packages/replay` dan `apps/client` menggambar N tubuh dengan health bar independen.
- **17 kondisi & 13 aksi baru** (8.4, RULESET §10.1/§10.2): 26 kondisi, 25 aksi total sekarang.
  Termasuk mekanik bahasa baru — 4 flag boolean per entitas (`set-flag`/`flag-is`) — dan subsistem
  HP untuk lima node pendukung (`target-strike`/`emp-burst`). `sheetCatalog.ts`'s
  `takesNodeTypes`/`takesThreshold` diganti `params: readonly ParamSpec[]` generik.
- **Riset masih placeholder.** `screens/Research.tsx` belum berubah dari Fase 7 — masih 13 baris
  yang mengaku "semua isi katalog terbuka sejak awal". Ini yang PLAN.md 8.6–8.8 kerjakan.

## 2. Yang berikutnya dikerjakan

Urutan **tidak boleh diacak** (PLAN.md): 8.6 → 8.7 → 8.8. Semuanya bergantung pada 8.1–8.4 yang
sudah selesai; tidak ada lagi yang memblokir mulainya.

### (a) "ICE Nest" masih dominan — 8.2b tidak cukup sendirian

Perbaikan "satu tembakan per tick" (8.2b) sudah berjalan, tapi dua ICE Sentry II yang cooldown-nya
**tidak sinkron** tetap memberi sustained fire rate lebih tinggi daripada satu sentry — itu yang
sebenarnya jadi sumber langit-langit ≤7.5% winrate, bukan simultanitas tembakan. Tercatat di
`tools/balance-lab/src/known-dominance.ts` dengan dua kandidat perbaikan lanjutan (shared cooldown
pool per node target, atau batas overlap radius saat save/validate). **PLAN.md 8.8** adalah tempat
ini akhirnya diputuskan — mengosongkan `known-dominance.ts` tetap syarat rilis v2 (PLAN.md V7.4).

### (b) Pohon riset (PLAN.md 8.6–8.8) — belum dimulai

Desainnya sudah final di ADR 0007 §C dan ADR 0009 (arsitektur: `packages/shared`, boundaries
`shared → sim` dilonggarkan, `ResearchState` lokal-dulu tapi berbentuk payload server). Yang
tersisa murni implementasi:

- **8.6**: `packages/shared/src/research.ts` + `research-tree.ts` (±70 simpul, 5 cabang) +
  `unlocks.ts`. Test kelengkapan (tiap kind & pasangan node×tier tepat sekali di pohon), tanpa
  siklus prasyarat, starter set cukup untuk sheet legal tier akun 1.
- **8.7**: `state/researchStore.ts`, `logic/unlocks.ts` (`isUnlocked`, `validateAgainstUnlocks`),
  `screens/Research.tsx` menggantikan placeholder, migrasi sekali-jalan untuk sheet/layout
  tersimpan (ADR 0009 §D) — **wajib** sebelum penguncian aktif, kalau tidak pemain lama menemukan
  virusnya sendiri "ilegal".
- **8.8**: `tools/balance-lab` — parameter baru di generator (`hops`/`ticks`/`flagIndex`/`count`),
  `NODE_TYPES` diperluas, dimensi pita kedalaman riset di `dominance.ts`/`report.ts`. Ini juga
  tempat "ICE Nest" (poin a) akhirnya diselesaikan.

### (c) Kalibrasi pita winrate & offline-first (belum berubah dari Fase 7)

Backlog terpisah, tidak diblokir Fase 8: `tools/balance-lab/REPORT.md` selalu bisa diregenerasi
(`pnpm --filter @payload/balance-lab build:deps && node tools/balance-lab/dist/cli.js`); offline
(PWA/service worker, `tools/seed-defenses`, riwayat battle) masih di posisi yang sama seperti
handoff Fase 7 — lihat riwayat commit doc ini kalau perlu detailnya lagi.

## 3. Peta file

```
packages/sim/src/
  types.ts           kontrak data; ConditionKind/ActionKind (26/25 kind), SheetCondition/
                      SheetAction params baru (hops, ticks, flagIndex, count, thresholdPermille,
                      targetNodeTypes, flagValue), DefenseNodeType superset (8.1a)
  simulate.ts        DISPATCHER — ini yang dipanggil semua orang
  engine.ts          engine v1, DIBEKUKAN (simulateV1). Jangan disentuh.
  engine-v2.ts       engine sheet v2 MULTI-ENTITAS; urutan tick lengkap di docstring-nya + RULESET §11
  sheet.ts           bentuk sheet, harga, validateVirusProgram (+ range check param 8.4), sheetCanSplit
  ruleset-v2.ts      SEMUA angka v2: kondisi/aksi (termasuk 8.4), 12 tipe node (7 lama + 5 baru),
                      subsistem HP node pendukung (SUPPORT_NODE_HP_V2)
  ruleset.ts         SEMUA angka v1, DIBEKUKAN — git diff --stat wajib kosong sepanjang Fase 8
  nodes/             perilaku node v1, DIBEKUKAN
  nodes-v2/          perilaku node v2, 1:1 dengan DEFENSE_NODE_TYPES_V2 (8.1b/8.2a)
  score.ts           skor; v2 multi-entitas pakai MAKSIMUM integrity antar entitas hidup (ADR 0008)
  battle-common.ts   lookup graf yang dipakai kedua engine
packages/replay/src/
  compile.ts         BattleLog -> Timeline; N track virus ("virus" untuk entitas 0, "virus:N" lainnya)
  camera.ts          terminalMarker/follow-cam sadar multi-entitas
  draw.ts            gambar N tubuh, tracer per entitas
apps/client/src/
  screens/VirusLab.tsx    editor event sheet; ConditionParamControl/ActionParamControl generik (8.4)
  state/virusLabStore.ts  ConditionInstance/ActionInstance + field param 8.4, updateAction baru
  data/sheetCatalog.ts    ParamSpec generik menggantikan takesNodeTypes/takesThreshold (8.4)
  screens/Defend.tsx      halaman Defend; frame.viruses[] untuk N tubuh
  logic/attackPlayback.ts viruses[] + alias skalar entitas 0 untuk kompatibilitas mundur
  screens/Research.tsx    MASIH PLACEHOLDER — ini yang 8.7 ganti
tools/balance-lab/src/
  sheet-generator.ts generator sheet acak berbenih — BELUM tahu param 8.4 (hops/ticks/dst) atau
                      node baru (8.2a) — pekerjaan 8.8
  known-dominance.ts utang yang sudah diketahui — "ICE Nest" masih satu-satunya entry
docs/ADR/
  0006-*.md   event sheet (accepted)
  0007-*.md   payung Fase 8 — node/blok/riset, prasyarat arsitektur (accepted, implementasi Fase 8)
  0008-*.md   virus multi-entitas & checkpoint (accepted, 8.3)
  0009-*.md   riset & ekonomi lokal (proposed, implementasi 8.6-8.8)
docs/RULESET.md   §0–§9 v1 (beku), §10–§14 v2 (10.1-10.5 sheet, 11/11a tick+RNG, 12/12a budget+multi-entitas,
                  13 balance-lab, 14/14.1 node v2 + HP node pendukung)
```

## 4. Cara menjalankan

```bash
pnpm lint && pnpm typecheck && pnpm build          # semua hijau saat handoff ini ditulis

# semua test butuh Chromium; di sandbox ini path-nya harus disebut eksplisit
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test
# packages/sim sendiri: 308 test (engine-v2.test.ts sekarang 67, termasuk 10 aksi baru 8.4)
# apps/client sendiri: 100 test (termasuk sheetCatalog.test.ts baru + 2 kasus param VirusLab.test.tsx)
# packages/replay: 66 test. tools/balance-lab: 29 test.

pnpm --filter @payload/balance-lab dominance       # cek dominasi (~1 menit), ini yang di CI
pnpm --filter @payload/balance-lab report          # laporan lengkap; exit 1 selama masih ada
                                                   # matchup di luar pita — itu memang backlog
# Keduanya mem-build dependensinya sendiri lewat turbo (`build:deps`), jadi jalan dari clone bersih.
pnpm dev --port 5199                               # /#/virus-lab dan /#/defend
```

Catatan: `pnpm test` **tanpa** `PLAYWRIGHT_CHROMIUM_PATH` gagal di sandbox ini karena bundle
browser di sini bukan headless-shell yang dicari Playwright. Murni masalah lingkungan sandbox — CI
memasang browsernya sendiri (`playwright install`) dan test ini lewat di sana.

Deploy: workflow `deploy-pages.yml` dijalankan manual (`workflow_dispatch`) dari branch ini.

## 5. Jebakan yang sudah ketemu (jangan diulang)

Nomor 1–18 dari handoff Fase 7 masih berlaku semua (lihat riwayat commit doc ini kalau perlu
teksnya lagi). Yang di bawah ini tambahan dari Fase 8.

19. **`packages/sim`'s `dist/` basi bikin konsumen lain berbohong.** `packages/replay` dan
    `apps/client` mengimpor `@payload/sim` dari `dist/` **hasil build**, bukan dari `src/`
    langsung. Mengedit `engine-v2.ts`/`ruleset-v2.ts` lalu langsung menjalankan test
    `packages/replay` di sesi yang sama akan memakai perilaku LAMA sampai
    `cd packages/sim && npx tsc -p tsconfig.json` (build penuh, bukan cuma `--noEmit`) dijalankan
    ulang. Ditemukan waktu menambah field `delta` ke event `virus-split` (8.3e): test replay terus
    menghitung integrity 0, bukan 0.5, sampai `dist/` di-rebuild.
20. **`entityId: undefined` bukan byte yang sama dengan kunci yang absen.** `stableStringify`
    (`determinism.test.ts`) memakai `Object.keys`, jadi `{...event, entityId: undefined}`
    ter-serialize sebagai `"entityId":undefined` — beda dari kunci yang benar-benar tidak ada.
    Field opsional pada `BattleEvent` wajib ditulis lewat idiom spread bersyarat
    (`...(canSplit ? { entityId } : {})`), bukan `entityId: canSplit ? entity.id : undefined`.
21. **Aksi slot movement mengkredit `rule-fired` begitu barisnya menulis slot itu — terlepas dari
    apakah virusnya benar-benar bergerak.** `hold-position` sudah begitu sejak lama (disengaja,
    lihat komentarnya), tapi ini berlaku untuk SEMUA aksi movement, termasuk yang baru (8.4):
    menaruh `move-toward-core`/`target-strike`/dll di baris yang SAMA dengan aksi kumulatif lain
    yang ingin diuji "tidak fired ketika tidak berefek" akan membuat baris itu selalu ter-kredit
    lewat sisi movement-nya, menyembunyikan bug (atau membuat test palsu-hijau) di sisi
    kumulatifnya. Test yang ingin mengisolasi kredit sebuah aksi kumulatif harus menaruh
    movement-nya di baris LAIN.
22. **`core-within-hops` (dan kondisi posisi lain yang membaca lokasi) "melihat ke depan" saat
    virus di tengah edge — dipakai `location.to`, bukan node asal.** Ini konsisten dengan
    `node-ahead-is`, tapi menjebak kalau sebuah aksi (mis. `recall`) dipasangkan dengan kondisi ini
    plus `once`: kondisinya bisa jadi TRUE lebih dulu saat masih di tengah edge menuju node target,
    men-set niat gerak yang **diantre** (bukan langsung dieksekusi), lalu `once`-nya sudah terpakai
    — dan niat yang diantre itu kalah dari baris fallback begitu tiba, karena baris fallback selalu
    menulis ulang slot movement tiap tick. Kalau ingin sebuah aksi baru bereaksi HANYA saat benar-
    benar berdiri di sebuah node, jangan gabungkan dengan `once` tanpa memeriksa perilaku "lihat ke
    depan" ini dulu.
