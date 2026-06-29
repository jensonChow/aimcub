/**
 * Tiny i18n for the desktop renderer. English is the source-of-truth; `zh` is a
 * translation locale. No dependency — a flat dictionary + a context + a `t()` helper.
 * Default locale follows the OS language and the last choice is remembered (localStorage).
 *
 * Keys, code, and comments stay English (per the project rule); only the `zh` VALUES are
 * Chinese, which is inherent to bilingual UI. `summarizeRule` (acceptance-rule text) is a
 * derived technical expression and is intentionally left English for now.
 */
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "zh";

/** Source-of-truth string table. Add a key here, reference it via `t(...)`. */
export const STRINGS = {
  "provider.setup": { en: "Set up a provider", zh: "设置模型提供方" },
  "provider.anthropicShort": { en: "Anthropic", zh: "Anthropic" },
  "provider.openaiShort": { en: "OpenAI-compatible", zh: "OpenAI 兼容" },

  "common.delete": { en: "Delete", zh: "删除" },
  "common.cancel": { en: "Cancel", zh: "取消" },
  "common.back": { en: "← Back", zh: "← 返回" },
  "common.close": { en: "Close", zh: "关闭" },
  "common.milestone_one": { en: "{n} milestone", zh: "{n} 个里程碑" },
  "common.milestone_other": { en: "{n} milestones", zh: "{n} 个里程碑" },

  "home.aim_one": { en: "{n} aim", zh: "{n} 个目标" },
  "home.aim_other": { en: "{n} aims", zh: "{n} 个目标" },
  "home.none": { en: "No aims yet.", zh: "还没有目标。" },
  "home.new": { en: "+ New aim", zh: "+ 新目标" },
  "home.emptyHelp": {
    en: "Set an aim and Aimcub breaks it into verifiable milestones. Start with “+ New aim”.",
    zh: "设定一个目标,Aimcub 会把它拆成可验证的里程碑。点「+ 新目标」开始。",
  },

  "aim.titleLabel": { en: "What do you want to accomplish?", zh: "你想达成什么?" },
  "aim.titlePlaceholder": { en: "e.g. Build a CLI todo app with tests + CI", zh: "例如:做一个带测试和 CI 的命令行待办应用" },
  "aim.descLabel": { en: "A little more context (optional)", zh: "补充一点背景(可选)" },
  "aim.descPlaceholder": { en: "Constraints, scope, anything that shapes the plan.", zh: "约束、范围,任何会影响计划的信息。" },
  "aim.draft": { en: "Draft a plan →", zh: "生成计划 →" },
  "aim.needProvider": { en: "Set up an LLM provider above to generate a plan.", zh: "先在上方设置模型提供方才能生成计划。" },

  "status.drafting": { en: "Sketching a first-pass plan…", zh: "正在起草初版计划…" },
  "status.refining": { en: "Refining with your answers…", zh: "正在根据你的回答优化…" },

  "q.intro": { en: "A rough plan is ready. Answer a couple of questions to sharpen it.", zh: "初步计划已就绪。回答几个问题让它更精准。" },
  "q.none": { en: "No clarifying questions — the plan is ready.", zh: "没有需要澄清的问题——计划已就绪。" },
  "q.other": { en: "Something else…", zh: "其他…" },
  "q.assuming": { en: "Assuming (change anything that's wrong above):", zh: "默认假设(上方有不对的可以改):" },
  "q.refine": { en: "Refine plan →", zh: "优化计划 →" },
  "q.useDraft": { en: "Use the draft as-is", zh: "直接用初稿" },

  "plan.summary_one": { en: "{n} milestone · it lights up when its acceptance rule is met.", zh: "{n} 个里程碑 · 满足验收规则时点亮。" },
  "plan.summary_other": { en: "{n} milestones · each lights up when its acceptance rule is met.", zh: "{n} 个里程碑 · 每个在满足验收规则时点亮。" },
  "plan.saved": { en: "✓ Saved locally", zh: "✓ 已保存到本地" },
  "plan.backToAims": { en: "Back to aims", zh: "返回目标列表" },
  "plan.save": { en: "Save plan", zh: "保存计划" },
  "plan.startOver": { en: "Start over", zh: "重新开始" },

  "saved.count_one": { en: "{n} milestone.", zh: "{n} 个里程碑。" },
  "saved.count_other": { en: "{n} milestones.", zh: "{n} 个里程碑。" },
  "saved.noPlan": { en: "This aim has no stored plan.", zh: "该目标没有已保存的计划。" },

  "pf.title": { en: "LLM provider", zh: "模型提供方" },
  "pf.blurb": {
    en: "Your key stays on this Mac — it never leaves the main process. No offline templates; real decomposition only.",
    zh: "你的密钥只留在这台 Mac——永不离开主进程。没有离线模板,只做真实拆解。",
  },
  "pf.providerLabel": { en: "Provider", zh: "提供方" },
  "pf.anthropic": { en: "Anthropic (Claude)", zh: "Anthropic(Claude)" },
  "pf.openai": { en: "OpenAI-compatible", zh: "OpenAI 兼容" },
  "pf.anthropicDesc": { en: "Native Claude API.", zh: "原生 Claude API。" },
  "pf.openaiDesc": { en: "OpenRouter, DeepSeek, Qwen, local Ollama/vLLM…", zh: "OpenRouter、DeepSeek、Qwen、本地 Ollama/vLLM…" },
  "pf.baseUrl": { en: "Base URL (optional)", zh: "Base URL(可选)" },
  "pf.useOpenRouter": { en: "Use OpenRouter", zh: "用 OpenRouter" },
  "pf.baseUrlPlaceholder": { en: "https://api.openai.com/v1 (default)", zh: "https://api.openai.com/v1(默认)" },
  "pf.model": { en: "Model", zh: "模型" },
  "pf.modelPlaceholder": { en: "e.g. deepseek/deepseek-chat or anthropic/claude-sonnet-4", zh: "例如 deepseek/deepseek-chat 或 anthropic/claude-sonnet-4" },
  "pf.apiKey": { en: "API key", zh: "API 密钥" },
  "pf.keyKeep": { en: "•••• leave blank to keep current key", zh: "•••• 留空则保留当前密钥" },
  "pf.notUsableKey": { en: "That config isn't usable yet — check the key.", zh: "该配置还不可用——检查密钥。" },
  "pf.notUsableKeyModel": { en: "That config isn't usable yet — check the key and model.", zh: "该配置还不可用——检查密钥和模型。" },
  "pf.saving": { en: "Saving…", zh: "保存中…" },
  "pf.saveProvider": { en: "Save provider", zh: "保存提供方" },

  "err.draft": { en: "could not draft a plan", zh: "无法生成计划" },
  "err.clarify": { en: "couldn't generate clarifying questions — the draft is still usable", zh: "无法生成澄清问题——初稿仍可用" },
  "err.refine": { en: "couldn't refine the plan — try again or use the draft as-is", zh: "无法优化计划——重试或直接用初稿" },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: StringKey, vars?: Vars): string {
  const entry = STRINGS[key];
  return interpolate(entry[lang] ?? entry.en, vars);
}

const STORAGE_KEY = "aimcub.lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
    return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore (private mode / no storage)
  }
}

export interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export function I18nProvider(props: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
  }, []);
  const t = useCallback((key: StringKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{props.children}</I18nContext.Provider>;
}
