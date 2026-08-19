import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { useAppShellStore } from "./state/appShellStore.js";
import { Home } from "./screens/Home.js";
import { VirusLab } from "./screens/VirusLab.js";
import { DefenseGrid } from "./screens/DefenseGrid.js";
import { Scan } from "./screens/Scan.js";
import { Replay } from "./screens/Replay.js";
import { Research } from "./screens/Research.js";
import { League } from "./screens/League.js";

/**
 * The 7 screens (GDD §12), route paths, and short nav labels. `HashRouter` (not `BrowserRouter`)
 * because C3.5 wraps this in Capacitor, which serves the app from a local file:// origin with no
 * real HTTP server to resolve deep-linked paths — a hash route always resolves locally.
 */
const NAV_ITEMS = [
  { path: "/", label: "HQ", element: <Home /> },
  { path: "/virus-lab", label: "Virus Lab", element: <VirusLab /> },
  { path: "/defense-grid", label: "Defense", element: <DefenseGrid /> },
  { path: "/scan", label: "Scan", element: <Scan /> },
  { path: "/replay", label: "Replay", element: <Replay /> },
  { path: "/research", label: "Research", element: <Research /> },
  { path: "/league", label: "League", element: <League /> },
] as const;

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
