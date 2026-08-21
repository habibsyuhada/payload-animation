# ADR 0008 — Virus multi-entitas (`worm-split`) & Checkpoint

**Status:** accepted — diimplementasikan di PLAN.md 8.3a–8.3e.
**Context:** `packages/sim/src/engine-v2.ts`, `packages/sim/src/types.ts`, `packages/sim/src/sheet.ts`,
`packages/replay/src/{compile,camera,draw}.ts`, `apps/client/src/{state/attackPlayback,screens/Defend}.tsx`,
`docs/RULESET.md` §11/§11a/§12a, `docs/ADR/0006`, `docs/ADR/0007` §B (prasyarat arsitektur).

## Problem

`worm-split` dan `set-checkpoint` (GDD §4.2) ditunda sejak v1 karena keduanya menantang asumsi
paling dalam `engine-v2.ts`: **satu virus, satu tubuh, per battle.** Setiap bagian engine — sensor
sweep, evaluasi sheet, efek node, gerak, `rule-fired`, skor — ditulis mengasumsikan `state` tunggal.
Menambahkan `worm-split` tanpa membongkar asumsi itu berarti menambal N=1 jadi N=beberapa dengan
cara yang mudah membuat determinisme (ADR 0006 §2, RULESET §0/§11a) atau byte-identity log yang
ada diam-diam pecah — dan pecahnya baru kelihatan di battle yang benar-benar split, bukan di test
suite yang (sebelum PLAN.md 8.3) tidak satu pun menguji lebih dari satu tubuh.

`set-checkpoint` punya masalah sendiri: RULESET §13 sudah mengunci kematian di Integrity 0 supaya
Self Repair (yang tidak lagi punya gerbang "tidak kena damage tick ini", ADR 0006 §8) tidak diam-diam
membangkitkan mayat. Respawn **adalah** kebangkitan yang disengaja — ia harus bisa dibedakan dari
bug yang baru saja diperbaiki itu, dan pembedanya harus struktural, bukan sekadar "kali ini boleh".

## Decision

### A. Pembagian state: global (peta) vs per-entitas (tubuh)

`state: BattleStateV2` tunggal (dulu) → `state.entities: VirusEntity[]`, id numerik menaik, append-only, tidak
pernah di-splice — splicing membuat urutan iterasi bergantung pada riwayat kematian, dan id ambigu
begitu ada slot yang dipakai ulang. Entitas yang mati tidak pernah dibuang dari array; setiap fase
melewati `entity.died` (atau, untuk fase yang membaca `work`, entitas itu sudah tidak ada di sana —
lihat bagian C).

Aturan pembagi: *apakah field ini menggambarkan pertahanan, atau tubuh penyerang?*

| Global (`BattleStateV2`) | Per entitas (`VirusEntity`) |
|---|---|
| `coreHp`, `firewallHp`, `destroyedFirewallIds`, `spentTrapIds`, `triggeredHoneypotIds` | `location`, `integrity`, `died`, `damageTaken*`, `arrivalCount`, `previousNodeId`, `queuedMovement` |
| `iceNextFireTick` — cooldown milik sentry, bukan sasaran | `cloakUntilTick`/`cloakReadyAtTick`, `scannedUntilTick`, `decoy`, `firedOnceKeys` |
| `turnstileLockouts`, `alarmTriggeredIds`, `alarmActiveUntilTick` | `checkpointNodeId`, `respawnIntegrity`/`respawnsTotal`/`respawnsUsed`, `flags`, `visitedNodeIds` |
| `supportNodeHp`, `destroyedSupportNodeIds`, `disabledSupportNodeUntilTick` (PLAN.md 8.4) | `spoofUntilTick`/`overclockUntilTick`/`purgeImmuneUntilTick`, dst. (PLAN.md 8.4) |

`iceNextFireTick` sengaja masuk kolom global meski ia "tentang" siapa yang ditembak: cooldown itu
properti **sentry**, bukan sasaran — memindahkannya ke entitas akan membuat cooldown-nya reset tiap
kali target berganti, yang salah secara mekanik.

### B. `work`: snapshot awal-tick, bukan filter live

Tiap tick, `work: EntityTickWork[]` dibangun sekali (fase sensor sweep) dari entitas yang **masih
hidup di awal tick itu**, dan setiap fase sesudahnya membaca `work` — bukan `state.entities`
difilter ulang. Ini yang membuat N=1 byte-identical dengan kode single-entity yang digantikannya:
tubuh yang kena counter-damage mematikan di fase efek node tetap menuntaskan sisa fase tick itu
(gerak, utility, dst.) persis seperti sebelum ada multi-entitas — karena kode lama juga tidak
pernah mengecek kematian di tengah tick, hanya di langkah terakhir (§11).

### C. Urutan tick: sentry di loop luar, satu draw per sentry yang menembak

RNG paling rawan pecah di tembakan ICE Sentry (RULESET §11a). Alternatifnya — entitas di loop luar,
sentry di dalam — akan membuat nasib entitas 0 bergantung pada apakah entitas 1 kebetulan ada dan
menghabiskan cooldown sentry itu duluan: menambah cabang diam-diam mengubah nasib cabang yang sudah
ada, pelanggaran langsung terhadap semangat determinisme ADR 0006 §2. Sentry-di-luar menghindari
itu karena cooldown adalah properti sentry (bagian A) — id sentry tidak berubah berapa pun jumlah
entitas yang ada. Draw per tick dibatasi `sentry menembak + entitas` (ADR 0006 §6), bukan
`sentry × entitas`.

### D. Menang/kalah/skor

Attacker menang begitu **ada** entitas menolkan Core, siapa pun tubuhnya. Defender menang saat
**semua** entitas mati. `computeScore()` mengharapkan `integrityRatioPermille` di rentang 0–1000;
menjumlah integrity semua entitas hidup akan meledak keluar rentang itu begitu ada ≥2 tubuh, jadi
skor memakai **maksimum** integrity di antara entitas hidup (RULESET §8) — byte-identical untuk
N=1 karena satu-satunya entitas hidup selalu jadi maksimumnya sendiri.

### E. `entityId` di `BattleEvent`: gerbang statis dari sheet

Aturan naif "hilangkan `entityId` kalau `entities.length === 1`" gagal: sebuah battle yang split di
tick 300 akan menerbitkan event tanpa id untuk tick 0–299 dan dengan id sesudahnya — bentuk sebuah
event jadi bergantung pada masa depan battle itu sendiri. Sebagai gantinya, `sheetCanSplit(program)`
(`sheet.ts`) diputuskan **sekali, sebelum tick 0**, murni dari isi sheet: sheet yang mengandung
`worm-split` di mana pun (termasuk bersarang) membawa `entityId` di **setiap** event sejak tick 0;
sheet yang tidak, tidak membawanya sama sekali. Sheet tanpa `worm-split` persis himpunan sheet yang
ada sebelum ADR ini, jadi byte-identity berlaku secara **konstruksi**, bukan kebetulan.

Jebakan implementasi: `stableStringify` (`determinism.test.ts`) memakai `Object.keys`, jadi
`{...event, entityId: undefined}` **bukan** byte yang sama dengan kunci yang absen. Field opsional
harus ditulis lewat idiom spread bersyarat: `...(canSplit ? { entityId: entity.id } : {})`.

### F. Apa yang disalin ke cabang baru, apa yang di-reset

Prinsip pembagi: **memori program** disalin (identitas cabang tidak menghapus apa yang sudah
dipelajari/dijalankan sheet-nya); **status fisik** tubuh baru mulai dari nol (tubuh baru belum
"mengalami" apa pun secara fisik).

| Disalin (memori program) | Direset (status fisik) |
|---|---|
| `firedOnceKeys` (salinan, bukan Set yang sama — supaya bookkeeping `once` tiap tubuh independen sejak lahir) | Cloak, status "scanned", Spoof Signature, Overclock, cooldown EMP |
| `decoy.activationsUsed` (supaya split tidak jadi cara menghindari batas aktivasi) | `decoy.absorbsRemaining` (shield melindungi tubuh tempat ia dipasang) |
| `flags[]` (salinan array) | `checkpointNodeId` (checkpoint adalah tempat yang DITANDAI tubuh itu sendiri, bukan warisan) |
| `visitedNodeIds` (salinan Set) | — |

Menyalin `firedOnceKeys` kosong (bukan disalin) akan membuat `worm-split` jadi tombol reset
one-shot gratis — `once: "battle"` Exploit + split = dua Exploit seharga satu baris. Menyalin
membuat split netral terhadap `once`.

Keputusan Honeypot yang eksplisit di sini: `triggeredHoneypotIds` tetap **global** (bagian A) —
entitas kedua yang tiba di Honeypot yang sudah meletus (dari entitas lain) lewat dengan selamat,
konsisten dengan Trap, dan entitas A yang tertahan Honeypot tidak lagi ikut memaku entitas B.

### G. Checkpoint: respawn mengonsumsi `died`, tidak memintasnya

RULESET §13 mengunci kematian begitu Integrity menyentuh 0 justru supaya heal (Self Repair) tidak
diam-diam membangkitkan mayat. Respawn HARUS bisa dibedakan dari persis itu, dan pembedanya
struktural: respawn adalah fase **terpisah**, setelah gerak dan sebelum `rule-fired`/finalize, yang
membaca `entity.died` **hidup** (satu-satunya fase yang sengaja bereaksi terhadap kematian dari
mana pun lebih awal tick yang sama) dan **mengonsumsinya sebagai pemicu**: begitu ia benar,
terbitkan `virus-died` untuk tubuh itu, lalu — dan hanya lalu — ganti `died = false`, posisi =
node checkpoint, integrity = angka absolut dari tier `set-checkpoint` yang terakhir dipasang,
`respawnsUsed += 1`, `checkpointNodeId = null` (terpakai; memasang lagi butuh `set-checkpoint`
lagi). Gerbang Self Repair (`healAmount > 0 && !entity.died`) tidak disentuh sama sekali — dua
jalur ini secara struktural tidak bisa saling tumpang tindih.

Invariant yang wajib bisa di-grep, ditulis di kode dan RULESET §11/§12a: *Integrity hanya boleh
naik dari 0 ke >0 lewat event log `virus-died` → `virus-respawned` → `virus-entered-node` yang
eksplisit; tidak ada jalur kode yang diam-diam membatalkan nol.*

`detonate` (PLAN.md 8.3c) menyetel `noRespawn = true` supaya kematian yang disengaja tidak dibatalkan
Checkpoint yang kebetulan masih aktif.

## Consequences

- Untuk **N = 1** (sheet tanpa `worm-split` sama sekali), seluruh engine v2 byte-identical dengan
  versi sebelum ADR ini — dibuktikan oleh 5 hash `determinism.test.ts` dan 18 kasus
  `engine-v2.test.ts` yang lulus tanpa diedit di setiap sub-langkah 8.3a–8.3d.
- `packages/replay` (`compile.ts`, `camera.ts`, `draw.ts`) dan `apps/client`
  (`attackPlayback.ts`/`Defend.tsx`) harus menerima N track virus, bukan satu — konvensi id track
  `"virus"` untuk entitas 0 menjaga jalur satu-entitas tetap kompatibel-mundur tanpa satu baris
  perubahan di konsumen lama. Detail lengkap ada di komentar `compile.ts` dan `camera.ts`.
- Battle split menampilkan dua (atau tiga) tubuh dengan health bar independen di Defend.tsx.
- Menambah "flag" (RULESET §12a) sebagai memori program murni memperluas kolom "disalin" di bagian
  F tanpa mengubah satu keputusan pun di sini — konsisten dengan mengapa flag ada di kolom itu
  sejak awal.
