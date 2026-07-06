import type { CSSProperties } from "react";

export const C = {
  text: "var(--od-fg, #1d1d1f)",
  muted: "var(--od-muted, #6e6e73)",
  meta: "var(--od-meta, #86868b)",
  border: "var(--od-border-soft, #e8e8ed)",
  borderStrong: "var(--od-border, #d2d2d7)",
  accent: "var(--od-accent, #0071e3)",
  accentOn: "var(--od-accent-on, #ffffff)",
  accentBg: "color-mix(in oklab, var(--od-accent, #0071e3), var(--od-bg, #ffffff) 92%)",
  accentHover: "var(--od-accent-hover, #0077ed)",
  surface: "var(--od-bg, #ffffff)",
  page: "var(--od-surface, #f5f5f7)",
  surfaceWarm: "var(--od-surface-warm, #fbfbfd)",
  disabledBg: "var(--od-disabled-bg, #aeb8bf)",
  disabledText: "var(--od-disabled-fg, #ffffff)",
  success: "var(--od-success-fg, #1a7f4b)",
  successBg: "color-mix(in oklab, var(--od-success, #16a34a), var(--od-bg, #ffffff) 94%)",
  warn: "var(--od-warn-fg, #8a6517)",
  warnBg: "color-mix(in oklab, var(--od-warn, #b7791f), var(--od-bg, #ffffff) 94%)",
  warnBorder: "color-mix(in oklab, var(--od-warn, #b7791f), var(--od-bg, #ffffff) 72%)",
  danger: "var(--od-danger, #dc2626)",
  dangerBg: "color-mix(in oklab, var(--od-danger, #dc2626), var(--od-bg, #ffffff) 94%)",
  dangerBorder: "color-mix(in oklab, var(--od-danger, #dc2626), var(--od-bg, #ffffff) 76%)",
};

export const TYPE = {
  meta: "var(--od-type-meta, 12px)",
  body: "var(--od-type-body, 13px)",
  title: "var(--od-type-title, 16px)",
} as const;

export const WEIGHT = {
  regular: "var(--od-font-weight-regular, 400)",
  medium: "var(--od-font-weight-medium, 400)",
  semibold: "var(--od-font-weight-semibold, 450)",
  strong: "var(--od-font-weight-strong, 500)",
} as const;

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
  return { display: "block", fontSize: TYPE.body, color: C.muted, marginBottom: 6 };
}

export function inputStyle(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: TYPE.body, fontFamily: "inherit", background: C.surface, color: C.text };
}

export function primaryButton(disabled: boolean): CSSProperties {
  return { marginTop: 16, minHeight: 40, padding: "0 16px", borderRadius: 999, border: "none", background: disabled ? C.disabledBg : C.accent, color: disabled ? C.disabledText : C.accentOn, fontSize: TYPE.body, fontWeight: WEIGHT.strong, cursor: disabled ? "default" : "pointer", boxShadow: "none" };
}

export function secondaryButton(): CSSProperties {
  return { marginTop: 16, minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: TYPE.body, fontWeight: WEIGHT.semibold, cursor: "pointer" };
}

export function optionButton(selected: boolean): CSSProperties {
  return { flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : C.surface, color: C.text, cursor: "pointer" };
}

export function scopeButton(selected: boolean): CSSProperties {
  return { padding: "6px 10px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : C.surface, color: selected ? C.accent : C.muted, fontSize: TYPE.meta, cursor: "pointer" };
}

export function chipButton(): CSSProperties {
  return { padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: TYPE.meta, cursor: "pointer" };
}

export function linkButton(): CSSProperties {
  return { border: "none", background: "none", color: C.accent, fontSize: TYPE.meta, cursor: "pointer", padding: 0 };
}
