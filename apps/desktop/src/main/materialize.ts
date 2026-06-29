/**
 * `materialize` now lives in the shared `@core/store` package (so the desktop and the CLI
 * share one implementation). This thin re-export preserves existing import sites.
 */
export { materialize } from "@core/store";
