import type { ReactNode } from "react";
import { colors, fontSize } from "@ui/tokens";

export const metadata = {
  title: "Aimcub",
  description: "Set a goal, watch it break into milestones, and let real evidence light them up.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: colors.bg,
          color: colors.text,
          fontSize: fontSize.md,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
