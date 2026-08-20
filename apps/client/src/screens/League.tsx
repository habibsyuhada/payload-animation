import { NotBuiltYet } from "./NotBuiltYet.js";
import { Screen } from "./Screen.js";

export function League(): JSX.Element {
  return (
    <Screen title="League">
      <NotBuiltYet blockedBy="rating & musim di server" reference="GDD §12.7 / PLAN.md Fase 5">
        Papan peringkat dan riwayat musim. Ini bagian yang paling butuh server: peringkat cuma ada
        artinya kalau dibanding pemain lain.
      </NotBuiltYet>
    </Screen>
  );
}
