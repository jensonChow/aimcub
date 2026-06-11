import { colors, radius, space } from "@ui/tokens";
import type { Notification } from "@core/types";

/** Deterministic UTC stamp (server-rendered; avoids locale-dependent output). */
function formatTimestamp(iso?: string): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "";
}

/**
 * Minimal in-app notification surface: the pet's recent persona messages with timestamps.
 * Server-rendered from the data port; renders nothing while the inbox is empty.
 */
export function NotificationsPanel({ notifications }: { notifications: Notification[] }) {
  if (notifications.length === 0) return null;

  return (
    <section style={{ marginTop: space.xl }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: space.sm, fontSize: 16, marginBottom: space.sm }}>
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ flex: "0 0 auto" }}>
          <path
            d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5a.7.7 0 0 0 .6 1.1h9.6a.7.7 0 0 0 .6-1.1L12 8.1V5.5a4 4 0 0 0-4-4Z"
            fill="none"
            stroke={colors.textMuted}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" fill="none" stroke={colors.textMuted} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        From your pet
        <span style={{ color: colors.textMuted, fontSize: 12, fontWeight: 400 }}>
          {notifications.length}
        </span>
      </h2>

      <ul style={{ display: "flex", flexDirection: "column", gap: space.sm, margin: 0, padding: 0 }}>
        {notifications.map((n) => (
          <li
            key={n.id}
            style={{
              listStyle: "none",
              background: colors.surface,
              border: "1px solid #232733",
              borderRadius: radius.md,
              padding: space.md,
            }}
          >
            <p style={{ margin: 0, fontSize: 14 }}>{n.persona_msg}</p>
            <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 12 }}>
              {formatTimestamp(n.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
