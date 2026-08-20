import { NotBuiltYet } from "./NotBuiltYet.js";
import { Screen } from "./Screen.js";

export function Replay(): JSX.Element {
  return (
    <Screen title="Replay Player">
      <NotBuiltYet blockedBy="riwayat battle yang tersimpan" reference="GDD §12.5">
        Layar penuh dengan scrub bar, marker, dan kontrol kecepatan. Mesinnya sudah ada dan sudah
        dipakai: halaman Defense memutar battle di atas petanya sendiri. Yang belum ada adalah
        daftar battle untuk dibuka di sini — dan karena sim deterministik, yang perlu disimpan cuma
        (seed, virus, pertahanan), bukan lognya.
      </NotBuiltYet>
    </Screen>
  );
}
