# PAYLOAD — Ruleset v1 & v2

> §0–§9 adalah **ruleset v1** dan sudah **dibekukan**: setiap `BattleLog` bertanda `"v1"` wajib
> tetap bisa diputar byte-identical (DoD #3), jadi angka di bagian itu tidak boleh diedit lagi.
> **Ruleset v2 ada di §10–§12** — virus sebagai event sheet bersarang (`docs/ADR/0006`),
> diimplementasi di `packages/sim/src/ruleset-v2.ts` + `engine-v2.ts`.
>
> Source of truth untuk semua angka gameplay. `packages/sim` HANYA boleh mengubah angka lewat
> file ini + `packages/sim/src/rulesets/v1.json` (dibuat di S1.1) — tidak pernah hardcode di
> logic. Menurunkan §4–6 dari `docs/GDD.md`. Lihat DoD #3 di `PLAN.md`.
>
> **Status: draft v1, belum di-playtest.** Angka di dokumen ini adalah titik awal yang harus
> internally-consistent (lihat catatan feasibility di tiap bagian), tapi kalibrasi akhir
> (winrate antar-archetype) adalah tugas `tools/balance-lab` (S1.7) — lihat §8. Jangan anggap
> angka final sebelum S1.7 jalan dan tidak ada matchup >75% winrate.

---

## 0. Konvensi unit & determinisme

- **Tick:** 1 tick = 50 ms → 20 tick/detik. Batas battle keras = **1200 tick (60 detik in-game)**.
  Jika Core HP masih >0 di akhir tick 1200 → **Defender menang (timeout)**.
- **Distance Unit (DU):** panjang edge diukur dalam DU integer, rentang **200–2000 DU** per edge
  (ditegakkan validasi topologi, S1.2).
- **Speed:** DU per tick, integer. Waktu tempuh sebuah edge = `ceil(EdgeLength / EffectiveSpeed)` tick.
- **Permille (‰):** semua rasio/modifier (accuracy, damage reduction, dst.) ditulis per-mille
  (1000‰ = 100%), integer, sesuai keputusan teknis PLAN §0 (fixed-point, tanpa float).
- **Posisi internal (`packages/sim`):** posisi disimpan ×1000 (sub-DU) semata untuk interpolasi
  replay yang halus (`packages/replay`). Ini murni representasi geometris — **semua angka
  gameplay di dokumen ini (HP, damage, budget, DU) adalah nilai "de-scaled" yang langsung dipakai
  logic tick**; skala ×1000 posisi tidak pernah masuk ke rumus damage/HP.
- **RNG:** satu PRNG seeded per battle (`rng.ts`, mulberry32/xoshiro — S1.1). Urutan draw FIXED
  (bagian dari determinisme, wajib diikuti implementasi S1.3/S1.4):
  0. **Sebelum tick 0:** pemilihan Entry — draw tunggal `nextInt(entryNodeIds.length)` untuk
     menentukan node Entry mana yang dipakai virus (posisi Entry "ditentukan sistem" per GDD §5;
     ini bagaimana sistem itu diimplementasikan, bukan pilihan pemain). Lihat ADR 0001.
  1. Movement block yang butuh RNG (`Random Walk`) — hanya jika virus berada di persimpangan
     dan harus memilih edge tick ini.
  2. `ICE Sentry` accuracy roll, diurutkan menaik berdasarkan `node id`, untuk setiap ICE Sentry
     yang punya target valid tick ini.
  Urutan ini menjamin hash `BattleLog` stabil lintas platform (S1.6).

---

## 1. Payload budget & Defense budget (per account tier)

Menurunkan GDD §9 ("payload budget & defense budget naik perlahan, plafon kecil"). v1 pakai 5
tier akun.

| Account Tier | Payload Budget (KB) | Defense Budget (pts) |
|---|---|---|
| 1 (start) | 2400 | 20 |
| 2 | 2700 | 24 |
| 3 | 3000 | 28 |
| 4 | 3300 | 32 |
| 5 (cap v1) | 3600 | 36 |

Feasibility check: virus khas v1 (1 Movement + 4–6 blok logika) berbobot ±2500–3500 KB — budget
memang ketat by design (Design Pillar "virus pintar = berat = lambat"), bukan angka dekoratif.

---

## 2. Virus — atribut dasar

| Stat | Nilai |
|---|---|
| Integrity (max HP) | 1000 |
| Speed dasar (tanpa blok Movement) | 0 — **virus WAJIB punya tepat 1 blok Movement**, ditegakkan validasi (S1.2), bukan disimulasikan sebagai "diam". |

Speed ditentukan oleh blok Movement yang dipakai (§3), bisa dimodifikasi blok Stealth (§4, `Slow
Crawl`). Loadout: maksimal **5 desain virus** disimpan per akun (GDD §4.3).

---

## 3. Blok — Movement (mesin tick, S1.3; TIDAK dihitung dalam kuota 12 blok v1 di §4)

Wajib pilih tepat satu. Tidak bertier (fungsi sederhana, sengaja tanpa progression tier di v1).

| Blok | Weight (KB) | Speed (DU/tick) | Perilaku |
|---|---|---|---|
| Shortest Path | 800 | 50 | Dijkstra deterministik ke Core, dibobot **total jarak DU** (bukan jumlah hop) — selaras dengan §5.2 "jarak adalah sumber daya desain": edge panjang tetap bisa jadi rute tercepat kalau hop count-nya lebih sedikit dari alternatif pendek-tapi-berliku, dan sebaliknya. Tidak pakai RNG. |
| Random Walk (seeded) | 500 | 55 | Pilih edge acak (PRNG per-battle) di antara edge valid dari node saat ini; tidak revisit edge yang sudah dilalui dari node yang sama kecuali buntu (semua edge keluar sudah dicoba). |
| Backtrack | 600 | 50 | Seperti Shortest Path (Dijkstra berbobot DU yang sama), tapi jika node tujuan berikutnya adalah Trap/Honeypot yang sudah terdeteksi Sensor, mundur ke node sebelumnya dan ambil jalur terpendek alternatif yang menghindari node tsb. |

`Avoid Scanned` (GDD §4.2) **ditunda ke v2** — di luar kuota S1.3.

---

## 4. Blok — pool logika v1 (12 blok, S1.5)

Weight = biaya payload dalam KB. Pola scaling tier: efek numerik ×1 / ×1.5 / ×2 (dibulatkan),
weight naik ~+20%/tier (dibulatkan ke atas kelipatan 10 KB) — "kode lebih pintar = lebih berat".

Blok yang **ditunda ke v2** (di luar 12 blok v1, tetap tercatat di GDD §4.2 untuk referensi masa
depan): Sensor `Read Traffic`, Attack `Worm Split`, Stealth `Spoof Signature`, Utility
`Checkpoint`.

### 4.1 Sensor (2 blok)

| Blok | Tier | Weight (KB) | Efek |
|---|---|---|---|
| Scan Ahead | I | 400 | Mengungkap tipe node 1 node di depan (tujuan langsung dari edge yang akan dilalui), hasil tersedia sbg flag untuk blok Condition. |
| | II | 500 | Radius 2 node di depan sepanjang jalur yang akan dilalui movement block. |
| | III | 600 | Radius 2 node + mengungkap keberadaan Trap tersembunyi di jalur tsb. |
| Detect Honeypot | I | 350 | Honeypot dalam radius 1 node (graph-hop) terdeteksi otomatis & pasif (tak perlu Scan Ahead). |
| | II | 450 | Radius 2 node. |
| | III | 550 | Radius 2 node + tetap mendeteksi Honeypot meski disamarkan sbg Core (efek Honeypot Tier II, §5). |

### 4.2 Condition (3 blok)

Condition memicu blok tepat setelahnya dalam chain saat kondisi bernilai true pada tick evaluasi.

| Blok | Tier | Weight (KB) | Efek |
|---|---|---|---|
| IF Integrity < X% | I | 150 | Threshold tetap 50%. |
| | II | 180 | Threshold dapat diset pemain 25–75% (kelipatan 5). |
| | III | 220 | Threshold 10–90% + trigger sekunder tambahan di 15% (memicu blok berikutnya sekali lagi). |
| IF Node = Firewall | I | 120 | True jika node tujuan langsung adalah Firewall. |
| | II | 150 | Juga true untuk node 2 langkah di depan (butuh Sensor aktif; tanpa Sensor tetap evaluasi node langsung saja). |
| | III | 180 | Bisa target Firewall ATAU ICE Sentry sekaligus. |
| IF Scanned | I | 130 | True jika virus sedang berstatus "scanned" (dari Scanner, §5). |
| | II | 160 | Juga true 2 tick sebelum status scanned berakhir (re-trigger dini). |
| | III | 200 | Juga true jika sedang jadi target-lock ICE Sentry manapun (bukan hanya status scanned). |

### 4.3 Attack (3 blok)

Attack blok hanya berlaku pada **Breach Node** (Firewall, Core — lihat taksonomi §5.0). Damage
per-tick berlaku selama virus occupy node tsb; damage one-shot berlaku sekali saat virus pertama
kali masuk node tsb.

| Blok | Tier | Weight (KB) | Efek |
|---|---|---|---|
| Brute Force | I | 700 | +40 damage/tick ke Breach Node yang sedang di-occupy. |
| | II | 900 | +60/tick. |
| | III | 1100 | +85/tick. |
| Exploit | I | 650 | Damage one-shot 250 saat virus pertama kali masuk Breach Node (sekali per node). |
| | II | 800 | 380. |
| | III | 950 | 520. |
| Overload | I | 750 | Saat sebuah Breach Node hancur (HP=0), splash damage 150 ke node bertetangga langsung (radius 1 hop) yang juga Breach Node. |
| | II | 950 | Splash 230, radius tetap 1. |
| | III | 1150 | Splash 320, radius 2 hop. |

### 4.4 Stealth (2 blok)

Aktif otomatis sepanjang battle sejak kondisi terpenuhi (non-toggle, tidak butuh Condition).

| Blok | Tier | Weight (KB) | Efek |
|---|---|---|---|
| Cloak | I | 500 | 3 node pertama yang dilalui sejak awal battle: virus tidak bisa kena status "scanned" & bukan target valid ICE Sentry (Honeypot & Trap tetap trigger normal — keduanya tidak "menyerang", jadi tidak dianggap threat yang di-dodge Cloak). |
| | II | 650 | Durasi 4 node. |
| | III | 800 | Durasi 5 node + radius deteksi Scanner terhadap virus ini −500‰ (50%) selama Cloak aktif. |
| Slow Crawl | I | 300 | Speed virus ×700‰ (−30%), ICE Sentry accuracy terhadap virus ini −300‰ (−30%). Aktif sepanjang battle. |
| | II | 380 | Speed ×750‰, accuracy −400‰. |
| | III | 460 | Speed ×800‰, accuracy −500‰. |

### 4.5 Utility (2 blok)

| Blok | Tier | Weight (KB) | Efek |
|---|---|---|---|
| Self Repair | I | 450 | +5 Integrity/tick selama virus TIDAK sedang occupy Breach Node atau kena efek node lain tick itu (repair batal pada tick yang sama dengan damage masuk). |
| | II | 550 | +8/tick. |
| | III | 650 | +12/tick. |
| Sacrifice Decoy | I | 400 | 1x per battle: saat Integrity pertama kali turun ≤200 (20%), decoy menyerap 1 trigger berikutnya (tembakan ICE Sentry, atau efek Honeypot/Trap) — virus asli invulnerable terhadap trigger spesifik itu, lalu decoy habis. |
| | II | 500 | 2x per battle (re-arm setiap Integrity turun 20% lagi dari titik trigger sebelumnya). |
| | III | 600 | 3x per battle, tiap aktivasi menyerap 2 trigger sekaligus. |

---

## 5. Defense — node pertahanan (7 tipe, S1.4)

### 5.0 Taksonomi mekanik (dasar implementasi `packages/sim/src/nodes/`)

Tiap node masuk salah satu dari 5 kelas perilaku — ini yang menentukan file/kelas di S1.4:

1. **Breach** (memblokir jalur sampai HP=0): `Firewall`, `Core`. Virus occupy node ini tiap tick
   sampai HP node = 0. Semua Breach Node kena **passive drain 15 HP/tick** dari sekadar occupancy
   (menjamin virus tanpa blok Attack tetap bisa menang lawan Firewall Tier I, hanya lambat —
   dinaikkan dari 10 ke 15 setelah S1.7 balance-lab; lihat §9), ditambah kontribusi blok Attack
   aktif (§4.3). Hanya `Firewall` yang membalas damage ke virus tiap tick (`Core` tidak).
2. **Shoot** (ranged, tidak memblokir jalur): `ICE Sentry`. Menembak virus mana pun dalam radius
   R (graph-hop dari node ICE Sentry) setiap N tick.
3. **Trigger** (one-shot saat node pertama dimasuki, lalu inert): `Honeypot`, `Trap Node`.
4. **Aura pasif** (tidak memblokir, memberi status): `Scanner`.
5. **Struktural** (tanpa efek combat): `Router`.

### 5.1 Tabel node

| Node | Kelas | Tier | Cost (pts) | HP | Efek |
|---|---|---|---|---|---|
| Router | Struktural | — | 1 | — (tak bisa dihancurkan) | Penghubung pasif, tanpa efek combat. |
| Firewall | Breach | I | 3 | 500 | Balas 20 damage/tick ke virus yang occupy. |
| | | II | 5 | 800 | Balas 30/tick. |
| | | III | 8 | 1200 | Balas 45/tick. |
| ICE Sentry | Shoot | I | 4 | 200 | Radius 1 hop, tembak tiap 4 tick, damage 60, base accuracy 850‰. |
| | | II | 6 | 300 | Radius 1, tiap 3 tick, damage 85, accuracy 880‰. |
| | | III | 9 | 450 | Radius 2, tiap 3 tick, damage 115, accuracy 900‰. |
| Honeypot | Trigger | I | 3 | — (bukan target Attack) | Virus yang masuk tanpa Detect Honeypot aktif: Integrity → 0 di tick berikutnya, kecuali diserap Sacrifice Decoy. |
| | | II | 5 | — | Sama + menyamar sebagai Core di hasil Sensor/Scan Ahead (butuh Detect Honeypot Tier II+ untuk tembus penyamaran). |
| | | III | 8 | — | Sama + virus yang sempat men-scan node ini sebelum masuk mendapat status "scanned" permanen. |
| Scanner | Aura | I | 2 | 250 | Radius 1 hop: status "scanned" 6 tick pada virus yang lewat — ICE accuracy terhadap virus tsb +150‰, efek Stealth (§4.4) dikurangi 300‰ selama status aktif. |
| | | II | 3 | 350 | Radius 2, durasi 8 tick, ICE accuracy +200‰. |
| | | III | 5 | 450 | Radius 2, durasi 10 tick, ICE accuracy +250‰, bonus speed `Slow Crawl` dinolkan selama status aktif. |
| Trap Node | Trigger | I | 2 | — | Meledak sekali saat node pertama dimasuki: damage 180, lalu node berubah jadi Router kosong untuk sisa battle. |
| | | II | 3 | — | Damage 260. |
| | | III | 5 | — | Damage 350 + splash 100 ke node tetangga langsung (tidak berefek di battle 1v1 v1, disiapkan untuk mode masa depan). |
| Core | Breach | — (HP dari Account Tier, lihat §5.2) | 0 (selalu ada, tidak dibeli dari budget) | lihat §5.2 | Objective. Battle dimenangkan Attacker saat Core HP = 0. Tidak membalas damage. |

Baris `Scanner` HP dan `ICE Sentry` HP membuat kedua node ini destructible via Attack blok
(karena keduanya diklasifikasikan bisa jadi target — **catatan v1**: sesuai §4.3, Attack blok
default v1 hanya target Breach Node; targeting Scanner/ICE Sentry oleh Attack blok eksplisit
**tidak** diimplementasikan di v1 meski kolom HP-nya tercantum untuk future-proofing (v2). ICE
Sentry v1 hanya bisa netral secara tidak langsung lewat rute yang menghindari radiusnya.

### 5.2 Core HP (berdasarkan Account Tier, bukan poin yang dibeli)

| Account Tier | Core HP |
|---|---|
| 1 | 1800 |
| 2 | 2000 |
| 3 | 2200 |
| 4 | 2400 |
| 5 | 2600 |

Feasibility check: virus dengan 1 blok Attack ringan (mis. Brute Force I, 40/tick) + passive
drain (10/tick) = 50/tick → menembus Core Tier 1 (1800 HP) dalam 36 tick (1.8 detik) begitu tiba
di sana. Ini disengaja: mayoritas tantangan battle ada di **menembus jaringan** (Firewall/ICE/
Trap/Honeypot di sepanjang jalur), bukan di siege Core — selaras dengan Design Pillar "setiap
battle layak ditonton" (drama terjadi di breach point, bukan di ujung).

---

## 6. Topologi & validasi (S1.2)

- **Entry:** tepat **2** node Entry per defense (posisi ditentukan sistem, bukan pemain — GDD
  §5). Skala jumlah Entry ditunda ke v2.
- **Core:** tepat 1.
- **Edge length:** integer 200–2000 DU (§0).
- **Path validity:** setiap Entry harus punya jalur (BFS/DFS reachability) ke Core melalui edge
  manapun — ditegakkan saat **save** di Defense Grid (C3.3) dan **re-check** saat battle mulai di
  server (B4.2), sebagai lapis anti-cheat/anti-corrupt-state kedua.
- **Defense budget:** total `cost` node terpasang (Router dihitung juga) ≤ Defense Budget akun
  (§1). Entry & Core tidak memotong budget.
- **Payload budget:** total `weight` blok terpasang (termasuk 1 blok Movement wajib) ≤ Payload
  Budget akun (§1).
- v1 sengaja **tidak membatasi** jumlah blok duplikat dalam satu virus (mis. 2× Exploit) — dibatasi
  natural oleh Payload Budget. Kombinasi duplikat yang dominan akan terdeteksi oleh
  `tools/balance-lab` (S1.7) dan baru dibatasi eksplisit di ruleset versi berikutnya jika perlu.

---

## 7. Urutan resolusi per tick (engine tick loop, S1.3)

Fixed order, wajib diikuti implementasi supaya hasil deterministik & `BattleLog` reproducible:

1. **Sensor** blocks yang aktif tick ini evaluasi & update flag (Scan Ahead, Detect Honeypot).
2. **Condition** blocks evaluasi flag (termasuk flag dari Sensor tick ini) → tentukan blok mana
   yang trigger tick ini.
3. **Movement**: jika virus sedang di sebuah node (bukan mid-edge) dan siap pilih edge
   berikutnya, tentukan edge (RNG draw untuk `Random Walk` terjadi di sini — urutan RNG §0).
4. **Attack** blocks yang trigger (langsung atau via Condition) apply damage ke Breach Node yang
   sedang di-occupy (one-shot Exploit hanya tick pertama masuk node).
5. **Efek node** apply, dalam urutan kelas: Breach (counter-damage Firewall) → Shoot (ICE Sentry
   accuracy roll & damage, RNG draw §0) → Trigger (Honeypot/Trap, jika baru dimasuki tick ini) →
   Aura (Scanner, refresh status "scanned" untuk virus dalam radius).
6. **Utility** blocks apply (Self Repair menambah Integrity jika syarat tick ini terpenuhi;
   Sacrifice Decoy menyerap trigger dari langkah 5 jika kondisi threshold terpenuhi tick ini).
7. **Death/end checks**: Integrity ≤ 0 → virus mati (Defender menang). Core HP ≤ 0 → Attacker
   menang. Tick counter = 1200 → timeout, Defender menang (§0).

Semua damage/HP diselesaikan sebagai integer, floor di 0 (tidak pernah negatif).

---

## 8. Skor & hasil battle (§6 GDD)

```
IntegrityRatio  = floor(IntegrityRemaining * 1000 / 1000)   // permille, virus max = 1000
CoreRatio       = floor(CoreHPRemaining * 1000 / CoreHPMax) // permille
TimeBonus       = floor(max(0, 1200 - TicksElapsed) / 4)

Attacker menang: Score = 500 + floor(IntegrityRatio * 300 / 1000) + NodesDestroyed * 40 + TimeBonus
Defender menang: Score = 300 + floor(CoreRatio * 300 / 1000)      + NodesDestroyed * 40 + TimeBonus
```

`NodesDestroyed` = jumlah Breach Node (Firewall) yang HP-nya mencapai 0 selama battle (Core tidak
dihitung, dia adalah win condition itu sendiri). Score mempengaruhi rating liga (Glicko-2, B4.4)
dan loot (M5.2) — bobot pastinya di luar cakupan ruleset sim, didefinisikan di layer server.

---

## 9. Temuan `tools/balance-lab` (S1.7)

`tools/balance-lab` (`pnpm --filter @payload/balance-lab report`) menjalankan 5 arketipe virus ×
4 arketipe defense (semua tier akun 1), 200 seed per matchup. Laporan lengkap ter-generate di
`tools/balance-lab/REPORT.md`. Status per item:

- [x] ~~Apakah Firewall Tier III + counter-damage 45/tick terlalu keras untuk virus non-Attack~~
  **Dikonfirmasi via simulasi S1.4, lalu DIPERBAIKI via S1.7**: tanpa blok Attack, virus vs
  Firewall Tier I awalnya berakhir **seri persis** (passive drain 10/tick × counter 20/tick =
  tepat 1000 damage = Integrity maksimum virus) — secara efektif membuat Firewall manapun
  hampir mustahil ditembus virus non-Attack. Balance-lab langsung mengonfirmasi ini sebagai
  masalah sistemik: 2 dari 5 arketipe virus (yang tanpa blok Attack sama sekali) mendapat **0%
  winrate lawan SEMUA 4 arketipe defense** — bukan cuma lawan Firewall Tier III yang memang
  didesain keras. **Perbaikan:** `BREACH_PASSIVE_DRAIN_V1` dinaikkan dari **10 → 15** HP/tick
  (§5.0, §0). Firewall Tier I sekarang survivable tanpa Attack blok (34 tick × 20 counter = 680
  damage, sisa 320 Integrity); Tier II/III (counter 30/45) tetap fatal tanpa Attack blok — sesuai
  intent desain awal (tier tinggi memang harus butuh Attack blok). Ini pengeditan v1 in-place
  (bukan bump ke v2) karena dilakukan SEBELUM ada BattleLog nyata yang bergantung padanya —
  RULESET v1 masih berstatus draft/belum di-playtest saat balance-lab pertama kali jalan.
  Verifikasi ulang: `test/nodes/firewall.test.ts`, `test/nodes/core.test.ts`.
- [x] ~~Apakah archetype full-Stealth (Cloak+Slow Crawl, minim Attack) punya winrate wajar lawan
  defense heavy-ICE~~ **Dikonfirmasi UNDERPERFORM secara spesifik lawan satu arketipe defense**:
  "Ghost Crawler"/"Ghost Scout" (Cloak + Detect Honeypot, tanpa Attack) mendapat 0% lawan
  "Firewall Wall" dan "ICE Nest", tapi justru 100% lawan "Honeypot Maze" (Detect Honeypot
  menetralkan jebakannya) — pola rock-paper-scissors yang memang diinginkan GDD §2 Pillar 1,
  bukan under-performance across-the-board. Akar masalah spesifiknya: durasi Cloak dihitung
  per-**node** (3–5 node), tapi ancaman terbesar (dwelling lama di satu Firewall/ICE) terjadi
  SETELAH budget node Cloak habis — Cloak tidak membantu begitu virus berhenti bergerak. Dicatat
  sebagai temuan mekanik untuk v2, bukan diubah sekarang (mengubah semantik durasi Cloak dari
  "per node" ke "per tick" adalah perubahan desain blok, bukan sekadar kalibrasi angka).
- [x] **Temuan baru dari S1.7**: arketipe defense "ICE Nest" (2× ICE Sentry Tier II + Scanner
  Tier I mengonvergensi ke satu chokepoint Firewall bersama, 19pt) menang **100% lawan SEMUA 5
  arketipe virus yang diuji** — termasuk yang membawa Cloak. Ini melanggar prinsip "tidak ada
  satu strategi yang mendominasi" (GDD §2). Bukan bug angka RULESET per se (dua ICE Sentry yang
  saling menumpuk radius memang secara matematis akan sangat kuat), tapi indikasi bahwa **v1
  belum punya guardrail** terhadap komposisi defense semacam ini. Tidak diubah di v1 (butuh
  keputusan desain: batasi overlap radius ICE Sentry? turunkan accuracy dasar ICE Tier II? ubah
  Cloak jadi berbasis waktu?) — dicatat sebagai prioritas utama v2, dan sebagai catatan untuk
  `tools/seed-defenses` (M5.4) agar tidak menghasilkan komposisi serupa di populasi AI awal.
- [ ] Apakah Payload Budget v1 (2400–3600 KB) cukup longgar untuk minimal 2 archetype berbeda per
  tier akun, atau terlalu ketat sehingga loadout viable jadi seragam — belum diuji eksplisit
  (kelima arketipe S1.7 semua muat di bawah 2400 KB dengan margin, jadi budget tampak tidak
  terlalu ketat, tapi ini bukan pengujian sistematis).
- [ ] Interaksi Overload splash vs Firewall berjajar (chain-kill) — belum ada arketipe S1.7 yang
  spesifik menguji ini; deferred ke sesi balance-lab berikutnya.

Target S1.7 (per PLAN.md): tidak ada matchup arketipe >75% winrate di ruleset v1. **Status
sebenarnya: sebagian besar dari 20 matchup masih di luar rentang [25%, 75%]** setelah satu
perbaikan sistemik (drain 10→15) diterapkan — sisanya sebagian besar konsisten dengan
rock-paper-scissors yang GDD memang inginkan (tiap arketipe virus punya ≥1 matchup kuat), KECUALI
temuan "ICE Nest" di atas yang genuinely bermasalah. Lima arketipe virus/defense di S1.7 sengaja
dibuat sebagai build ekstrem (full-agresi, full-stealth-nol-attack, defense yang menumpuk ICE)
untuk menguji batas sistem, bukan sampel "build rata-rata pemain" — sebagian sinyal >75%/<25% di
sini karena itu, bukan berarti ruleset v1 rusak menyeluruh. Perubahan angka lebih lanjut hasil
temuan balance-lab **wajib** naik versi ruleset (`v1` → `v2`, dst.) sesuai DoD #3 begitu ada
BattleLog nyata yang bergantung pada v1 — tidak lagi boleh diedit in-place setelah titik itu.

---

# Ruleset v2 — virus sebagai event sheet

> Keputusan desainnya di `docs/ADR/0006-event-sheet-virus-programming.md`; bagian ini adalah
> **angkanya**. Implementasi: `packages/sim/src/ruleset-v2.ts` (tabel), `sheet.ts` (bentuk, harga,
> validasi), `engine-v2.ts` (evaluasi). v1 (§0–§9) dibekukan dan tetap jalan lewat `engine.ts`;
> `simulate()` memilih engine dari `rulesetVersion` di input.
>
> Yang **tidak** berubah dari v1: satuan & determinisme (§0), atribut virus (§2), semua node
> pertahanan (§5), skor (§8). Yang berubah: bahasa virusnya.

## 10. Bentuk sheet, kondisi, dan aksi

Satu virus v2 adalah `VirusProgram { events: SheetEvent[] }`. Satu `SheetEvent` (satu "baris") =
sekumpulan **kondisi** (di-AND) → daftar **aksi** berurutan, plus **anak** yang hanya jalan kalau
kondisi induknya lolos. Kondisi kosong = `selalu`. OR ditulis sebagai dua baris bersebelahan;
NOT adalah flag `negate` per kondisi. Nesting maksimum **3 level** (root + 2).

### 10.1 Kondisi

Radius sensor dihitung dalam **hop graf**, bukan jarak DU — sama seperti radius node (§5.1).

| Kondisi | Label editor | Tier | Weight (KB) | Radius (hop) | Arti |
|---|---|---|---|---|---|
| `node-here-is` | Node saat ini = … | — | 120 | — | Virus sedang berdiri di node bertipe X. Selalu false saat virus di tengah edge. |
| `node-ahead-is` | Node di depan = … | — | 320 | — | Node tujuan berikutnya bertipe X: ujung jauh edge kalau sedang jalan, hop pertama jalur terpendek ke Core kalau sedang diam. |
| `honeypot-near` | Ada Honeypot dekat | I | 350 | 1 | Honeypot yang belum terpicu ada dalam radius. |
| | | II | 450 | 2 | |
| | | III | 550 | 3 | + tetap terlihat meski Honeypot menyamar sebagai Core (§5.1 Honeypot II). |
| `trap-near` | Ada Trap dekat | I | 400 | 1 | Trap yang belum meledak ada dalam radius. |
| | | II | 500 | 2 | |
| | | III | 600 | 3 | |
| `integrity-below` | Integrity < X% | — | 150 | — | Threshold bebas 0–1000‰ (default 500‰). |
| `is-scanned` | Sedang "scanned" | — | 130 | — | Status dari Scanner (§5.1) sedang aktif. |
| `took-damage-last-tick` | Baru kena damage | — | 90 | — | Virus kehilangan Integrity pada tick yang **baru saja** selesai. Namanya menyebut tick lalu karena sheet dievaluasi sebelum damage tick ini masuk (§11) — menyebut "tick ini" akan bohong. |
| `on-breach-node` | Di atas Breach Node | — | 90 | — | Sedang occupy Firewall hidup atau Core (§5.0). |
| `at-node` | Sedang di node | — | 60 | — | Berdiri di node, bukan menyeberang edge. |

Kondisi yang di v1 tiernya cuma membeli **konfigurabilitas** (mis. "IF Integrity < X%" II/III yang
melebarkan rentang threshold) jadi satu harga datar: di v2 threshold-nya angka yang diketik pemain,
dan menagih biaya untuk sebuah angka sama dengan menagih untuk apa-apa.

### 10.2 Aksi

**Slot** = hanya satu yang berlaku per tick, pemenangnya penulis **pertama** (baris paling atas —
lihat ADR 0006 §3, sengaja beda dari GDevelop yang last-wins). **Kumulatif** = semua yang jalan
tick itu menumpuk.

| Aksi | Label editor | Slot | Tier | Weight (KB) | Efek |
|---|---|---|---|---|---|
| `move-toward-core` | Jalan ke Core | movement | — | 800 | Jalur terpendek berbobot DU (Dijkstra). Speed 50 DU/tick. |
| `move-avoiding-hazards` | Jalan memutari bahaya | movement | — | 600 | Jalur terpendek yang menghindari node bahaya yang **terlihat oleh kondisi sensor di sheet ini**; jatuh kembali ke jalur biasa kalau tidak ada rute lain. Speed 50. |
| `move-random` | Jalan acak | movement | — | 500 | Edge acak (seeded) dari node saat ini; tak mengulang kecuali buntu. Speed 55. |
| `move-back` | Mundur | movement | — | 300 | Balik ke node yang barusan ditinggalkan. Tidak melakukan apa-apa kalau tidak ada / bukan tetangga. Speed 50. |
| `hold-position` | Diam di tempat | movement | — | 100 | Menahan slot gerak: baris di bawahnya tidak bisa memindahkan virus tick ini. |
| `brute-force` | Brute Force | kumulatif | I/II/III | 700 / 900 / 1100 | +40 / +60 / +85 damage per tick ke Breach Node yang di-occupy. |
| `exploit` | Exploit | kumulatif | I/II/III | 650 / 800 / 950 | 250 / 380 / 520 one-shot, **hanya pada tick pertama** virus berdiri di sebuah node. Pasangkan dengan `once: "node"` supaya tidak menyala lagi saat kembali ke node yang sama. |
| `overload` | Overload | kumulatif | I/II/III | 750 / 950 / 1150 | Saat Breach Node hancur tick ini: splash 150 / 230 / 320 ke Breach Node dalam 1 / 1 / 2 hop. |
| `cloak` | Cloak | slot cloak | I/II/III | 500 / 650 / 800 | Kebal status "scanned" & bukan target ICE Sentry selama **30 / 45 / 60 tick**, lalu cooldown **90 tick** dihitung dari saat status habis. |
| `slow-crawl` | Slow Crawl | slot slow-crawl | I/II/III | 300 / 380 / 460 | Tick ini: speed ×700‰ / 750‰ / 800‰, akurasi ICE Sentry −300‰ / −400‰ / −500‰. |
| `self-repair` | Self Repair | kumulatif | I/II/III | 450 / 550 / 650 | +5 / +8 / +12 Integrity. **Tanpa syarat tersembunyi** — gerbang v1 ("tidak kena damage", "tidak di Breach Node") sekarang baris yang ditulis pemain sendiri. |
| `arm-decoy` | Pasang Decoy | slot decoy | I/II/III | 400 / 500 / 600 | Menyiapkan 1 aktivasi yang menyerap 1 / 1 / 2 trigger berikutnya (tembakan ICE, Honeypot, Trap — bukan counter-damage Firewall). Maksimum 1 / 2 / 3 aktivasi per battle; tidak bisa dipasang selama aktivasi sebelumnya masih punya sisa serapan. |

### 10.3 `once` — sekali-jalan

Properti per baris, menggantikan bookkeeping per-blok v1 (`exploitedNodeIds` dulu hidup di dalam
engine):

| `once` | Baris boleh jalan lagi kalau… |
|---|---|
| `"battle"` | tidak pernah — sekali per battle. |
| `"node"` | virus sedang di node dengan id berbeda. |
| `"arrival"` | virus tiba di sebuah node lagi (kunjungan ulang ke node yang sama pun me-reset). |

Kuota terpakai saat baris **jalan**, bukan saat efeknya mendarat — kalau tidak, one-shot yang
damage-nya kebetulan ter-clamp akan diam-diam mengisi ulang dirinya sendiri.

### 10.4 Dua perubahan mekanik (bukan sekadar ganti kemasan)

1. **Cloak berbasis tick + cooldown.** §9 sudah mencatat model per-node itu bermasalah dari dua
   arah: di peta 4 node ia menutupi seluruh perjalanan, tapi berhenti membantu justru saat virus
   diam lama di satu Firewall. Basis tick memperbaiki keduanya; cooldown-nya yang mencegah
   `[selalu] → Cloak` jadi tembus pandang permanen seharga 500 KB.
2. **Deteksi tidak lagi memberi kekebalan.** Di v1, membawa Detect Honeypot otomatis membuat
   Honeypot tidak mematikan. Di v2 sensor adalah **kondisi**: ia memberi tahu, sheet yang
   memutuskan. Selamat dari Honeypot berarti sheet-nya benar-benar memutar (`[ada Honeypot dekat]
   → jalan memutari bahaya`), persis contoh GDD §4.2.

## 11. Urutan resolusi per tick (engine v2)

Menggantikan §7 untuk battle v2. Urutan fase node-nya sama dengan v1 (ADR 0001 tidak berubah);
yang berubah adalah **siapa yang memutuskan** di tiap fase.

1. **Sensor sweep** — kumpulkan node bahaya yang terlihat oleh kondisi sensor yang benar-benar ada
   di sheet ini (sheet tanpa sensor tidak membayar apa pun di sini).
2. **Evaluasi sheet** — depth-first, atas→bawah. Induk yang gagal melewati kondisinya melewatkan
   aksinya **dan seluruh anaknya**. Evaluasi sendiri **tidak pernah menarik RNG** (§0), jadi
   menambah satu baris kondisi tidak menggeser dadu.
3. **Status** — Cloak / Slow Crawl berlaku **sebelum** ada yang menembak, supaya baris yang
   memasang Cloak sebagai reaksi terlindungi pada tick yang sama.
4. **Efek node** — Attack kumulatif ke Breach Node yang di-occupy → counter-damage Firewall →
   tembakan ICE Sentry (RNG draw) → trigger Honeypot/Trap (hanya tick pertama di node itu) →
   aura Scanner.
5. **Utility** — Self Repair, pemasangan decoy.
6. **Gerak** — niat gerak pemenang slot dikonsumsi **di akhir tick**, jadi virus yang baru tiba
   selalu dapat satu tick penuh untuk bertindak di sana sebelum boleh pergi. Niat yang ditulis
   saat virus masih di tengah edge **diantre** (yang terakhir menang) dan dipakai saat tiba hanya
   kalau sheet tidak menulis niat baru pada tick kedatangan itu.
7. **`rule-fired`** untuk tiap baris yang aksinya benar-benar berefek tick ini, diurutkan stabil
   per id baris — lalu cek menang/kalah/timeout persis seperti §7 langkah 7.

Id yang dibawa `rule-fired` adalah `id` yang ditulis penulis sheet, atau — kalau tidak ada —
alamat barisnya (`"2.0.1"`). Itulah yang dipakai replay untuk menyalakan chip aturan yang menembak.

## 12. Budget, batas, dan validasi sheet

Payload budget & Defense budget per account tier sama persis dengan §1. Tambahannya:

| Account tier | Payload (KB) | Maks. baris event |
|---|---|---|
| 1 | 2400 | 12 |
| 2 | 2700 | 16 |
| 3 | 3000 | 20 |
| 4 | 3300 | 24 |
| 5 | 3600 | 28 |

- **Biaya sheet** = Σ weight kondisi + Σ weight aksi + **40 KB per baris**. Bobot per baris itu
  yang membuat sepuluh aturan satu-baris lebih mahal daripada satu aturan dengan sepuluh aksi.
- **Nesting gratis** — kedalaman itu alat keterbacaan, bukan sumber daya.
- **Batas jumlah baris** di tabel atas menghitung baris bersarang juga. Ia ada di atas budget KB
  supaya beban evaluasi server tetap terbatas berapa pun murahnya isi sebuah baris.
- **Batas aksi per tick = 32**, jaring pengaman di belakang batas jumlah baris.
- **Kedalaman maksimum 3 level.** Batas keterbacaan layar portrait 390px (GDD §3), bukan batas
  teknis.

`validateVirusProgram()` menolak (error): nesting > 3, jumlah baris > kuota tier, biaya > budget
payload, threshold di luar 0–1000‰. Ia **memperingatkan tapi tidak menolak**: sheet kosong, sheet
tanpa satu pun aksi gerak (legal — virusnya diam di Entry sampai timeout), dan baris yang tidak
punya kondisi, aksi, maupun anak.
