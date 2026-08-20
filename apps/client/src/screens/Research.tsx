import { NotBuiltYet } from "./NotBuiltYet.js";
import { Screen } from "./Screen.js";

export function Research(): JSX.Element {
  return (
    <Screen title="Research">
      <NotBuiltYet blockedBy="ekonomi & mata uang Data" reference="GDD §12.6 / PLAN.md Fase 5">
        Tree unlock: membuka kondisi, aksi, dan node pertahanan baru, bercabang antara stealth dan
        brute force. Sekarang semua isi katalog terbuka sejak awal.
      </NotBuiltYet>
    </Screen>
  );
}
