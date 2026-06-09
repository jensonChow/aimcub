import type { ReactNode } from "react";
import { colors, fontSize } from "@ui/tokens";

export const metadata = {
  title: "GoalPet",
  description: "Keep doing your work, and your pet records every real bit of progress for you.",
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
