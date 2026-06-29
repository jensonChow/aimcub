/**
 * @ui/tokens — platform-agnostic design tokens (color/spacing/radius/font size).
 * Cross-platform visual consistency comes from shared tokens, not component reuse
 * (web uses DOM, iOS uses RN).
 */
export const colors = {
  bg: "#0f1115",
  surface: "#171a21",
  text: "#e7e9ee",
  textMuted: "#9aa3b2",
  primary: "#7c5cff",
  success: "#39d98a",
  warning: "#ffb020",
  danger: "#ff5c5c",
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 40 } as const;
export const fontWeight = { regular: 400, medium: 500, bold: 700 } as const;

export const tokens = { colors, space, radius, fontSize, fontWeight } as const;
export type Tokens = typeof tokens;
