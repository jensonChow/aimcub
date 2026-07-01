const COMMANDS = [
  "intake",
  "plan",
  "clarify",
  "new",
  "ls",
  "show",
  "board",
  "confirm",
  "evidence",
  "memories",
  "context",
  "replan",
  "edit",
  "rm",
  "setup",
  "config",
  "doctor",
  "completion",
  "export",
  "import",
] as const;

const EVIDENCE_SUBCOMMANDS = ["add", "report", "ls"] as const;
const CONFIG_SUBCOMMANDS = ["get", "set", "edit"] as const;
const MEMORY_SUBCOMMANDS = ["add", "ls"] as const;
const CONTEXT_SUBCOMMANDS = ["ls", "profile", "review", "candidates", "learning", "health", "accept", "reject", "deprioritize", "archive"] as const;

export type CompletionShell = "bash" | "zsh" | "fish";

export function normalizeShell(raw: string | undefined): CompletionShell {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("fish")) return "fish";
  if (s.includes("zsh")) return "zsh";
  return "bash";
}

export function completionScript(shell: CompletionShell): string {
  const commands = COMMANDS.join(" ");
  const evidence = EVIDENCE_SUBCOMMANDS.join(" ");
  const config = CONFIG_SUBCOMMANDS.join(" ");
  const memories = MEMORY_SUBCOMMANDS.join(" ");
  const context = CONTEXT_SUBCOMMANDS.join(" ");

  if (shell === "fish") {
    return [
      "complete -c aimcub -f",
      `complete -c aimcub -n "__fish_use_subcommand" -a "${commands}"`,
      `complete -c aimcub -n "__fish_seen_subcommand_from evidence" -a "${evidence}"`,
      `complete -c aimcub -n "__fish_seen_subcommand_from memories" -a "${memories}"`,
      `complete -c aimcub -n "__fish_seen_subcommand_from context" -a "${context}"`,
      `complete -c aimcub -n "__fish_seen_subcommand_from config" -a "${config}"`,
      'complete -c aimcub -l json -d "Print machine-readable JSON"',
      'complete -c aimcub -l help -s h -d "Show help"',
    ].join("\n");
  }

  if (shell === "zsh") {
    return [
      "#compdef aimcub",
      "_aimcub() {",
      "  local -a commands evidence config",
      "  local -a memories context",
      `  commands=(${commands})`,
      `  evidence=(${evidence})`,
      `  config=(${config})`,
      `  memories=(${memories})`,
      `  context=(${context})`,
      "  if (( CURRENT == 2 )); then",
      "    _describe 'command' commands",
      "  elif [[ ${words[2]} == evidence ]]; then",
      "    _describe 'evidence command' evidence",
      "  elif [[ ${words[2]} == memories ]]; then",
      "    _describe 'memory command' memories",
      "  elif [[ ${words[2]} == context ]]; then",
      "    _describe 'context command' context",
      "  elif [[ ${words[2]} == config ]]; then",
      "    _describe 'config command' config",
      "  else",
      "    _files",
      "  fi",
      "}",
      "_aimcub \"$@\"",
    ].join("\n");
  }

  return [
    "_aimcub_completions() {",
    "  local cur prev cmd",
    "  COMPREPLY=()",
    "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  prev=\"${COMP_WORDS[COMP_CWORD-1]}\"",
    "  cmd=\"${COMP_WORDS[1]}\"",
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    `    COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )`,
    "  elif [[ $cmd == evidence ]]; then",
    `    COMPREPLY=( $(compgen -W "${evidence}" -- "$cur") )`,
    "  elif [[ $cmd == memories ]]; then",
    `    COMPREPLY=( $(compgen -W "${memories}" -- "$cur") )`,
    "  elif [[ $cmd == context ]]; then",
    `    COMPREPLY=( $(compgen -W "${context}" -- "$cur") )`,
    "  elif [[ $cmd == config ]]; then",
    `    COMPREPLY=( $(compgen -W "${config}" -- "$cur") )`,
    "  fi",
    "}",
    "complete -F _aimcub_completions aimcub",
  ].join("\n");
}
