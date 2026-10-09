import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionState } from "../../shared/types.js";

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
  const valid_immune = ["off", "warn", "ask", "auto", "block"] as const;
  const currentJudge = state.config.fastbrainJudge;
  const currentHud = state.config.hud !== false;

  const firstToken = tokens[0]?.toLowerCase();
  const atParameterLevel =
    tokens.length > 1 ||
    (trailingSpace && tokens.length === 1) ||
    (tokens.length === 1 && firstToken !== undefined && NON_TERMINAL.has(firstToken));

  // Level 2 & 3: Subcommand parameters and options
  if (atParameterLevel && firstToken) {
    const sub = firstToken;

    if (sub === "lang") {
      const options: AutocompleteItem[] = [
        {
          value: "lang cs",
          label: currentLang === "cs" ? "cs ✓" : "cs",
          description: currentLang === "cs" ? "Čeština · ● AKTIVNÍ" : "Čeština",
        },
        {
          value: "lang cs --global",
          label: "cs --global",
          description: "Čeština globálně (~/.pi/agent/uma.json)",
        },
        {
          value: "lang en",
          label: currentLang === "en" ? "en ✓" : "en",
          description: currentLang === "en" ? "English · ● ACTIVE" : "English",
        },
        {
          value: "lang en --global",
          label: "en --global",
          description: "English globally (~/.pi/agent/uma.json)",
        },
      ];
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "auto-approve") {
      const options: AutocompleteItem[] = [
        {
          value: "auto-approve on",
          label: currentAuto ? "on ✓" : "on",
          description: currentAuto
            ? "Auto-approve without modal · ● ACTIVE"
            : "Auto-approve without modal (project)",
        },
        {
          value: "auto-approve on --global",
          label: "on --global",
          description: "Auto-approve globally (~/.pi/agent/uma.json)",
        },
        {
          value: "auto-approve off",
          label: !currentAuto ? "off ✓" : "off",
          description: !currentAuto ? "Show review modal · ● ACTIVE" : "Show review modal",
        },
        {
          value: "auto-approve off --global",
          label: "off --global",
          description: "Show review modal globally (~/.pi/agent/uma.json)",
        },
      ];
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "recall") {
      const options: AutocompleteItem[] = [
        {
          value: "recall on",
          label: currentGate ? "on ✓" : "on",
          description: currentGate
            ? "Recall gate injects memory on trigger · ● ACTIVE"
            : "Recall gate on for this project (.pi/uma.json)",
        },
        {
          value: "recall on --global",
          label: "on --global",
          description: "Recall gate ON globally (~/.pi/agent/uma.json)",
        },
        {
          value: "recall off",
          label: !currentGate ? "off ✓" : "off",
          description: !currentGate
            ? "Recall stays explicit (S3 paused) · ● ACTIVE"
            : "Recall stays explicit (project)",
        },
        {
          value: "recall off --global",
          label: "off --global",
          description: "Recall stays explicit globally (~/.pi/agent/uma.json)",
        },
      ];
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "judge") {
      const options: AutocompleteItem[] = [
        {
          value: "judge jev",
          label: currentJudge === "jev" ? "jev ✓" : "jev",
          description:
            currentJudge === "jev"
              ? "Jev via OpenRouter (semantic) · ● ACTIVE"
              : "Jev via OpenRouter (semantic)",
        },
        {
          value: "judge jev --global",
          label: "jev --global",
          description: "Jev judge globally (~/.pi/agent/uma.json)",
        },
        {
          value: "judge off",
          label: currentJudge === "off" ? "off ✓" : "off",
          description:
            currentJudge === "off"
              ? "Offline markers (deterministic) · ● ACTIVE"
              : "Offline markers (deterministic)",
        },
        {
          value: "judge off --global",
          label: "off --global",
          description: "Offline markers globally (~/.pi/agent/uma.json)",
        },
      ];
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "immune") {
      const current = state.config.immuneMode;
      const descriptions: Record<string, string> = {
        off: "Interceptor disabled",
        warn: "Warnings only, never disturbs",
        ask: "Confirm dialog per warning; decline blocks",
        auto: "Block contract violations / ask heuristics",
        block: "Strict block mode for AST contracts",
      };
      const options: AutocompleteItem[] = [];
      for (const m of valid_immune) {
        options.push({
          value: `immune ${m}`,
          label: current === m ? `${m} ✓` : m,
          description: current === m ? `${descriptions[m]} · ● ACTIVE` : descriptions[m],
        });
        options.push({
          value: `immune ${m} --global`,
          label: `${m} --global`,
          description: `${descriptions[m]} globally (~/.pi/agent/uma.json)`,
        });
      }
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "hud") {
      const options: AutocompleteItem[] = [
        {
          value: "hud on",
          label: currentHud ? "on ✓" : "on",
          description: currentHud
            ? "Live detector HUD enabled · ● ACTIVE"
            : "Enable live detector HUD above status line",
        },
        {
          value: "hud on --global",
          label: "on --global",
          description: "Enable detector HUD globally (~/.pi/agent/uma.json)",
        },
        {
          value: "hud off",
          label: !currentHud ? "off ✓" : "off",
          description: !currentHud
            ? "Live detector HUD disabled · ● ACTIVE"
            : "Disable live detector HUD",
        },
        {
          value: "hud off --global",
          label: "off --global",
          description: "Disable detector HUD globally (~/.pi/agent/uma.json)",
        },
      ];
      return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "list") {
      return [
        { value: "list", label: "project", description: "List project memories" },
        { value: "list global", label: "global", description: "List global user memories" },
      ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "timeline") {
      return [
        {
          value: "timeline --all",
          label: "--all",
          description: "Include facts that were never superseded",
        },
        {
          value: "timeline --id ",
          label: "--id <ULID>",
          description: "Show only the chain containing this fact",
        },
      ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "export") {
      return [
        {
          value: "export --out ",
          label: "--out <directory>",
          description: "Write an OKF v0.2 bundle (one Markdown document per fact)",
        },
        {
          value: "export --out . --include-deprecated",
          label: "--include-deprecated",
          description: "Also export superseded revisions",
        },
      ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "staging") {
      return [
        {
          value: "staging review",
          label: "review",
          description: "Launch interactive staging review modal",
        },
        {
          value: "staging list",
          label: "list",
          description: "List staged drafts via CLI",
        },
        {
          value: "staging approve ",
          label: "approve <ID>",
          description: "Approve and promote a staged draft",
        },
        {
          value: "staging discard ",
          label: "discard <ID>",
          description: "Discard and delete a staged draft",
        },
      ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

    if (sub === "doctor") {
      return [
        {
          value: "doctor --json",
          label: "--json",
          description: "Emit the report as JSON",
        },
        {
          value: "doctor --strict",
          label: "--strict",
          description: "Exit non-zero when a check fails",
        },
      ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
    }

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
  ];

  return subcommands.filter((cmd) => cmd.value.toLowerCase().startsWith(normalizedPrefix));
}
