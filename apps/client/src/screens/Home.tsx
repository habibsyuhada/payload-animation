import { Link } from "react-router-dom";
import { Screen } from "./Screen.js";

export function Home(): JSX.Element {
  return (
    <Screen title="HQ / Home">
      <p>Status base, notifikasi serangan masuk, tombol Scan. (GDD §12.1 — belum diimplementasikan, C3.1 hanya navigasi.)</p>
      <Link to="/onboarding" data-testid="home-start-onboarding">
        Mulai Tutorial (5 battle)
      </Link>
      <p>
        <Link to="/defend" data-testid="home-open-defend">
          Buka Defend (layar penuh)
        </Link>
      </p>
    </Screen>
  );
}
