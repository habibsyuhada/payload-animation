# HANDOFF — Fase 7 selesai (ruleset v2), lanjut ke keseimbangan & persistensi

> Catatan serah-terima antar sesi. Ditulis 2026-08-20, branch `claude/handoff-docs-uxp4hn`.
> Menggantikan handoff sebelumnya (yang isinya "kerjakan Fase 7" — sudah dikerjakan).
> Dokumen acuan utama tetap `PLAN.md`; ini cuma peta jalan untuk sesi berikutnya.

## 1. Posisi sekarang

**Fase 7 (ruleset v2 — virus sebagai event sheet) selesai, V7.1 sampai V7.5.** Keputusan desainnya
ada di `docs/ADR/0006`, yang sekarang berstatus **accepted** dan kedua pertanyaan terbukanya sudah
dijawab di dalam dokumen itu sendiri. Angkanya ada di `docs/RULESET.md` **§10–§13**.

Yang ada sekarang:

- **Dua engine berdampingan** di `packages/sim`. `simulate()` memilih dari `rulesetVersion` di
  input. v1 (`engine.ts`) **dibekukan** — golden log & hash lintas-platformnya tidak berubah satu
  byte pun, dan itu diuji (`test/determinism.test.ts`, sekarang plus satu skenario v2).
- **Engine v2** (`engine-v2.ts`): pohon aturan dievaluasi depth-first tiap tick, aksi slot diambil
  penulis pertama, aksi kumulatif menumpuk, `once` per baris, event log baru `rule-fired`.
  Urutan ticknya ada di docstring file itu dan di RULESET §11.
- **Virus Lab ditulis ulang** jadi editor event sheet tap-driven (`screens/VirusLab.tsx` +
  `state/virusLabStore.ts` + `data/sheetCatalog.ts`). Tidak ada drag sama sekali; picker `+ kondisi`
  / `+ aksi` meniru modal "Pilih Node" halaman Defend; nesting maksimum 3 level, tombol anaknya
  di-disable di level terdalam. Sudah dicek manual di viewport 390×844.
- **Defense Grid dihapus**, diganti halaman Defend: keduanya menggambar graf yang sama, dan Defend
  yang bisa **menguji** hasilnya.
- **Navigasi hub-and-spoke, tanpa bottom nav.** HQ adalah ruang utama berisi kartu; tiap layar lain
  dimasuki dari sana dan ditinggalkan lewat "← HQ" di app bar. **App bar itu sekaligus heading
  halaman** — `Screen` sengaja tidak menggambar `<h1>` lagi. Layar **Liga** dan **Replay** dihapus
  (komponen `ReplayPlayer` tetap, masih dipakai Onboarding), jadi tersisa HQ, Lab, Defense, Scan,
  Riset.
- **Gauntlet Defend jalan di v2**, dan chip loadout berubah jadi **chip aturan yang menyala** saat
  aturannya menembak selama replay diputar (`ruleFirings` di `packages/replay/src/compile.ts` →
  `firedRuleIds` di `logic/attackPlayback.ts` → `data-firing` di Defend).
- **balance-lab** punya generator sheet acak berbenih + pencarian dominasi, plus job CI
  `balance-dominance`.

## 2. Yang berikutnya dikerjakan

Tidak ada fase yang "belum dimulai" di Fase 7 lagi. Tiga hal yang menunggu, urut prioritas:

### (a) "ICE Nest" — satu-satunya utang dominasi yang tersisa

Dua ICE Sentry II yang radiusnya menumpuk di satu chokepoint **menahan setiap sheet acak di ≤7.5%
winrate**. Ini persis temuan v1 di RULESET §9 yang sengaja tidak diputuskan waktu itu, dan sekarang
terukur otomatis (RULESET §13). Cloak berbasis tick — salah satu kandidat perbaikan yang ADR 0006
tawarkan — terbukti **tidak cukup sendirian**.

Tercatat di `tools/balance-lab/src/known-dominance.ts`. Job CI tidak gagal karenanya, tapi gagal
untuk temuan baru apa pun. **Mengosongkan file itu adalah syarat rilis v2 ke pemain** (PLAN.md
V7.4). Kandidat perbaikan yang belum dipilih, sama seperti di §9: batasi tumpang-tindih radius ICE,
turunkan akurasi dasar ICE tier II, atau batasi satu virus hanya bisa kena satu tembakan ICE per
tick. Yang ketiga paling mudah dijelaskan ke pemain ("satu virus, satu tembakan per tick") dan
paling langsung menyerang penyebabnya, tapi **belum dipilih** — dan perlu tabel node khusus v2
(sekarang `engine-v2.ts` masih membaca tabel node v1 di `nodes/`, yang dibekukan bersama v1).

### (b) Kalibrasi pita winrate

Sebagian besar dari 20 matchup arketipe masih di luar [25%, 75%] — sama seperti v1, dan sebagian
memang disengaja (arketipenya build ekstrem, bukan sampel pemain rata-rata). Profil v2 mendekati v1
setelah perbaikan kematian di §13, artinya event sheet tidak diam-diam menggeser keseimbangan.
`tools/balance-lab/REPORT.md` selalu terbaru; regenerasi dengan `node dist/cli.js > REPORT.md`
setelah `pnpm --filter @payload/balance-lab build`.

### (c) Offline-first — langkah 1 sudah jalan, sisanya belum

**Sudah:** sheet Virus Lab dan layout Defend tersimpan ke `localStorage`
(`state/localPersist.ts`), bertahan lewat refresh, dan HQ meringkas keduanya. Yang disimpan cuma
**input** yang ditulis pemain — bukan `BattleLog`, karena log bisa dihitung ulang persis dari
`(rulesetVersion, seed, virus, defense)`.

**Belum:**

- **PWA / service worker** — build web belum bisa dibuka tanpa jaringan. Tidak ada satu pun
  panggilan jaringan di klien (sim & replay jalan di browser), jadi ini murni soal caching app
  shell: `vite-plugin-pwa` + manifest sudah cukup.
- **Lawan offline** — `tools/seed-defenses` masih satu baris. 200 pertahanan AI yang di-bundle
  sebagai data statis akan menutup gameplay loop tanpa server sama sekali (lihat layar Scan).
- **Riwayat battle** — layar Replay dihapus karena belum ada battle tersimpan untuk dibuka; kalau riwayat sudah ada, layarnya dibangun ulang (mesinnya sudah lengkap di `packages/replay` + `components/ReplayPlayer`).
- **Sinkronisasi opsional** — kalau server datang nanti, klien tidak perlu berubah: kirim
  `(seed, virus, defense)`, server verifikasi hash lognya (PLAN.md B4.2 sudah menyebut ini).

Utang halaman Defend lain yang masih berlaku:

- Belum ada konversi resmi `DefenseGraph` untuk server.
- Graf yang dihasilkan belum lolos `validateDefenseGraph` (halaman ini punya 1 Entry, ruleset minta
  2). Sengaja: sandbox, catatan strukturnya info, bukan penghalang.
- Node pertahanan gampang jadi hiasan: selama Entry masih dalam jangkauan Core, virus lewat "jalan
  tol". Ide yang sudah ditawarkan tapi **belum dipilih**: (a) tandai node yang tak pernah dilewati,
  (b) gambar rute yang diambil virus, (c) larang Entry↔Core tersambung langsung. Catatan: sekarang
  chip aturan yang menyala sudah menjawab sebagian "kenapa penyerang ini lolos", tapi bukan
  "node mana yang tidak berguna".

## 3. Peta file

```
packages/sim/src/
  types.ts           kontrak data; BattleInput = union v1|v2, tipe sheet v2 ada di sini
  simulate.ts        DISPATCHER — ini yang dipanggil semua orang
  engine.ts          engine v1, DIBEKUKAN (simulateV1). Jangan disentuh.
  engine-v2.ts       engine sheet v2 + urutan tick v2 di docstring-nya
  sheet.ts           bentuk sheet: walkSheet, harga (sheetWeightKb), validateVirusProgram
  ruleset-v2.ts      SEMUA angka v2 (bobot KB kondisi/aksi, cloak tick+cooldown, cap per tier)
  ruleset.ts         SEMUA angka v1, dibekukan
  score.ts           skor, dipakai kedua engine (RULESET §8 tidak berbeda antar versi)
  battle-common.ts   lookup graf yang dipakai kedua engine
packages/replay/src/
  compile.ts         BattleLog -> Timeline; sekarang plus ruleFirings + rulesFiringAt()
apps/client/src/
  App.tsx                shell hub-and-spoke; app bar = heading halaman
  screens/Home.tsx       HQ: hub — ringkasan virus & pertahanan tersimpan
  screens/NotBuiltYet.tsx kartu untuk 4 layar yang fiturnya belum ada
  state/localPersist.ts  satu-satunya tempat aplikasi ini menulis ke perangkat
  screens/VirusLab.tsx   editor event sheet tap-driven (V7.3)
  state/virusLabStore.ts pohon baris yang bisa diedit; toVirusProgram() melepas id editor
  data/sheetCatalog.ts   label/warna kondisi & aksi — TIDAK menyalin satu bobot pun dari sim
  screens/Defend.tsx     halaman Defend (peta + playback + chip aturan menyala)
  logic/defenseTest.ts   gauntlet v2
  data/gauntletViruses.ts 5 penyerang penguji sebagai sheet v2
tools/balance-lab/src/
  sheet-generator.ts generator sheet acak berbenih (+ 2 bias yang didokumentasikan)
  dominance.ts       pencarian kombo dominan dua arah
  known-dominance.ts utang yang sudah diketahui — CI gagal untuk apa pun di luar ini
docs/ADR/0006-*.md   keputusan event sheet (accepted, pertanyaan terbuka sudah dijawab)
docs/RULESET.md      §0–§9 v1 (beku), §10–§13 v2
```

## 4. Cara menjalankan

```bash
pnpm lint && pnpm typecheck && pnpm build          # semua hijau saat handoff ini ditulis

# semua test butuh Chromium; di sandbox ini path-nya harus disebut eksplisit
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test    # 386 test hijau

pnpm --filter @payload/balance-lab dominance       # cek dominasi (~1 menit), ini yang di CI
pnpm --filter @payload/balance-lab report          # laporan lengkap; exit 1 selama masih ada
                                                   # matchup di luar pita — itu memang backlog
pnpm dev --port 5199                               # /#/virus-lab dan /#/defend
```

Catatan: `pnpm test` **tanpa** `PLAYWRIGHT_CHROMIUM_PATH` gagal di sandbox ini karena bundle
browser di sini bukan headless-shell yang dicari Playwright. Murni masalah lingkungan sandbox — CI
memasang browsernya sendiri (`playwright install`) dan test ini lewat di sana.

Deploy: workflow `deploy-pages.yml` dijalankan manual (`workflow_dispatch`) dari branch ini.

## 5. Jebakan yang sudah ketemu (jangan diulang)

Nomor 1–10 dari handoff sebelumnya masih berlaku semua; yang di bawah ini tambahan dari Fase 7.

1. **Label marker bukan tempat menyimpan angka** — pakai field `amount` di `TimelineMarker`.
2. **`node-hit` sengaja terpisah dari `damage`** (yang selalu berarti virus yang kena). Jangan
   disatukan.
3. **Efek per-tick menumpuk** — `attackPlayback.ts` menyisakan satu efek terbaru per korban.
4. **Topbar Defend `pointer-events: none`**; tiap kontrol di dalamnya wajib `pointer-events: auto`.
5. **Gesture butuh pointer capture** di elemen viewport.
6. **Selector test harus di-scope pakai `data-testid`** — `data-node-id` polos bisa nyangkut.
7. **`setState` store lalu langsung tap = null.** Tunggu node-nya muncul dulu.
8. **Node di luar layar tidak punya action bar** (disengaja).
9. **Cloak v1 per-node** — sudah dipindah ke basis tick di v2 (§10.4).
10. **Jangkauan ICE Sentry itu hop, bukan jarak.**
11. **Menghapus gerbang tersembunyi membuka asumsi tersembunyi.** Self Repair v2 tidak lagi punya
    gerbang "tidak kena damage tick ini", dan itu membuat heal di langkah 5 bisa **menghidupkan
    kembali** virus yang Integrity-nya sudah 0 di langkah 4 — cek kematian baru jalan di langkah 7.
    Virus tanpa satu pun aksi serang jadi menggerogoti seluruh pertahanan sambil berkedip di 0 HP.
    Sekarang kematian dikunci begitu menyentuh 0 (`state.died`). **Ditemukan oleh pencarian
    dominasi, bukan oleh tangan** — itu argumen utuh untuk V7.4.
12. **Id instance editor tidak boleh masuk `SheetEvent.id`.** Id di store berbasis counter, jadi dua
    sesi yang membangun sheet identik akan menghasilkan byte `BattleLog` yang berbeda. `toVirusProgram()`
    membuangnya; engine memakai alamat baris (`"1.0"`), dan `rowIdByRulePath()` memetakannya balik.
13. **Bobot 40 KB per baris itu terasa.** Di tier 1 (2400 KB) beberapa arketipe harus turun satu
    tier hanya supaya muat. Kalau menulis sheet contoh baru, hitung dulu dengan `sheetWeightKb()` —
    test arketipe balance-lab memaksa deskripsi menyebut angka aslinya supaya tidak bisa melenceng.
14. **`payload-sheet-*` di layar 390px**: keyword, chip, dan tombol `+` **menumpuk vertikal**, tidak
    berbagi satu baris. Versi pertama membaginya jadi tiga kolom dan setiap label chip pecah
    di tengah kata ("Node saat / ini ="). Kalau menambah kontrol ke dalam chip, cek ulang di 390px.
15. **Counter id instance itu module-level, dan persistensi membangunkannya.** `nextNodeId` /
    `nextInstanceId` mulai dari angka tetap tiap page load. Memulihkan layout yang node-nya 3..9
    tanpa menaikkan counter membuat node berikutnya ber-id 3 lagi — dua node satu id. Bugnya cuma
    muncul **setelah reload**, jadi `onRehydrateStorage` di kedua store wajib memanggil
    `adoptRestoredIds`.
16. **Kamera Defend sengaja TIDAK disimpan.** Halaman itu mem-frame seluruh graf pada layout
    pertama; zoom/pan yang dipulihkan akan berkelahi dengan itu dan bisa membuka ke ruang kosong
    di sebelah layout yang barusan disimpan.
17. **App bar adalah `<h1>` halaman.** Sebelumnya `Screen` menggambar `<h1>{title}</h1>` tepat di
    bawah bar yang sudah menyebut judul yang sama — satu hal ditulis dua kali di bagian layar yang
    paling mahal. Kalau menambah layar baru, jangan tambahkan heading judul sendiri; cukup `title`.

## 6. Konteks angka yang sering dipakai

```
v2: bobot baris 40 KB   maks. baris tier 1 = 12   nesting maks 3   aksi/tick maks 32
    Cloak I = 30 tick aktif + 90 tick cooldown    Brute Force I = 40/tick
    Exploit I = 250 (hanya tick pertama di node)  Self Repair I = 5/tick (TANPA gerbang)
    move-toward-core 50 DU/tick, move-random 55, move-back 50, hold-position diam
bersama v1: BREACH_PASSIVE_DRAIN = 15/tick   Integrity awal = 1000   Core HP tier 1 = 1800
    ICE Sentry I: radius 1 hop, tiap 4 tick, damage 60, akurasi 85%
    EDGE_LENGTH_MIN/MAX_DU = 200 / 2000   Defense budget tier 1 = 20 pt   1 tick = 50 ms
```

Bukti kenapa model v1 diganti tetap berlaku sebagai catatan sejarah (peta Entry → Firewall → Core
yang sama): `[IF node=Firewall, Exploit, Brute Force]` selesai **53 tick**, sedangkan
`[IF node=Firewall, Brute Force, Exploit]` — isi identik, urutan tertukar — selesai **124 tick**.
Di v2 dua sheet dengan isi sama dan urutan berbeda tetap bisa berbeda hasilnya, tapi perbedaannya
sekarang **terbaca di layar**: urutan baris adalah prioritas slot, dan itu tertulis di atas editor.
