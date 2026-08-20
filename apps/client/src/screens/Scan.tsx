import { NotBuiltYet } from "./NotBuiltYet.js";
import { Screen } from "./Screen.js";

export function Scan(): JSX.Element {
  return (
    <Screen title="Scan / Attack">
      <NotBuiltYet blockedBy="lawan untuk diserang" reference="GDD §12.4 / PLAN.md Fase 4">
        Daftar target dalam rentang rating, pilih satu, lalu tonton replay serangannya. Async PvP
        butuh server — tapi lawan AI offline (200 pertahanan dari <code>tools/seed-defenses</code>)
        bisa mengisi layar ini tanpa server sama sekali.
      </NotBuiltYet>
    </Screen>
  );
}
