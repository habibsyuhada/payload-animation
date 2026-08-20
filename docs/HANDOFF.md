# HANDOFF — lanjut ke Virus Lab (event sheet, ruleset v2)

> Catatan serah-terima antar sesi. Ditulis 2026-08-20, branch
> `claude/defend-page-interactive-nodes-r6m39w`, commit terakhir `ef271ec`.
> Dokumen acuan utama tetap `PLAN.md`; ini cuma peta jalan untuk sesi berikutnya.

## 1. Posisi sekarang

**Halaman Defend (`/defend`) sudah dianggap cukup** dan hidup di
https://habibsyuhada.github.io/payload-animation/#/defend

Isinya, semua sudah dites dan ter-deploy:

- Editor peta layar penuh: kamera geser/cubit/wheel, node tap → 3 tombol (geser / hapus / detail),
  penanda arah untuk node di luar layar, tombol tambah node.
- Node otomatis tersambung kalau saling masuk jangkauan (`LINK_RANGE_DU = 260`), connector-nya
  menyala. Lingkaran jangkauan digambar untuk node yang dipilih.
- ICE Sentry punya lingkaran **jangkauan tembak** — dihitung BFS per-hop (aturan aslinya hop,
  bukan jarak), tiap node yang tercakup ditandai sendiri.
- Ekonomi pt: budget 20 pt dari ruleset tier 1; Entry/Core bisa ditambah pemain dan ikut memakan
  budget (harga halaman ini: Entry 1 pt, Core 3 pt); minimal tersisa 1 Entry + 1 Core.
- **Uji pertahanan**: 5 virus penguji × 24 seed = ±120 simulasi (~30 ms), vonis
  `impenetrable` / `breachable` / `too-easy`, plus rincian per penyerang lengkap dengan chip
  balok logikanya.
- **Simulasinya diputar di peta itu sendiri** (bukan modal): virus jalan, bar HP virus, bar HP
  Core, tracer tembakan ICE, angka damage melayang, play/pause/scrub/kecepatan.

Yang **belum** ada di halaman Defend (utang teknis yang disadari, bukan lupa):

- Tidak ada simpan/persistensi sama sekali — refresh = hilang. Belum ada konversi resmi ke
  `DefenseGraph` untuk server (yang ada cuma untuk keperluan uji).
- Graf yang dihasilkan **belum lolos `validateDefenseGraph`**: halaman ini punya 1 Entry sementara
  ruleset minta tepat 2. Sengaja: halaman ini sandbox; catatan strukturnya ditampilkan sebagai
  info, bukan penghalang.
- Node pertahanan gampang jadi hiasan: selama Entry masih dalam jangkauan Core, keduanya
  tersambung langsung dan virus lewat "jalan tol" tanpa menyentuh node lain. Ini alasan vonis
  sering `too-easy`. Ide yang sudah ditawarkan tapi **belum dipilih**: (a) tandai node yang tidak
  pernah dilewati, (b) gambar rute yang diambil virus, (c) larang Entry↔Core tersambung langsung.
- Virus ber-Cloak kelihatan seperti kebal tanpa penjelasan. Perbaikan yang benar bukan menebak di
  klien: `packages/sim` perlu mencatat status cloak ke log dulu (lihat §5).

## 2. Yang berikutnya dikerjakan

**Virus Lab + balok logika, lalu disambungkan ke Uji Pertahanan.**

Keputusan desainnya **sudah diambil dan tertulis** di `docs/ADR/0006-event-sheet-virus-programming.md`:
virus berhenti jadi rantai blok, berubah jadi **event sheet bersarang ala GDevelop** — kondisi
(AND) → aksi berurutan, dievaluasi tiap tick, mengatur semua perilaku termasuk gerakan.

Baca ADR 0006 dulu sebelum menulis kode apa pun. Isi ringkasnya:

| Hal | Keputusan |
|---|---|
| Bentuk | `VirusProgram { events: SheetEvent[] }`, tiap event punya `conditions`, `actions`, `children` |
| Evaluasi | tiap tick, depth-first, atas→bawah; anak hanya jalan kalau induknya lolos |
| Nesting | maksimal 3 level (batas keterbacaan layar portrait, GDD §3) |
| OR / NOT | OR = dua baris bersebelahan (tidak ada grup OR di v2); NOT = flag per kondisi |
| Rebutan aksi | aksi "slot" (niat gerak) → **yang paling atas menang** (beda dari GDevelop yang last-wins, alasannya di ADR); aksi kumulatif (damage/heal) menumpuk semua |
| Sekali-jalan | `once: "battle" \| "node" \| "arrival"` per event, menggantikan bookkeeping per-blok |
| Harga | KB per kondisi + per aksi + bobot kecil per baris; nesting gratis; ada batas jumlah event per tier |
| Versi | ruleset v2 baru; engine v1 **dibekukan** (log lama wajib tetap bisa diputar, DoD #3) |

Urutan kerja ada di `PLAN.md` **Fase 7**:

- **V7.1** — tipe + engine v2 di `packages/sim` (`simulate()` dispatch by `rulesetVersion`).
  **Mulai dari sini**; semua item lain bergantung padanya. Syarat lulus: golden log v1 tetap
  byte-identical.
- **V7.2** — katalog kondisi/aksi + bobot KB, ditulis ke `docs/RULESET.md` v2.
- **V7.3** — Virus Lab ditulis ulang jadi editor event sheet **tap-driven** (tap `+ kondisi` /
  `+ aksi` → picker, bukan drag bebas; contoh pola picker-nya ada di modal "Pilih Node" halaman
  Defend).
- **V7.4** — `tools/balance-lab` naik jadi generator sheet acak + pencarian kombo dominan di CI.
  Prasyarat rilis v2 ke pemain.
- **V7.5** — tulis ulang `gauntletViruses.ts` + arketipe balance-lab sebagai sheet v2, dan sorot
  `rule-fired` di replay (chip aturan menyala saat aturannya menembak). **Ini titik sambung ke Uji
  Pertahanan** yang diminta.

Dua pertanyaan yang sengaja dibiarkan terbuka di ADR dan perlu dijawab saat V7.1:

1. Niat gerak yang ditulis saat virus masih di perjalanan: diantre sampai tiba, atau dibuang?
   (saran ADR: diantre, ambil yang terakhir)
2. Kondisi soal node butuh dua nama yang tidak ambigu: **`node saat ini`** vs **`node di depan`**.

## 3. Peta file

```
packages/sim/src/
  engine.ts          tick loop; isBlockActive() = semantik gating v1 (ADR 0002, dibekukan)
  ruleset.ts         SEMUA angka v1 (damage, radius, biaya node, budget tier)
  blocks/            1 file per blok logika v1
  graph.ts           validateDefenseGraph, hopDistance, EDGE_LENGTH_MIN/MAX_DU
packages/replay/src/
  compile.ts         BattleLog -> Timeline; track virusIntegrity & coreHp; marker damage/node-hit
  draw.ts            renderer canvas (dipakai layar Replay/Onboarding, BUKAN halaman Defend)
apps/client/src/
  screens/Defend.tsx     halaman Defend (peta + playback + sheet hasil uji)
  screens/VirusLab.tsx   builder rantai v1 — INI yang ditulis ulang di V7.3
  logic/defenseTest.ts   gauntlet: toDefenseGraph + runDefenseTest + vonis
  logic/attackPlayback.ts memutar BattleLog di atas peta (Layout = koordinat dunia node)
  data/gauntletViruses.ts 5 virus penguji (mirror arketipe balance-lab; app tidak boleh impor tool)
  data/blockCatalog.ts   label/kategori/berat KB blok v1 — sumber chip loadout
tools/balance-lab/src/   runMatchup + arketipe + report (ambang winrate [25%, 75%])
docs/ADR/0006-*.md       keputusan event sheet  ← BACA DULU
```

## 4. Cara menjalankan

```bash
pnpm lint && pnpm typecheck && pnpm build          # semua hijau saat handoff ini ditulis

# test klien butuh Chromium; di sandbox ini path-nya harus disebut eksplisit
cd apps/client
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm vitest run       # 90 test hijau

pnpm dev --port 5199                               # lalu buka /#/defend
```

Catatan: `pnpm test` dari root **gagal di sandbox ini** karena turbo menjalankan test klien tanpa
`PLAYWRIGHT_CHROMIUM_PATH` dan bundle browser di sini bukan headless-shell yang dicari Playwright.
Ini murni masalah lingkungan sandbox — CI memasang browsernya sendiri (`playwright install`), dan
di CI test ini lewat.

Deploy: workflow `deploy-pages.yml` dijalankan manual (`workflow_dispatch`) dari branch ini —
`main` belum disentuh sama sekali.

## 5. Jebakan yang sudah ketemu (jangan diulang)

Semua ini ditemukan lewat pengujian nyata, bukan teori:

1. **Label marker bukan tempat menyimpan angka.** Label replay berbentuk `"<actor> deals <n> damage"`,
   token pertamanya **id node**. Sempat terpakai regex "angka pertama" → damage ICE Sentry tampil
   `-4` (id node) padahal 60. Sekarang ada field `amount` eksplisit di `TimelineMarker` — pakai itu.
2. **`node-damaged` dulu tidak pernah masuk timeline sama sekali**, jadi semua damage yang
   *dilakukan* virus tak terlihat. Sekarang jadi marker `node-hit`, sengaja dipisah dari `damage`
   (yang selalu berarti virus yang kena). Jangan disatukan.
3. **Efek per-tick menumpuk.** Core kena damage tiap tick (20 ms) sementara jendela efek 300 ms →
   6 angka bertumpuk. `attackPlayback.ts` sekarang menyisakan satu efek terbaru per korban.
4. **Topbar halaman Defend `pointer-events: none`** supaya drag kamera tembus; tiap kontrol di
   dalamnya wajib `pointer-events: auto` sendiri, kalau tidak tombolnya tidak bisa diklik.
5. **Gesture butuh pointer capture** di elemen viewport, kalau tidak drag panjang dipotong oleh
   drag/seleksi bawaan browser.
6. **Selector test harus di-scope pakai `data-testid`**: lingkaran jangkauan dan penanda off-screen
   ikut membawa `data-node-id`, jadi `[data-node-id="X"]` polos bisa nyangkut di elemen yang salah.
7. **`setState` store lalu langsung tap = null.** Render React asinkron; tunggu node-nya muncul dulu
   (`waitForNode` di `Defend.test.tsx`).
8. **Node di luar layar tidak punya action bar** (memang disengaja) — test yang mengklik tombol aksi
   harus menaruh node di dalam frame kamera awal.
9. **Cloak v1 dihitung per-node (3 node), bukan per-tick.** Di peta kecil (4 node) artinya virus
   kebal sepanjang perjalanan dan baru bisa ditembak setelah nangkring di Core — bikin ICE Sentry
   terlihat "cuma menembak di Core". Bukan bug; sudah tercatat di RULESET §9 dan ADR 0006 memindahnya
   ke basis tick di v2.
10. **Jangkauan ICE Sentry itu hop, bukan jarak.** Lingkaran murni geometris akan berbohong.

## 6. Konteks angka yang sering dipakai

```
BREACH_PASSIVE_DRAIN_V1 = 15/tick     Brute Force I = 40/tick     Exploit I = 250 sekali per node
ICE Sentry I: radius 1 hop, tiap 4 tick, damage 60, akurasi 85%
Cloak I = 3 node           Integrity virus awal = 1000        Core HP tier 1 = 1800
EDGE_LENGTH_MIN/MAX_DU = 200 / 2000   Defense budget tier 1 = 20 pt   1 tick = 50 ms
```

Bukti kenapa model v1 diganti (diukur di peta Entry → Firewall → Core yang sama):
`[IF node=Firewall, Exploit, Brute Force]` selesai **53 tick**, sedangkan
`[IF node=Firewall, Brute Force, Exploit]` — isi identik, urutan tertukar — selesai **124 tick**.
