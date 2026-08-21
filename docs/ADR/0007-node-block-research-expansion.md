# ADR 0007 — Ekspansi konten (node, blok logika) & fondasi sistem riset

**Status:** proposed — desain sudah final, implementasi adalah Fase 8 di `PLAN.md`.
**Context:** `packages/sim/src/{types,ruleset-v2,engine-v2,graph}.ts`, `docs/RULESET.md` §5/§10–13,
`docs/ADR/0006`, `apps/client/src/screens/{VirusLab,Defend,Research}.tsx`, `docs/GDD.md` §4/§5/§9.

## Problem

Tiga sistem yang saling mengunci — node pertahanan, blok logika (event sheet v2), dan riset — berada
di titik yang timpang:

- **Node pertahanan**: 6 tipe bisa dipasang (`router`, `firewall`, `ice-sentry`, `honeypot`,
  `scanner`, `trap`). Taksonomi RULESET §5.0 mendefinisikan 5 kelas mekanik (Breach/Shoot/Trigger/
  Aura/Struktural) tapi tiga kelas nyaris kosong.
- **Blok logika v2**: 9 kondisi, 12 aksi (RULESET §10) — cukup untuk membuktikan bahasa event-sheet
  bekerja, tidak cukup untuk melahirkan arketipe beragam. Empat blok yang GDD §4.2 sendiri sebut
  (`Read Traffic`, `Worm Split`, `Spoof Signature`, `Checkpoint`) masih ditunda sejak v1 (RULESET §4).
- **Riset**: tidak ada sama sekali. `screens/Research.tsx` adalah placeholder yang mengakui sendiri
  "sekarang semua isi katalog terbuka sejak awal". GDD §9's loop panjang ("naik divisi liga, unlock
  blok logika baru") tidak punya isi.

Dua utang yang sudah tercatat dan harus dibayar sebagai bagian dari pekerjaan ini, bukan terpisah:

1. **"ICE Nest"** (RULESET §9/§13, `tools/balance-lab/src/known-dominance.ts`) — dua ICE Sentry II
   yang radiusnya menumpuk menahan **setiap** sheet acak di ≤7.5% winrate. Mengosongkan
   `known-dominance.ts` adalah syarat rilis v2 (PLAN.md V7.4).
2. **`engine-v2.ts` membaca tabel node dari `nodes/`/`ruleset.ts` yang dibekukan bersama v1** — tidak
   ada node baru yang bisa ditambahkan sebelum tabel v2 dipisah. Blocker yang sama menghalangi
   perbaikan ICE Nest (butuh tabel node v2 sendiri untuk eksperimen tanpa menyentuh v1).

## Decision

### Ruleset: extend v2 di tempat, bukan bump ke v3

Sah karena **tidak ada satu pun `BattleLog` yang pernah dipersistensi** — klien hanya menyimpan
input mentah (`state/localPersist.ts`), bukan log, sehingga belum ada replay nyata yang bergantung
pada angka v2. Preseden: RULESET §9 mengedit v1 in-place dengan alasan yang sama sebelum ada
BattleLog nyata. Konsekuensi: golden log v2 di `packages/sim/test/determinism.test.ts` akan berubah
di titik-titik yang memang mengubah angka (rebalance ICE Nest, blok/node baru) — perubahan itu wajib
disengaja dan disebut di commit message; di luar titik itu hash harus tetap byte-identical. Golden
log **v1 tidak boleh bergeser sama sekali**, tetap dijaga CI.

### A. Node pertahanan: 6 → 11 tipe

Lima node baru, tiap satu punya jawaban di sisi virus supaya tidak ada yang jadi "ICE Nest"
berikutnya:

| Node | Kelas | Cost I/II/III | Efek | Dijawab oleh |
|---|---|---|---|---|
| Patch Server | Aura (support) | 3/4/6 | +8/12/18 HP/tick ke Breach Node hidup radius 1/1/2 hop | Burst damage (`exploit`/`overload`), `target-strike` |
| Tarpit | Aura (debuff) | 2/3/4 | Speed ×600/500/400‰ radius 1/1/2, tidak menumpuk | `purge`, `sprint`, rute memutar |
| Jammer | Aura (blind) | 3/4/6 | Semua kondisi sensor bernilai false radius 1/2/2; tier III memalsukan `node-ahead-is` | Kondisi `jammed`, `emp-burst`, flag yang ditulis sebelum masuk |
| Turnstile | Struktural | 2/3/4 | Node yang ditinggalkan tak bisa dikunjungi ulang 40/70/110 tick | Perencanaan rute, `set-checkpoint` di sisi benar |
| Alarm Relay | Trigger→Aura | 4/5/7 | Sekali/battle: siaga 120/180/240 tick, semua ICE −1 tick interval, +100‰ akurasi | `alarm-active`, `emp-burst`, bunuh sebelum terpicu |

Perbaikan ICE Nest: **satu virus hanya bisa kena satu tembakan ICE Sentry per tick** (pemenang =
`node id` terkecil di antara sentry yang punya target valid; sentry lain tetap menghabiskan
cooldown-nya). Node lama tidak berubah angkanya; tier II/III-nya pindah jadi simpul riset.

### B. Blok logika: 9→26 kondisi, 12→25 aksi

Kategori baru: sensor (`ice-near`, `scanner-near`), posisi/jaringan (`core-within-hops`,
`core-hp-below`, `node-hp-below`, `blocked-ahead`, `visited-here-before`), status diri
(`cloak-ready`, `decoy-armed`, `slowed`, `jammed`, `alarm-active`), waktu (`tick-after`,
`every-n-ticks`), variabel & multi-entitas (`flag-is`, `is-clone`, `entity-count-below`). Aksi baru:
gerak (`move-toward-node-type`, `sprint`, `recall`), serang (`target-strike`, `emp-burst`,
`overclock`, `detonate`), siluman/bertahan (`spoof-signature`, `purge`, `siphon`), utilitas & bahasa
(`set-flag`, `set-checkpoint`, `worm-split`).

Dua mekanik bahasa baru: **variabel** (`set-flag`+`flag-is`, 4 flag boolean per entitas — jawaban
langsung terhadap Jammer, sheet jadi punya ingatan) dan **multi-entitas** (`worm-split` memecah
virus jadi 2–3 tubuh berbagi sheet, `detonate` sebagai aksi bunuh-diri berdampak besar).

Sengaja tidak ditambahkan: `Read Traffic` (menunggu mode multi-penyerang), grup OR/NOT bersarang
(ADR 0006 §1 sudah memilih dua-baris), variabel numerik/counter (tidak muat 390px tanpa merombak
chip — lihat HANDOFF §5 no.14).

### C. Riset: 0 → ±70 simpul, lokal-dulu

Baru di `packages/shared/src/research.ts` + `research-tree.ts` (bukan `packages/sim` — riset bukan
fisika battle). **Melonggarkan aturan boundaries `{ from: "shared", allow: [] }` menjadi
`allow: ["sim"]`** di `eslint.config.js` — kunci unlock adalah `ConditionKind`/`ActionKind`/
`DefenseNodeType` milik sim, mengetik ulang menciptakan katalog-cermin yang `sheetCatalog.ts`
sengaja hindari.

5 cabang (Inti/Serbuan/Bayangan/Pengintaian/Replikasi), kedalaman 0–4, tier-up I→III sebagai simpul
tersendiri, satu capstone depth-4 per cabang yang butuh depth-3 cabang sendiri + depth-2 cabang lain
(mewujudkan "stealth-first vs brute-first", GDD §9). **Tidak ada simpul yatim** — tiap `ConditionKind`,
`ActionKind`, dan pasangan (node, tier) wajib muncul tepat sekali di seluruh pohon, termasuk yang
sudah ada sekarang.

Mata uang `Data` dari sumber 100% lokal (tutorial, verdict gauntlet Defend, misi harian, passive tap
harian, simulasi kering) lewat `state/localPersist.ts` (pola sama dengan `virusLabStore`/
`defendStore`). **Jujur soal anti-tamper**: PLAN.md M5.1 mensyaratkan state riset di server —
di fase ini tidak ada server, jadi `ResearchState` bisa diedit siapa pun yang mau. Yang membuatnya
tidak sia-sia: bentuk data (`ResearchState`) sudah persis payload yang dikirim ke server nanti,
`unlockedSet()` fungsi murni yang jalan di kedua sisi, dan `packages/sim` tetap tidak tahu apa-apa
soal unlock (validasi unlock ada di klien, terpisah dari `validateVirusProgram`/`validateDefenseGraph`).
**M5.1 tidak boleh dicentang oleh fase ini.**

## Prasyarat arsitektur (harus lebih dulu dari semua konten)

### A. Memisah tabel node v2 dari v1 yang beku

`DefenseNodeType` **tidak dipecah** jadi dua union (ia dipakai `BattleInputV1` dan `BattleInputV2`
lewat `DefenseGraph`) — dijadikan superset dengan subset v1 sebagai konstanta runtime:

```ts
export const DEFENSE_NODE_TYPES_V1 = ["router","firewall","ice-sentry","honeypot","scanner","trap","core","entry"] as const;
export type DefenseNodeTypeV1 = (typeof DEFENSE_NODE_TYPES_V1)[number];
export const DEFENSE_NODE_TYPES_V2 = [...DEFENSE_NODE_TYPES_V1, "patch-server","tarpit","jammer","turnstile","alarm"] as const;
export type DefenseNodeType = (typeof DEFENSE_NODE_TYPES_V2)[number];
```

"v1 menolak tipe baru" jadi aturan **validasi runtime** (graf bisa datang dari `localStorage`/server
sebagai JSON tanpa tipe), bukan aturan compiler. Tabel & modul perilaku node v2 hidup di
`ruleset-v2.ts` (getter bersufiks `V2` — barrel `index.ts` datar, nama bentrok = ambiguous re-export)
dan `nodes-v2/` (1:1 dengan `DEFENSE_NODE_TYPES_V2`, tidak me-re-export fungsi v1 meski perilakunya
sama, supaya v2 tidak diam-diam tersambung ke tabel beku). `validateDefenseGraph` jadi sadar-versi
lewat `topologyRulesFor(ruleset)`; sekalian memperbaiki bug laten `getDefenseNodeCost` yang
**melempar** (bukan melapor) untuk tipe tak dikenal.

### B. Virus multi-entitas (`worm-split`)

`state` tunggal → `entities: VirusEntity[]`, id numerik stabil menaik, tidak pernah di-splice saat
mati. Pembagian state: **global** = apa pun milik peta (HP node, trap/honeypot terpakai, cooldown
tembak ICE — cooldown milik sentry, bukan sasaran); **per entitas** = apa pun milik tubuh (posisi,
integrity, flag, status, `firedOnceKeys`, decoy).

Urutan tick baru (RULESET §11a): sensor+sheet → status → efek node → **tembakan ICE (sentry di loop
luar urut node id, satu draw per sentry yang menembak, target = entitas hidup ber-id terkecil dalam
radius)** → aura → utility → gerak (draw `move-random` di sini) → split diselesaikan → respawn →
`rule-fired`. Sentry-di-loop-luar dipilih karena cooldown adalah state sentry: entitas-di-luar
membuat nasib entitas 0 bergantung pada apakah entitas 1 kebetulan ada.

Menang: attacker menang begitu **ada** entitas menolkan Core; defender menang saat **semua** entitas
mati. Skor pakai **maksimum** integrity antar entitas hidup (bukan jumlah — `computeScore` menerima
rentang 0–1000 permille, menjumlah memecah rentang itu).

**Byte-identity untuk log yang ada**: `BattleEvent` mendapat `entityId?: number`, dikontrol gerbang
**statis dari sheet** — `sheetCanSplit(program)` diputuskan sebelum tick 0. Sheet tanpa aksi split
tidak pernah membawa `entityId` di event mana pun (persis himpunan sheet yang ada hari ini); sheet
dengan aksi split membawanya di **setiap** event sejak tick 0. Field opsional wajib ditulis lewat
idiom spread bersyarat (`...(x !== undefined ? {x} : {})`) — `entityId: undefined` bukan byte yang
sama dengan kunci absen, karena `stableStringify` di `determinism.test.ts` memakai `Object.keys`.

Split mewariskan **salinan** `firedOnceKeys` induk (bukan kosong — kalau kosong, split jadi tombol
reset one-shot gratis) dan `decoy.activationsUsed` (bukan `absorbsRemaining` — decoy melindungi
tubuh tempat ia dipasang).

### C. Checkpoint (respawn) vs latch `died`

RULESET §13 mengunci kematian di integrity 0 supaya Self Repair (yang di v2 tidak lagi punya gerbang
"tidak kena damage tick ini") tidak membangkitkan mayat. Respawn harus bisa dibedakan dari persis
itu secara **struktural**: respawn adalah transisi daur hidup di fase baru (setelah gerak, sebelum
finalize) yang **mengonsumsi** `died === true` sebagai pemicunya — terbitkan `virus-died`, lalu ganti
posisi/integrity/id state ke checkpoint, `respawnsUsed += 1`. Gerbang Self Repair di fase utility
(`healAmount > 0 && !state.died`) tidak disentuh. Invariant yang ditulis di kode & RULESET §13:
*integrity hanya naik dari 0 ke >0 lewat event log `virus-respawned` eksplisit; tidak ada jalur kode
yang diam-diam membatalkan nol.*

## Consequences

- `packages/sim/src/ruleset.ts` dan `packages/sim/src/nodes/` **tidak boleh tersentuh** sepanjang
  Fase 8 — dibuktikan `git diff --stat` kosong di kedua path itu pada tiap commit.
- Lima hash di `determinism.test.ts` dan tiga snapshot v1 di `test/__snapshots__/engine.test.ts.snap`
  adalah gerbang keras: bergerak di luar dua langkah yang memang mengubah angka (perbaikan ICE Nest,
  penambahan kondisi/aksi) berarti refactor-nya salah, bukan konstantanya yang perlu diperbarui.
- `packages/replay` (`compile.ts`, `camera.ts`, `draw.ts`) dan `apps/client` (`attackPlayback.ts`,
  `Defend.tsx`) harus menerima N track virus, bukan satu — blast radius terbesar di luar
  `packages/sim`, dan tetap kompatibel-mundur lewat konvensi id track `"virus"` untuk entitas 0.
- `tools/balance-lab` bertumbuh dimensi baru (pita kedalaman riset), dan `known-dominance.ts` wajib
  kosong di akhir fase — ini syarat rilis v2 yang sudah tercatat sejak V7.4, dituntaskan di sini.
- Detail lengkap (tabel angka penuh, langkah eksekusi per sub-bagian, acceptance criteria) ada di
  checklist Fase 8 `PLAN.md` dan akan dipecah lebih jauh menjadi ADR 0008 (multi-entitas & checkpoint)
  dan ADR 0009 (riset & ekonomi lokal) saat implementasi masing-masing bagian dimulai.
