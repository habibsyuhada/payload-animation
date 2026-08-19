# PAYLOAD — Ruleset v1

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
   sampai HP node = 0. Semua Breach Node kena **passive drain 10 HP/tick** dari sekadar occupancy
   (menjamin virus tanpa blok Attack tetap bisa menang, hanya lambat), ditambah kontribusi blok
   Attack aktif (§4.3). Hanya `Firewall` yang membalas damage ke virus tiap tick (`Core` tidak).
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

## 9. Item terbuka untuk `tools/balance-lab` (S1.7)

Ditandai eksplisit supaya tidak dianggap final sebelum simulasi massal jalan:

- [ ] Apakah archetype full-Stealth (Cloak+Slow Crawl, minim Attack) punya winrate wajar lawan
  defense heavy-ICE, atau under/overperform?
- [x] ~~Apakah Firewall Tier III + counter-damage 45/tick terlalu keras untuk virus non-Attack~~
  **Dikonfirmasi via simulasi S1.4** (`test/nodes/firewall.test.ts`): tanpa blok Attack (S1.5
  belum ada), virus vs Firewall Tier I berakhir **seri persis** — virus mati tepat di tick yang
  sama Firewall itu hancur (passive drain 10/tick × counter 20/tick = total 1000 damage = tepat
  Integrity maksimum virus). Tier II/III (counter 30/45 per tick) jelas fatal lebih cepat dari
  itu. Kesimpulan: di v1, **virus tanpa Attack blok tidak pernah benar-benar menembus Firewall
  manapun dengan sisa HP** — cocok dengan intent desain, tapi berarti Self Repair (S1.5, +5–12
  Integrity/tick) kemungkinan wajib dibawa untuk mengubah hasil seri jadi menang; perlu diverifikasi
  ulang begitu Attack & Self Repair blocks ada (S1.5) sebelum S1.7 menilai winrate archetype.
- [ ] Apakah Payload Budget v1 (2400–3600 KB) cukup longgar untuk minimal 2 archetype berbeda per
  tier akun, atau terlalu ketat sehingga loadout viable jadi seragam.
- [ ] Kalibrasi accuracy ICE Sentry (850–900‰) — cek apakah efektif rendah karena radius kecil,
  atau terlalu dominan setelah dikombinasi Scanner aura (+150–250‰ accuracy).
- [ ] Interaksi Overload splash vs Firewall berjajar (chain-kill) — pastikan tidak ada satu build
  yang bisa membersihkan seluruh defense line secara trivial.

Target S1.7 (per PLAN.md): tidak ada matchup arketipe >75% winrate di ruleset v1. Perubahan angka
hasil temuan balance-lab **wajib** naik versi ruleset (`v1` → `v2`, dst.) sesuai DoD #3 — tidak
pernah menimpa `v1.json` yang sudah dipakai battle log yang ada (replay lama harus tetap valid,
lihat §2 kontrak data di `PLAN.md`).
