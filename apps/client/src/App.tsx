import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { useAppShellStore } from "./state/appShellStore.js";
import { Home } from "./screens/Home.js";
import { VirusLab } from "./screens/VirusLab.js";
import { Scan } from "./screens/Scan.js";
import { Research } from "./screens/Research.js";
import { Onboarding } from "./screens/Onboarding.js";
import { Defend } from "./screens/Defend.js";

/**
 * Hub-and-spoke, not tabs. HQ is the room you come back to; every other screen is entered from a
 * card there and left through "← HQ" in the header.
 *
 * The bottom nav this replaced was carrying seven destinations across 390px — labels wrapped, two
 * of them led to screens that did not exist, and it spent a permanent strip of a phone screen on
 * a choice between four things. Defend already worked this way (it is full-screen with its own
 * way out) and it is the screen that reads best, so the rest of the app now matches it.
 *
 * `HashRouter` (not `BrowserRouter`) because C3.5 wraps this in Capacitor, which serves the app
 * from a local file:// origin with no HTTP server to resolve deep-linked paths — a hash route
 * always resolves locally.
 */
const ROUTES = [
  { path: "/", element: <Home /> },
  { path: "/virus-lab", element: <VirusLab /> },
  { path: "/defend", element: <Defend /> },
  { path: "/scan", element: <Scan /> },
  { path: "/research", element: <Research /> },
  { path: "/onboarding", element: <Onboarding /> },
] as const;

/**
 * Brand on the hub, way back everywhere else. The screen's own title sits next to the back link
 * rather than replacing it: on a spoke, "where am I" and "how do I get out" are the same glance.
 *
 * This bar is also the page's heading — `Screen` deliberately renders no <h1> of its own, because
 * a screen that repeats its title directly under the bar that already says it spends the top of a
 * phone screen saying one thing twice.
 */
function AppHeader(): JSX.Element {
  const activeScreenTitle = useAppShellStore((state) => state.activeScreenTitle);
  const isHub = useLocation().pathname === "/";

  return (
    <header data-testid="app-header">
      {isHub ? (
        <h1 className="payload-brand">PAYLOAD</h1>
      ) : (
        <>
          <Link to="/" className="payload-back" data-testid="back-to-hub">
            ← HQ
          </Link>
          <h1 className="payload-header-title">{activeScreenTitle}</h1>
        </>
      )}
    </header>
  );
}

function AppShell(): JSX.Element {
  return (
    <div className="payload-app">
      <AppHeader />
      <div className="payload-app-content">
        <Routes>
          {ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
        </Routes>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell />
    </HashRouter>
  );
}
