/**
 * @core/domain — the single source of logic shared across all four clients (pure TS, zero platform dependencies).
 * Re-exports the domain types so consumers can import everything from one place.
 */
export * from "@core/types";

export * from "./glob";
export * from "./evaluate";
export * from "./plan";
export * from "./plan-quality";
export * from "./plan-handoff";
export * from "./evidence";
export * from "./context";
export * from "./context-capture";
export * from "./context-intake-progress";
export * from "./context-sedimentation";
export * from "./context-lineage";
export * from "./aim-intake";
export * from "./aim-learning";
export * from "./decomposition-learning";
export * from "./aim-os";
