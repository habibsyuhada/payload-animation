# ADR 0009 — Riset & ekonomi `Data`: lokal-dulu, siap-server

**Status:** proposed — desain final (diturunkan dari ADR 0007 §C), implementasi PLAN.md 8.6–8.8.
**Context:** `packages/shared/`, `packages/sim/src/types.ts`, `apps/client/src/{state,screens}/`,
`eslint.config.js`, `docs/GDD.md` §9, `docs/RULESET.md`, `docs/ADR/0007` §C, PLAN.md M5.1.

## Problem

Riset (GDD §9's "naik divisi liga, unlock blok logika baru") tidak ada sama sekali sebelum
PLAN.md 8.6: `screens/Research.tsx` adalah placeholder 13 baris yang mengakui sendiri "sekarang
semua isi katalog terbuka sejak awal". Dua pertanyaan harus dijawab sebelum satu baris kode
implementasi ditulis:

1. **Di mana pohon riset dan ekonomi `Data` hidup secara arsitektural?** Kandidat jelas adalah
   `packages/sim` (di sebelah `ruleset-v2.ts`) atau `packages/shared` (di sebelah tipe DTO lain).
2. **PLAN.md M5.1 mensyaratkan state riset divalidasi di server** (anti-tamper) — tapi belum ada
   server di fase ini (Fase 4 di PLAN.md, belum dikerjakan). Membangun riset seolah-olah server ada
   akan menghasilkan abstraksi yang salah tebak; membangunnya murni lokal tanpa mempersiapkan jalan
   ke server berarti menulis ulang semuanya nanti.

## Decision

### A. `packages/shared`, bukan `packages/sim` — dan boundaries dilonggarkan satu arah

Riset **bukan fisika battle**: ia tidak pernah dibaca `engine-v2.ts`, tidak memengaruhi hasil satu
battle pun, dan `packages/sim` harus tetap murni supaya (a) server nanti bisa memvalidasi sebuah
`BattleLog` tanpa tahu apa pun soal progres pemain yang menghasilkannya, dan (b)
`tools/balance-lab` bisa terus mengabaikan riset sepenuhnya saat mengukur keseimbangan mentah
antar-arketipe. `packages/shared/src/research.ts` (tipe) + `research-tree.ts` (data) adalah isi
sungguhan pertama paket itu — sebelumnya cuma stub satu baris.

Konsekuensi teknis: kunci unlock **adalah** `ConditionKind`/`ActionKind`/`DefenseNodeType` milik
`packages/sim`. Mengetik ulang tipe-tipe itu di `shared` akan menciptakan persis katalog-cermin
yang `sheetCatalog.ts` sengaja hindari (komentar di file itu sendiri). Karena itu aturan
`eslint.config.js` `{ from: "shared", allow: [] }` dilonggarkan jadi `{ from: "shared", allow:
["sim"] }` — searah dengan `replay → sim` yang sudah ada, dan **hanya** searah itu: `sim` tetap
tidak boleh mengimpor `shared`, supaya sim tetap tidak tahu apa-apa soal riset.

### B. Bentuk data: `ResearchState` sudah berbentuk payload server, meski belum ada server

```ts
export interface ResearchState {
  readonly version: 1;
  readonly data: number;                              // saldo mata uang
  readonly completed: readonly string[];               // id ResearchNode, stabil
  readonly claimed: Readonly<Record<string, number>>;  // sumber Data yang sudah diambil
}
```

`completed` adalah daftar **id**, bukan daftar unlock — unlock diturunkan dengan fungsi murni
`unlockedSet(completed, tree)` yang bisa dijalankan identik di klien maupun (nanti) di server.
Konsekuensinya bagus dua arah: mengubah isi sebuah simpul riset di patch berikutnya otomatis
berlaku ke pemain lama tanpa migrasi data, dan validasi sisi-server nanti butuh mengimpor fungsi
yang sama persis, bukan menulis ulang logikanya.

### C. Lokal sekarang, jujur soal harganya

`ResearchState` disimpan `state/localPersist.ts` (pola sama `virusLabStore`/`defendStore`) —
**bisa diedit siapa pun yang mau membuka devtools.** PLAN.md M5.1 ("state riset divalidasi
server") secara eksplisit **tidak** dicentang oleh fase ini, dan tidak boleh dicentang oleh
PLAN.md 8.6–8.8: pilihan ini menunda anti-tamper, bukan menyelesaikannya secara diam-diam dengan
nama lain.

Yang membuat penundaan itu bukan utang buta: `unlockedSet()` fungsi murni yang sudah bisa
dijalankan di kedua sisi (keputusan B), `ResearchState` sudah berbentuk payload yang tinggal
dikirim, dan `validateAgainstUnlocks(program, state)` — guard klien yang menolak sheet berisi
kind/tier yang belum di-unlock — hidup terpisah dari `validateVirusProgram()` (`packages/sim`),
persis supaya server nanti bisa memanggil validasi unlock **di atas** validasi sim tanpa mengubah
satu baris pun `packages/sim`.

### D. Struktur pohon & migrasi sekali-jalan

5 cabang (Inti/Serbuan/Bayangan/Pengintaian/Replikasi), kedalaman 0–4, tier-up I→III sebagai
simpul tersendiri (memenuhi GDD §9 "tier-up blok pakai Data" langsung, tanpa mekanik terpisah).
**Tidak ada simpul yatim**: setiap `ConditionKind`, `ActionKind`, dan pasangan (`DefenseNodeType`,
tier) yang bisa dipasang wajib muncul tepat sekali di `unlocks` seluruh pohon — versi riset dari
`CATALOG_COVERS_EVERY_KIND` (`sheetCatalog.ts`), diuji dengan pola yang sama.

Pemain yang sudah bermain sebelum riset ada punya sheet/layout tersimpan yang, begitu penguncian
aktif, akan berisi kind yang "belum di-unlock" menurut state riset kosong. Migrasi sekali-jalan
wajib jalan sebelum guard C aktif: beri `completed` semua simpul yang diperlukan sheet/layout yang
sudah ada di perangkat, plus starter set Inti — tanpa ini pemain lama membuka app dan menemukan
virusnya sendiri "ilegal".

## Consequences

- `eslint.config.js`: `{ from: "shared", allow: ["sim"] }` — satu-satunya perubahan aturan
  boundaries di seluruh Fase 8.
- `packages/sim` tidak bertambah satu impor pun dari `packages/shared`; test kelengkapan katalog
  sim (`ruleset-v2.test.ts`) tidak perlu tahu riset ada.
- `tools/balance-lab` (PLAN.md 8.8) menambah dimensi **pita kedalaman riset** (`depth ≤ D`) di atas
  pengukuran dominasi yang sudah ada, tapi tetap tidak mengimpor `packages/shared` — pita itu
  murni memfilter arketipe sheet/generator yang sudah ada, bukan membaca `ResearchState`.
- PLAN.md M5.1 tetap terbuka setelah PLAN.md 8.6–8.8 selesai; anti-tamper riset adalah pekerjaan
  Fase 4 (server), dan ADR ini adalah alasan tertulis kenapa tidak dikerjakan lebih awal dari itu.
