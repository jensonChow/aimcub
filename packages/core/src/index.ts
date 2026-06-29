/**
 * @core/domain — the single source of logic shared across all four clients (pure TS, zero platform dependencies).
 * Re-exports the domain types so consumers can import everything from one place.
 */
export * from "@core/types";

export * from "./glob";
export * from "./evaluate";
export * from "./plan";
export * from "./evidence";
