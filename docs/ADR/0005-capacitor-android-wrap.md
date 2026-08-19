# ADR 0005 — Capacitor Android wrap: scaffolded, not built or device-tested (C3.5)

**Status:** accepted, with an explicit unfinished part
**Context:** `apps/client/capacitor.config.ts`, `apps/client/android/`

## What C3.5 asks for

PLAN.md's acceptance bar: "APK debug terpasang & jalan 60fps di device mid-range" (a debug APK
installed and running at 60fps on a mid-range device). That is a hands-on-a-device claim, and this
session has no device, no emulator, and — as established below — no way to even finish the build.

## What this session actually did

1. Added `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` to `apps/client`.
2. `capacitor.config.ts`: `webDir: "dist"` (Vite's own build output — no separate copy step
   needed beyond `cap sync`), `appId: "com.payload.game"` (placeholder reverse-domain id; revisit
   before a real Play Store listing, which needs a verified publisher identity this session can't
   set up).
3. `npx cap add android` — scaffolded the native Android project (`apps/client/android/`,
   committed: manifest, Gradle files, `MainActivity.java`, launcher/splash assets). `cap sync`
   copies the web build into `android/app/src/main/assets/public` correctly (verified — see
   below); that part of the pipeline works.

## What could not be done, and exactly why

Running `./gradlew` (even just `tasks`, not a real build) fails immediately:

```
Could not GET 'https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/8.2.1/gradle-8.2.1.pom'.
Received status code 403 from server: Forbidden
```

This session's outbound network goes through a policy-enforcing proxy (see `/root/.ccr/README.md`)
that allows a fixed set of package registries (npm, PyPI, crates.io, the Go proxy, jsr.io) and
**explicitly denies `dl.google.com`** — Google's own Maven repository, which is where the Android
Gradle Plugin, `google-services`, and every AGP/SDK artifact live. There is no local mirror or
cached copy available (`--offline` fails identically, for the same missing artifacts). The proxy's
own guidance is unambiguous: a 403 here is an organization policy denial, "do not retry or route
around it" — so this isn't a transient failure to work past, it's a hard boundary of this sandbox.

Consequence: **no Android SDK components can be fetched, no Gradle sync can complete, no APK
(debug or otherwise) can be produced, and there is no `adb`/emulator/device to install one on even
if a prebuilt APK existed.** All of "APK debug terpasang & jalan 60fps" is therefore unverified —
not "verified and passing," not silently skipped either. PLAN.md's checklist for C3.5 stays
**unchecked** rather than being marked done on partial (scaffolding-only) progress.

## What finishing this actually requires (for a real dev machine or CI runner)

1. Android SDK + build tools installed, `ANDROID_HOME`/`local.properties` pointing at them
   (needs unrestricted access to `dl.google.com`/`maven.google.com` — this sandbox's proxy policy
   is exactly what's in the way, nothing in this repo's own config).
2. `pnpm --filter @payload/client build && pnpm --filter @payload/client cap:sync`
3. `cd apps/client/android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
4. `adb install` onto a real or emulated mid-range device, launch, and check frame timing (Android
   GPU Profiling / Perfetto, or a simple on-screen FPS counter) against the 60fps bar while
   actually playing a replay (packages/replay's `drawFrame` loop is the thing under test — R2.2's
   own visual-language work, not anything Capacitor-specific).

## Consequences

- `apps/client/android/` is committed (standard practice for Capacitor apps — the native project
  can carry manifest/permission/icon customizations that aren't purely regeneratable from `cap
  sync`), minus its own `.gitignore`'d build artifacts (`.gradle/`, `build/`, copied web assets,
  generated config JSON) — Capacitor's own scaffolded `.gitignore` already handles this correctly.
- The `cap:sync` script (`apps/client/package.json`) is there for whoever picks this up next; it
  was run once manually to prove the web-asset-copy step works, but isn't wired into `pnpm run ci`
  since the Gradle steps after it can't complete in this environment anyway.
