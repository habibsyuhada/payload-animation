import type { CapacitorConfig } from "@capacitor/cli";

/**
 * capacitor.config.ts — C3.5: wraps the Vite build (webDir) into a native Android shell.
 * appId follows Android's reverse-domain convention; no real domain is registered yet so this
 * uses a placeholder under a namespace this project controls — revisit before a real Play Store
 * listing (needs a verified domain/publisher identity, out of scope for this session).
 */
const config: CapacitorConfig = {
  appId: "com.payload.game",
  appName: "Payload",
  webDir: "dist",
};

export default config;
