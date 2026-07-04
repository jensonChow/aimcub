import type { CSSProperties } from "react";

export const C = {
  text: "#1d1d1f",
  muted: "#6e6e73",
  border: "#d2d2d7",
  accent: "#0071e3",
  accentBg: "#f0f7ff",
  surface: "#ffffff",
  page: "#f5f5f7",
  danger: "#dc2626",
};

export function card(): CSSProperties {
  return {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    boxShadow: "0 1px 2px rgba(28, 26, 22, 0.035)",
    padding: "16px 18px",
    marginBottom: 12,
  };
}

export function labelStyle(): CSSProperties {
  return { display: "block", fontSize: 13, color: C.muted, marginBottom: 6 };
}

export function inputStyle(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: C.surface, color: C.text };
}

export function primaryButton(disabled: boolean): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: "none", background: disabled ? "#aeb8bf" : C.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer", boxShadow: disabled ? "none" : "0 1px 1px rgba(16, 38, 48, 0.16)" };
}

export function secondaryButton(): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, cursor: "pointer" };
}

export function optionButton(selected: boolean): CSSProperties {
  return { flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: C.text, cursor: "pointer" };
}

export function scopeButton(selected: boolean): CSSProperties {
  return { padding: "6px 10px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: selected ? C.accent : C.muted, fontSize: 12, cursor: "pointer" };
}

export function chipButton(): CSSProperties {
  return { padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, cursor: "pointer" };
}

export function linkButton(): CSSProperties {
  return { border: "none", background: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: 0 };
}
