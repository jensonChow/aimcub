import type { CSSProperties } from "react";

export const C = {
  text: "var(--od-fg, #1d1d1f)",
  muted: "var(--od-muted, #6e6e73)",
  border: "var(--od-border-soft, #e8e8ed)",
  accent: "var(--od-accent, #0071e3)",
  accentBg: "color-mix(in oklab, var(--od-accent, #0071e3), var(--od-bg, #ffffff) 92%)",
  surface: "var(--od-bg, #ffffff)",
  page: "var(--od-surface, #f5f5f7)",
  danger: "var(--od-danger, #dc2626)",
};

export function card(): CSSProperties {
  return {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    boxShadow: "none",
    padding: "16px 18px",
    marginBottom: 12,
  };
}

export function labelStyle(): CSSProperties {
  return { display: "block", fontSize: 13, color: C.muted, marginBottom: 6 };
}

export function inputStyle(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: C.surface, color: C.text };
}

export function primaryButton(disabled: boolean): CSSProperties {
  return { marginTop: 16, minHeight: 40, padding: "0 16px", borderRadius: 999, border: "none", background: disabled ? "#aeb8bf" : C.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: disabled ? "default" : "pointer", boxShadow: "none" };
}

export function secondaryButton(): CSSProperties {
  return { marginTop: 16, minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, fontWeight: 650, cursor: "pointer" };
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
