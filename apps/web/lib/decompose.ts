/**
 * The deterministic local decomposer now lives in `@core/llm` (next to `decompose`)
 * so the web app and the desktop app share one offline fallback. This thin re-export
 * preserves existing import sites in the web app.
 */
export { localDecompose } from "@core/llm";
export type { DecomposeRequest } from "@core/llm";
