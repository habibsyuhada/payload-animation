# PAYLOAD — Game Design Document

**Genre:** Async PvP Auto-Battler / Programming Puzzle, tema hacker
**Platform:** Mobile (Android dulu, iOS menyusul), portrait
**Art style:** Pixel art + kinetic infographic (node-link diagram animasi)
**Working title:** Payload
**Versi dokumen:** 1.0 — draft desain awal

---

## 1. High Concept

Pemain merakit **virus** dari blok-blok logika visual, lalu melepaskannya ke **jaringan pertahanan** milik pemain lain secara asinkron. Pertarungan diselesaikan secara deterministik di server, dan hasilnya ditonton sebagai **replay sinematik bergaya packet-flow animation** — bisa di-pause, di-scrub mundur-maju, di-slow-motion, dan di-export jadi video untuk dibagikan.

Satu kalimat pitch: *"Rakit virusmu, susun bentengmu, lalu tonton ulang detik demi detik kenapa kamu menang — atau kalah."*

### Kenapa game ini beda

Auto-battler mobile lain menampilkan hasil battle sebagai animasi sekali jalan yang tidak bisa diapa-apakan. Payload menjadikan **replay sebagai fitur inti**: karena seluruh battle adalah fungsi murni dari waktu `T`, pemain bisa menggeser timeline seperti video editor, melihat frame mana pun secara instan, dan memahami persis di node mana serangannya gagal. Ini mengubah kekalahan dari frustrasi menjadi informasi — dan itulah bahan bakar loop "ubah desain → coba lagi".

---

## 2. Design Pillars

1. **Readable depth** — sistemnya dalam (kombinatorik blok logika), tapi setiap kejadian di battle bisa dibaca secara visual. Tidak ada RNG tersembunyi yang tidak bisa dijelaskan replay.
2. **Kekalahan = data** — pemain tidak pernah kalah tanpa tahu kenapa. Replay yang bisa di-scrub adalah alat belajarnya.
3. **Buat, bukan grind** — kekuatan pemain datang dari kecerdikan desain virus/pertahanan, bukan semata level angka.
4. **Setiap battle layak ditonton** — estetika kinetic-infographic membuat replay indah, sehingga export & share terasa natural (dan jadi mesin marketing organik).

---

## 3. Core Loop

```
 ┌──────────────────────────────────────────────────┐
 │  RAKIT VIRUS  →  SERANG (async)  →  TONTON REPLAY │
 │       ↑                                    │       │
 │  UBAH DESAIN  ←  ANALISIS KEGAGALAN  ←─────┘       │
 └──────────────────────────────────────────────────┘
          (paralel: SUSUN PERTAHANAN ← tonton replay
           serangan orang lain ke basmu)
```

Loop pendek (per sesi ~5–10 menit):

1. Buka app → lihat notifikasi: basmu diserang 3x semalam. Tonton replay-nya.
2. Lihat titik lemah pertahanan → geser satu node ICE, pasang honeypot.
3. Pilih target dari daftar scan → lepas virus → tonton replay hasil.
4. Virus mati di firewall layer 2 → scrub mundur, lihat penyebabnya → ganti satu blok logika → serang lagi (atau simpan buat besok).

Loop panjang (mingguan): naik divisi liga, unlock blok logika baru, event musiman dengan defense archetype baru.

---

## 4. Sistem Inti A — Virus Builder

Virus dirakit di kanvas visual sebagai **rantai blok** (linear dengan percabangan kondisional), bukan node-graph bebas — supaya tetap nyaman di layar HP portrait.

### 4.1 Anatomi virus

- **Payload budget:** setiap virus punya kapasitas (mis. 20 MB). Setiap blok punya "berat". Ini sumber trade-off utama: virus pintar = berat = lambat.
- **Integrity (HP):** berkurang saat kena ICE/trap. Virus mati saat 0.
- **Speed:** menentukan kecepatan gerak antar-node (dan waktu total infiltrasi — ada batas waktu battle, lihat §6).

### 4.2 Kategori blok logika

| Kategori | Warna | Contoh blok | Fungsi |
|---|---|---|---|
| **Movement** | Biru | `Shortest Path`, `Random Walk`, `Avoid Scanned`, `Backtrack` | Menentukan cara virus memilih edge berikutnya |
| **Sensor** | Kuning | `Scan Ahead (1 node)`, `Detect Honeypot`, `Read Traffic` | Membaca info jaringan; hasilnya jadi input blok kondisi |
| **Condition** | Ungu | `IF integrity < 50%`, `IF node = Firewall`, `IF scanned` | Percabangan perilaku |
| **Attack** | Merah | `Brute Force`, `Exploit`, `Overload`, `Worm Split` | Menembus/menghancurkan node pertahanan |
| **Stealth** | Hijau | `Cloak (3 node)`, `Spoof Signature`, `Slow Crawl` | Menghindari deteksi; biasanya menurunkan speed |
| **Utility** | Abu | `Self Repair`, `Checkpoint`, `Sacrifice Decoy` | Sustain & trik |

Blok punya **tier** (I–III) yang meningkatkan angka, bukan mengubah fungsi — kedalaman datang dari kombinasi, bukan dari angka.

### 4.3 Contoh desain virus

> "Ghost Worm": `Slow Crawl` + `Scan Ahead` + `IF Honeypot → Backtrack` + `IF Firewall → Exploit` + `Worm Split saat integrity < 30%`.
> Berat, lambat, tapi hampir mustahil masuk honeypot. Lemah lawan pertahanan berbasis timer.

Pemain menyimpan hingga 5 loadout virus dan memilih satu per serangan.

---

## 5. Sistem Inti B — Defense Network

Pertahanan pemain adalah **node-link graph** yang mereka susun sendiri: node **Core** (yang harus dilindungi) di tengah, node **Entry** (titik masuk virus, minimal 2, posisinya ditentukan sistem) di tepi.

### 5.1 Jenis node

| Node | Fungsi |
|---|---|
| **Router** | Node kosong penghubung; murah, membentuk topologi |
| **Firewall** | Menahan virus, harus ditembus (damage ke integrity penyerang selama menembus) |
| **ICE Sentry** | Menembak virus yang lewat di edge dalam radius |
| **Honeypot** | Menyamar sebagai Core/target menarik; virus yang masuk terjebak & mati kecuali punya detektor |
| **Scanner** | Menandai virus (buff akurasi ICE, debuff stealth) |
| **Trap Node** | Meledak sekali saat dilewati |
| **Core** | Target. Punya HP; battle dimenangkan penyerang jika HP Core habis |

### 5.2 Aturan penyusunan

- Budget poin pertahanan (naik seiring progression) membatasi jumlah & tier node.
- Topologi bebas, tapi **setiap Entry wajib punya jalur valid ke Core** (dicek otomatis) — mencegah "turtle" yang tak bisa ditembus.
- Edge punya panjang (mempengaruhi travel time) — jarak adalah sumber daya desain.

Prinsip balancing: pertahanan yang kuat lawan satu archetype virus selalu lemah lawan archetype lain (segitiga stealth ↔ brute ↔ swarm).

---

## 6. Battle Resolution (deterministik)

- Battle diselesaikan **di server** sebagai simulasi tick-based deterministik: input = (desain virus, desain pertahanan, seed). Seed disimpan; simulasi yang sama selalu menghasilkan hasil yang sama.
- Output server bukan video, melainkan **battle log ringkas**: daftar event bertimestamp (`t=3.2s: virus memasuki node #7`, `t=4.1s: ICE #3 menembak, -12 integrity`, dst).
- Batas durasi battle 60 detik in-game; jika Core belum jatuh, bertahan menang.
- Hasil: menang/kalah + skor performa (waktu, integrity sisa, node dihancurkan) → mempengaruhi rating liga & loot.

Determinisme ini penting karena dua hal: anti-cheat (klien tidak bisa memalsukan hasil) dan **replay system** di bawah.

---

## 7. Replay System — fitur bintang

Inilah tempat teknik **time-driven / declarative animation** dipakai. Klien menerima battle log, lalu meng-compile-nya menjadi **timeline deklaratif**: setiap entitas (virus, proyektil ICE, ledakan trap, pulsa scanner) punya posisi/opacity/skala sebagai **fungsi murni dari `T`** (detik battle), dibangun dari `interpolate([waktu...], [nilai...], easing)` dan `mix(a, b, t)`.

Konsekuensi desain langsung:

- **Scrub bar** seperti video player: geser ke frame mana pun → dihitung instan, tanpa simulasi ulang.
- **Kecepatan bebas:** 0.25x untuk membedah momen kritis, 4x untuk skip bagian membosankan.
- **Event markers** di timeline: titik merah = virus kena damage, titik emas = firewall jebol. Tap marker → lompat ke momen itu.
- **"Momen kematian" otomatis:** saat replay selesai, tombol *"Kenapa aku kalah?"* melompat ke 5 detik sebelum event fatal, dalam slow-motion, dengan kamera zoom ke node terkait.
- **Export video** (MP4/GIF, dengan watermark Payload + kode replay): karena setiap frame bisa dirender dari `T`, export hanyalah render loop offline. Ini fitur share/marketing utama.
- **Replay code:** hasil battle bisa dibagikan sebagai kode pendek; penerima menonton replay penuh di app (log diambil dari server).

### 7.1 Bahasa visual replay (sesuai gaya kinetic infographic)

- Virus = paket pixel berdenyut (sin-wobble) yang mengalir sepanjang edge (lerp posisi antar node), dengan trail.
- Blok logika yang sedang aktif ditampilkan sebagai chip kecil di atas virus (mis. ikon `Cloak` menyala saat stealth aktif) — pemain *melihat* programnya berjalan.
- Tembus firewall = animasi crack + shake (easeOutBack); deteksi scanner = ring pulse; kematian virus = burst partikel + glitch.
- **Cue-based sequencing** untuk framing sinematik: intro (kamera overview jaringan, 2 dtk) → infiltrasi (follow-cam virus) → klimaks (auto slow-mo saat event fatal/menang) → outro (stempel hasil). Durasi tiap adegan dihitung dari log; menggeser satu adegan tidak merusak yang lain.

---

## 8. Async PvP & Matchmaking

- **Scan list:** pemain diberi 5 target kandidat dalam rentang rating; refresh gratis tiap beberapa jam. Info yang terlihat sebelum menyerang: rating, jumlah node (bukan topologinya), dan riwayat 3 hasil terakhir — cukup untuk memilih, tidak cukup untuk counter-pick sempurna.
- **Shield:** setelah diserang 3x dalam 8 jam, bas mendapat shield sementara (mencegah dog-piling).
- **Liga musiman** (musim ~4 minggu): Bronze → Elite. Reset lunak tiap musim.
- **Revenge:** pemain yang diserang bisa membalas langsung ke penyerangnya 1x.
- Pertahanan pemain offline tetap "hidup" — battle log serangan masuk menunggu ditonton saat login (ini sumber notifikasi re-engagement utama).

---

## 9. Progression & Economy

- **Sumber daya tunggal: Data (soft currency)** dari menang battle, misi harian, dan "passive tap" kecil dari pertahanan yang berhasil menahan serangan.
- **Unlock blok & node** lewat research tree bercabang (pemain memilih jalur: stealth-first vs brute-first) — bukan gacha.
- **Tier-up blok** (I→III) pakai Data + duplikat blueprint dari loot battle.
- Level akun menaikkan payload budget & defense budget secara perlahan — plafon kecil, supaya matchup tetap soal desain, bukan angka.
- **Misi harian** diarahkan ke perilaku sehat: "tonton 2 replay serangan ke basmu", "menangkan battle dengan virus < 15 MB".

---

## 10. Monetisasi (fair, non-P2W)

- **Kosmetik:** skin virus (bentuk paket, trail, efek kematian), tema jaringan (warna node, background grid), frame export video, victory stamp.
- **Battle pass musiman** — jalur gratis + premium; premium berisi kosmetik & slot loadout ekstra, tanpa blok eksklusif.
- **Convenience:** slot loadout virus tambahan, refresh scan list ekstra. Tidak menjual power.
- Tanpa iklan interstisial; opsi rewarded ad tunggal (refresh scan / loot kecil) untuk pasar yang sesuai.

---

## 11. Art Direction

- **Dua lapis identitas:** UI & karakter dunia (avatar hacker, terminal, menu) = pixel art; battle & replay = kinetic infographic (garis bersih, glow, motion-graphics) yang tetap dirender dengan grid pixel supaya menyatu.
- Palet: gelap (near-black biru), aksen neon per faksi warna blok (§4.2). Kontras tinggi supaya readable di layar kecil & saat di-export ke video terkompresi.
- Semua easing dari library kecil yang konsisten (easeOutCubic untuk gerak, easeOutBack untuk impact, linear untuk aliran ambient) — konsistensi easing = "rasa" game.
- Audio: synthwave/ambient elektronik; SFX battle dipetakan ke event log (tick deterministik → audio juga bisa di-scrub tanpa desync).

---

## 12. Screens utama (UX)

1. **HQ / Home** — status bas, notifikasi serangan masuk, tombol Scan.
2. **Virus Lab** — builder rantai blok (drag & drop vertikal), simulasi kering vs pertahanan latihan.
3. **Defense Grid** — editor topologi (pinch-zoom, drag node), validator jalur otomatis.
4. **Scan / Attack** — daftar target → konfirmasi → replay.
5. **Replay Player** — layar penuh, scrub bar + markers + speed control + export.
6. **Research** — tree unlock.
7. **League** — papan peringkat & riwayat musim.

Onboarding: 5 battle tutorial melawan AI dengan pertahanan tetap, masing-masing memperkenalkan 1 kategori blok; replay tutorial pertama secara eksplisit mengajari scrub ("geser mundur — lihat kenapa virusmu mati").

---

## 13. Arsitektur Teknis (ringkas)

- **Klien:** engine game mobile (mis. Flutter/Unity — diputuskan terpisah); replay renderer adalah modul mandiri berbasis fungsi-waktu (portabel juga ke web untuk viewer replay via link).
- **Server:** simulasi battle tick-based (logika dipisah sebagai library murni tanpa dependensi engine, supaya bisa diuji unit & dijalankan identik di CI), REST/WebSocket API, penyimpanan battle log + seed.
- **Determinisme:** fixed-point/integer math di simulasi (hindari float antar-platform), seed per battle, versi ruleset disimpan di log (replay lama tetap valid setelah balance patch — replayer memuat ruleset sesuai versi).
- **Export video:** render offscreen frame-by-frame dari `T` → encode di device; fallback render server-side untuk device lemah.

---

## 14. Scope & Milestone

| Milestone | Isi | Catatan |
|---|---|---|
| **M1 — Core sim** | Library simulasi deterministik + 12 blok + 5 node type, CLI test harness | Belum ada UI |
| **M2 — Replay vertical slice** | Replay player penuh (scrub, markers, easing) memutar log dari M1 | Ini slice yang "menjual" game |
| **M3 — Builders** | Virus Lab + Defense Grid + validasi | |
| **M4 — Async loop** | Server, akun, scan/attack, shield, notifikasi | |
| **M5 — Meta** | Research tree, liga, misi harian | |
| **M6 — Polish & monetisasi** | Kosmetik, battle pass, export video, onboarding | Soft launch |

## 15. Risiko utama & mitigasi

- **Balancing kombinatorik blok** meledak → mulai dengan pool blok kecil (≤20), tambah per musim; simulasi otomatis ribuan matchup di CI untuk mendeteksi kombinasi dominan.
- **Pemain kesulitan "memprogram"** → template virus starter per archetype + mode simulasi kering gratis tanpa risiko.
- **Async PvP terasa sepi di awal** (populasi kecil) → seed pertahanan buatan AI/kurasi dev yang menyamar natural sampai populasi cukup.
- **Export video berat di low-end** → resolusi export adaptif + fallback server render.
