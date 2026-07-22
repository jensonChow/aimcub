// Diagnostic helper for macOS notarization credentials — run it by hand to see
// whether `pnpm --filter @app/desktop run dist` would attempt notarization, and
// which credential path it would use, without actually invoking electron-builder.
//
// Desktop packaging does NOT run a custom afterSign/notarize script. Instead,
// apps/desktop/package.json's "build.mac.notarize" stays `true`, which wires
// electron-builder's built-in @electron/notarize integration (confirmed present
// in the installed electron-builder@26.15.3 — see
// app-builder-lib/out/mac/MacTargetHelper.js's notarizeIfProvided /
// getNotarizeOptions). That built-in step only runs after a REAL codesign
// (mac.identity must be a real Developer ID identity, not null — see
// MacPackager.sign(): a null identity returns early via handleNullIdentity()
// and never reaches notarizeIfProvided at all), and only attempts notarization
// if one of these env-var sets is present at pack/dist time:
//
//   1. APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
//      (Apple's recommended App Store Connect API key auth)
//   2. APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//      (this project's team: K9XA27TP7F)
//   3. APPLE_KEYCHAIN_PROFILE (+ optional APPLE_KEYCHAIN)
//
// With none of these set — today's state, and every local/CI run until the
// founder supplies real credentials — electron-builder logs "skipped macOS
// code signing" and never reaches the notarize step. Signing and notarization
// are inert by construction (mac.identity: null short-circuits before either
// runs), not by an extra guard this script maintains by hand.
//
// Usage:
//   node apps/desktop/scripts/check-notarize-env.mjs
//
// Supplying real credentials is founder-owned; this script only reports what
// is already in the environment.
import process from "node:process";

function describePath() {
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, APPLE_KEYCHAIN_PROFILE, APPLE_KEYCHAIN } =
    process.env;

  if (APPLE_API_KEY || APPLE_API_KEY_ID || APPLE_API_ISSUER) {
    const missing = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].filter(name => !process.env[name]);
    if (missing.length > 0) return { ready: false, reason: `partial App Store Connect API key credentials — missing ${missing.join(", ")}` };
    return { ready: true, reason: "App Store Connect API key credentials present" };
  }

  if (APPLE_ID || APPLE_APP_SPECIFIC_PASSWORD) {
    const missing = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].filter(name => !process.env[name]);
    if (missing.length > 0) return { ready: false, reason: `partial Apple ID credentials — missing ${missing.join(", ")}` };
    const teamNote = APPLE_TEAM_ID === "K9XA27TP7F" ? "" : ` (warning: APPLE_TEAM_ID=${APPLE_TEAM_ID}, expected K9XA27TP7F)`;
    return { ready: true, reason: `Apple ID + app-specific-password credentials present${teamNote}` };
  }

  if (APPLE_KEYCHAIN_PROFILE) {
    return { ready: true, reason: `keychain profile "${APPLE_KEYCHAIN_PROFILE}"${APPLE_KEYCHAIN ? ` in keychain "${APPLE_KEYCHAIN}"` : ""}` };
  }

  return { ready: false, reason: "no notarization credentials found in the environment" };
}

const { ready, reason } = describePath();
process.stdout.write(`${ready ? "notarization would be ATTEMPTED" : "notarization would be SKIPPED"}: ${reason}\n`);
if (!ready) {
  process.stdout.write("This is expected for local/CI unsigned packing. See this file's header for the three supported credential sets.\n");
}
process.stdout.write(
  "Note: none of this matters unless mac.identity in apps/desktop/package.json is also a real Developer ID identity — it is null today, which skips signing (and therefore notarization) entirely regardless of env vars.\n",
);
