import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionState } from "../../shared/types.js";
import { getParameterCompletions } from "./complete_params.ts";

const NON_TERMINAL = new Set([
  "lang",
  "auto-approve",
  "recall",
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
  const subcommands: AutocompleteItem[] = [
    {
      value: "search ",
      label: "🔍 search",
      description: "Search memory facts (BM25 keyword search)",
    },
    {
      value: "list",
      label: "📋 list",
      description: "List project memories",
    },
    {
      value: "list global",
      label: "🌐 list global",
      description: "List global user memories",
    },
    {
      value: "read ",
      label: "📖 read",
      description: "Read memory fact details by ID",
    },
    {
      value: "reindex",
      label: "♻️ reindex",
      description: "Rebuild centralized SQLite index from markdown files",
    },
    {
      value: "timeline",
      label: "🕰️ timeline",
      description: "Show how facts evolved (supersession chains)",
    },
    {
      value: "export ",
      label: "📦 export",
      description: "Write memory as a portable OKF bundle",
    },
    {
      value: "doctor",
      label: "🩺 doctor",
      description: "Read-only health report on the store and index",
    },
    {
      value: "lang ",
      label: `🌐 lang (${currentLang})`,
      description: `Switch UI language (current: ${currentLang})`,
    },
    {
      value: "auto-approve ",
      label: `✅ auto-approve (${currentAuto ? "on" : "off"})`,
      description: `Toggle review modal (current: ${currentAuto ? "on" : "off"})`,
    },
    {
      value: "recall ",
      label: `🧠 recall (${currentGate ? "on" : "off"})`,
      description: `Toggle the fastbrain recall gate (current: ${currentGate ? "on" : "off"})`,
    },
    {
      value: "judge ",
      label: `⚖️ judge (${currentJudge})`,
      description: `Recall judge transport (current: ${currentJudge})`,
    },
    {
      value: "immune ",
      label: `🛡️ immune (${state.config.immuneMode})`,
      description: `Immune interceptor mode (off | warn | ask | auto | block; current: ${state.config.immuneMode})`,
    },
    {
      value: "hud ",
      label: `📟 hud (${currentHud ? "on" : "off"})`,
      description: `Toggle status detector HUD widget (current: ${currentHud ? "on" : "off"})`,
    },
    {
      value: "review",
      label: "✦ review",
      description: "Launch interactive review modal for staged drafts",
    },
    {
      value: "staging ",
      label: "📥 staging",
      description: "Manage staged drafts (review | list | approve | discard)",
    },
    {
      value: "debt ",
      label: "📋 debt",
      description: "Prospective Debt Ledger (list | settle <id> | clear)",
    },
    {
      value: "humility ",
      label: "🧭 humility",
      description: "Epistemic-humility gate (on | off [--global])",
    },
    {
      value: "muscle ",
      label: "💪 muscle",
      description: "Procedural routines (list | run <name> [--confirm])",
    },
    {
      value: "skeptic ",
      label: "😈 skeptic",
      description: "Adversarial critique of a risky intent (<intent> [--files a,b] [--off])",
    },
  ];

  return subcommands.filter((cmd) => cmd.value.toLowerCase().startsWith(normalizedPrefix));
}