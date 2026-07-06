import { useI18n, type Lang } from "./i18n";
import { C, TYPE } from "./styles";

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
            background: lang === l ? C.accent : C.surface,
            color: lang === l ? C.accentOn : C.muted,
            fontSize: TYPE.meta,
            cursor: "pointer",
          }}
        >
          {l === "en" ? "EN" : "中"}
        </button>
      ))}
    </div>
  );
}
