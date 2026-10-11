import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionState } from "../../shared/types.js";
import { commandHelpFor } from "../../shared/command_help.ts";
import { getParameterCompletions } from "./complete_params.ts";

const NON_TERMINAL = new Set([
  "lang",
  "auto-approve",
  "recall",
  "append",
  "judge",
  "immune",
  "hud",
  "export",
  "timeline",
  "list",
  "staging",
  "debt",
  "humility",
  "muscle",
  "skeptic",
]);

export function getUmaCompletions(
  argumentPrefix: string,
  state: ExtensionState
): AutocompleteItem[] {
  const trimmed = argumentPrefix.trimStart();
  const trailingSpace = argumentPrefix.endsWith(" ");
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const normalizedPrefix = trimmed.toLowerCase();

  const currentLang = state.config.lang;
  const currentAuto = state.config.autoApprove;
  const currentGate = state.config.recallGate;
  const currentJudge = state.config.fastbrainJudge;
  const currentHud = state.config.hud !== false;

  const firstToken = tokens[0]?.toLowerCase();
  const atParameterLevel =
    tokens.length > 1 ||
    (trailingSpace && tokens.length === 1) ||
    (tokens.length === 1 && firstToken !== undefined && NON_TERMINAL.has(firstToken));

  // Level 2 & 3: Subcommand parameters and options
  if (atParameterLevel && firstToken) {
    const params = getParameterCompletions(firstToken, state, normalizedPrefix);
    if (params !== null) return params;
    return [];
  }

  // Level 1: Top-level subcommands
  const h = commandHelpFor(state.config.lang);

  const subcommands: AutocompleteItem[] = [
    {
      value: "help",
      label: "❓ help",
      description: h.cmdHelp,
    },
    {
      value: "search ",
      label: "🔍 search",
      description: h.cmdSearch,
    },
    {
      value: "list",
      label: "📋 list",
      description: h.cmdList,
    },
    {
      value: "list global",
      label: "🌐 list global",
      description: h.cmdListGlobal,
    },
    {
      value: "read ",
      label: "📖 read",
      description: h.cmdRead,
    },
    {
      value: "reindex",
      label: "♻️ reindex",
      description: h.cmdReindex,
    },
    {
      value: "timeline",
      label: "🕰️ timeline",
      description: h.cmdTimeline,
    },
    {
      value: "export ",
      label: "📦 export",
      description: h.cmdExport,
    },
    {
      value: "doctor",
      label: "🩺 doctor",
      description: h.cmdDoctor,
    },
    {
      value: "lang ",
      label: `🌐 lang (${currentLang})`,
      description: h.cmdLang(currentLang),
    },
    {
      value: "auto-approve ",
      label: `✅ auto-approve (${currentAuto ? "on" : "off"})`,
      description: h.cmdAutoApprove(currentAuto),
    },
    {
      value: "recall ",
      label: `🧠 recall (${currentGate ? "on" : "off"})`,
      description: h.cmdRecall(currentGate),
    },
    {
      value: "append ",
      label: `📝 append (${state.config.appendPrompt ? "on" : "off"})`,
      description: h.cmdAppend(Boolean(state.config.appendPrompt)),
    },
    {
      value: "judge ",
      label: `⚖️ judge (${currentJudge})`,
      description: h.cmdJudge(currentJudge),
    },
    {
      value: "immune ",
      label: `🛡️ immune (${state.config.immuneMode})`,
      description: h.cmdImmune(state.config.immuneMode),
    },
    {
      value: "hud ",
      label: `📟 hud (${currentHud ? "on" : "off"})`,
      description: h.cmdHud(currentHud),
    },
    {
      value: "review",
      label: "✦ review",
      description: h.cmdReview,
    },
    {
      value: "staging ",
      label: "📥 staging",
      description: h.cmdStaging,
    },
    {
      value: "debt ",
      label: "📋 debt",
      description: h.cmdDebt,
    },
    {
      value: "humility ",
      label: "🧭 humility",
      description: h.cmdHumility,
    },
    {
      value: "muscle ",
      label: "💪 muscle",
      description: h.cmdMuscle,
    },
    {
      value: "skeptic ",
      label: "😈 skeptic",
      description: h.cmdSkeptic,
    },
  ];

  return subcommands.filter((cmd) => cmd.value.toLowerCase().startsWith(normalizedPrefix));
}