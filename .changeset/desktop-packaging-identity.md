---
"@aimcub/desktop": patch
---

Fix the packaged app's bundle id to match the App Store Connect registration (`com.jensonchow.aimcub`), add a placeholder Aimcub app icon, and wire hardened-runtime entitlements plus an inert (env-gated) notarization hook. Local unsigned packing is unchanged; signing/notarization now activate automatically once real Developer ID credentials are supplied.
