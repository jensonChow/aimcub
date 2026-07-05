import type { ReactNode } from "react";

import { C, card } from "./styles";

interface NoticeProps {
  tone: "info" | "error";
  children: ReactNode;
}

export function Notice({ tone, children }: NoticeProps) {
  const bg = tone === "error" ? C.dangerBg : C.accentBg;
  const fg = tone === "error" ? C.danger : C.accent;
  return <div className="od-notice" style={{ ...card(), background: bg, color: fg, fontSize: 14 }}>{children}</div>;
}
