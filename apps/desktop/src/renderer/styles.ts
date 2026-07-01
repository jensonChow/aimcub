import type { CSSProperties } from "react";

export const C = {
  text: "#1a1a19",
  muted: "#6b6a65",
  border: "#e3e1d9",
  accent: "#3266ad",
  accentBg: "#eef3fb",
  surface: "#ffffff",
  page: "#faf9f6",
  danger: "#a32d2d",
};

export function card(): CSSProperties {
  return { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 18px", marginBottom: 12 };
}

export function labelStyle(): CSSProperties {
  return { display: "block", fontSize: 13, color: C.muted, marginBottom: 6 };
}

export function inputStyle(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff", color: C.text };
}

export function primaryButton(disabled: boolean): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: "none", background: disabled ? "#b9c6d8" : C.accent, color: "#fff", fontSize: 14, fontWeight: 500, cursor: disabled ? "default" : "pointer" };
}

export function secondaryButton(): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.text, fontSize: 14, cursor: "pointer" };
}

export function optionButton(selected: boolean): CSSProperties {
  return { flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: C.text, cursor: "pointer" };
}

export function scopeButton(selected: boolean): CSSProperties {
  return { padding: "6px 10px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: selected ? C.accent : C.muted, fontSize: 12, cursor: "pointer" };
}

export function chipButton(): CSSProperties {
  return { padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontSize: 12, cursor: "pointer" };
}

export function linkButton(): CSSProperties {
  return { border: "none", background: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: 0 };
}
