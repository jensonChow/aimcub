import { colors, radius, space } from "@ui/tokens";
import { signInAction, signUpAction } from "../auth-actions";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: colors.bg,
  color: colors.text,
  border: "1px solid #232733",
  borderRadius: radius.md,
  padding: "10px 12px",
  fontSize: 15,
};

const labelStyle = { display: "block", fontSize: 13, color: colors.textMuted, marginBottom: 4 };

const buttonStyle = {
  border: "none",
  borderRadius: radius.md,
  padding: "10px 16px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

/** Email + password sign-in / sign-up. Server component; errors arrive via query params. */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: space.xl }}>
      <header style={{ marginBottom: space.lg }}>
        <h1 style={{ color: colors.primary, margin: 0 }}>Aimcub</h1>
        <p style={{ color: colors.textMuted, marginTop: space.xs }}>
          Sign in to set goals and let your progress light them up.
        </p>
      </header>

      {searchParams.error ? (
        <p style={{ color: colors.danger, fontSize: 14 }}>{searchParams.error}</p>
      ) : null}
      {searchParams.notice ? (
        <p style={{ color: colors.success, fontSize: 14 }}>{searchParams.notice}</p>
      ) : null}

      <form style={{ display: "flex", flexDirection: "column", gap: space.md }}>
        <div>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required style={inputStyle} />
        </div>
        <div>
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", gap: space.sm }}>
          <button formAction={signInAction} style={{ ...buttonStyle, background: colors.primary, color: "#fff" }}>
            Sign in
          </button>
          <button
            formAction={signUpAction}
            style={{ ...buttonStyle, background: "transparent", color: colors.primary, border: `1px solid ${colors.primary}` }}
          >
            Sign up
          </button>
        </div>
      </form>
    </main>
  );
}
