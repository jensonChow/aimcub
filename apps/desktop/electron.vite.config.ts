import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// The @core/* packages export raw TypeScript (./src/index.ts), so they must be BUNDLED
// from source into the main/preload bundles, not externalized. @anthropic-ai/sdk (a Node
// lib) stays external — it is a real dependency available in node_modules at runtime.
const bundleFromSource = ["@core/llm", "@core/store", "@core/domain", "@core/types"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundleFromSource })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundleFromSource })],
  },
  renderer: {
    plugins: [react()],
  },
});
