import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { useAppShellStore } from "./state/appShellStore.js";
import { Home } from "./screens/Home.js";
import { VirusLab } from "./screens/VirusLab.js";
import { Scan } from "./screens/Scan.js";
import { Replay } from "./screens/Replay.js";
import { Research } from "./screens/Research.js";
import { League } from "./screens/League.js";
import { Onboarding } from "./screens/Onboarding.js";
import { Defend } from "./screens/Defend.js";

/**
 * The 7 screens (GDD §12), route paths, and short nav labels. `HashRouter` (not `BrowserRouter`)
 * because C3.5 wraps this in Capacitor, which serves the app from a local file:// origin with no
 * real HTTP server to resolve deep-linked paths — a hash route always resolves locally.
 *
 * "Defense" is the full-screen Defend page. It replaced the earlier Defense Grid editor outright
 * rather than living beside it: the two were two ways to draw the same graph, and keeping both
 * meant two topology editors to maintain, two sets of camera bugs, and a player having to guess
 * which one their layout lived in. Defend won because it is the one that can *test* a layout.
 */
const NAV_ITEMS = [
  { path: "/", label: "HQ", element: <Home /> },
  { path: "/virus-lab", label: "Lab", element: <VirusLab /> },
  { path: "/defend", label: "Defense", element: <Defend /> },
  { path: "/scan", label: "Scan", element: <Scan /> },
  { path: "/replay", label: "Replay", element: <Replay /> },
  { path: "/research", label: "Riset", element: <Research /> },
  { path: "/league", label: "Liga", element: <League /> },
] as const;

/**
 * Routes that deliberately stay out of the bottom nav: Onboarding (C3.4) is a one-time flow
 * launched from Home.
 */
const EXTRA_ROUTES = [{ path: "/onboarding", element: <Onboarding /> }] as const;

function AppShell(): JSX.Element {
  const activeScreenTitle = useAppShellStore((state) => state.activeScreenTitle);

  return (
    <div className="payload-app">
      <header data-testid="app-header">
        <strong>{activeScreenTitle || "Payload"}</strong>
      </header>
      <div className="payload-app-content">
        <Routes>
          {NAV_ITEMS.map((item) => (
            <Route key={item.path} path={item.path} element={item.element} />
          ))}
          {EXTRA_ROUTES.map((item) => (
            <Route key={item.path} path={item.path} element={item.element} />
          ))}
        </Routes>
      </div>
      <nav className="payload-nav" aria-label="Screen navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/"} className={({ isActive }) => `payload-nav-link${isActive ? " active" : ""}`}>
            {item.label}
          </NavLink>
        ))}
      </nav>
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
