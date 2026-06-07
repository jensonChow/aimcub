import type { ReactNode } from "react";
import { colors, fontSize } from "@ui/tokens";

export const metadata = {
  title: "GoalPet",
  description: "照常干活,宠物替你记录每一次真实进展。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
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
