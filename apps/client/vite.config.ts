import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * GitHub Pages serves a project site from /<repo-name>/, not /, so asset URLs need that prefix —
 * but ONLY for the Pages build. Capacitor (C3.5) also runs `vite build` and loads the result from
 * its own app root (file://.../assets/public/), where a /payload-animation/ prefix would break
 * every asset path. GITHUB_PAGES is set explicitly by .github/workflows/deploy-pages.yml so the
 * default `pnpm build` (used locally and by Capacitor) stays at base "/".
 */
const base = process.env.GITHUB_PAGES ? "/payload-animation/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
