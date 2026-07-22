/**
 * `materialize` now lives in the shared `@aimcub/store` package (so the desktop and the CLI
 * share one implementation). This thin re-export preserves existing import sites.
 */
export { materialize } from "@aimcub/store";
