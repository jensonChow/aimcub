/**
 * Desktop persistence = the shared `@aimcub/store` (one JSON store under ~/.aimcub that the
 * CLI also reads). Provider settings (settings.json) ALSO live in `@aimcub/store` now, so the
 * desktop app and the CLI (`aim setup` / `aim config`) read+write one provider config — the
 * same "two faces over one store" idea as the aims. No Electron userData path and no business
 * logic here; this module just picks the local store + re-exports the settings helpers.
 */
import { DEFAULT_OWNER, createJsonFileStore, defaultDataDir, type AimStore } from "@aimcub/store";

/** Fixed local owner for the single-user local app. */
export const LOCAL_OWNER = DEFAULT_OWNER;

/** The shared aim store (aims/milestones/memories), rooted at ~/.aimcub (or $AIMCUB_HOME). */
export const aimStore: AimStore = createJsonFileStore(defaultDataDir());

/**
 * Provider settings persistence (settings.json) lives in `@aimcub/store`, shared with the CLI.
 * `@aimcub/store`'s `ProviderSettings` is structurally the desktop's `ProviderConfig`.
 */
export {
  loadContextSourceSettings,
  loadSettings,
  loadWebResearchSettings,
  saveContextSourceSettings,
  saveSettings,
  saveWebResearchSettings,
} from "@aimcub/store";
