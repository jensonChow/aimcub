import { useI18n, type Lang } from "./i18n";
import { C } from "./styles";

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 999, overflow: "hidden" }}>
      {(["en", "zh"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{
            padding: "5px 10px",
            border: "none",
            background: lang === l ? C.accent : "#fff",
            color: lang === l ? "#fff" : C.muted,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {l === "en" ? "EN" : "中"}
        </button>
      ))}
    </div>
  );
}
