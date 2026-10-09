/**
 * Level-2/3 parameter completions for `/uma <sub> ...` (extracted from
 * complete.ts to keep both files under the 300-line soft target).
 *
 * Follows the pi-plugin-dev trailing-space + lazy-parameter contract and the
 * current-value state annotation rules (✓ in label, ● ACTIVE in description).
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionState } from "../../shared/types.js";

const valid_immune = ["off", "warn", "ask", "auto", "block"] as const;

export function getParameterCompletions(
  sub: string,
  state: ExtensionState,
  normalizedPrefix: string,
): AutocompleteItem[] | null {
  const currentLang = state.config.lang;
  const currentAuto = state.config.autoApprove;
  const currentGate = state.config.recallGate;
  const currentJudge = state.config.fastbrainJudge;
  const currentHud = state.config.hud !== false;

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

  if (sub === "humility") {
    const current = state.config.humilityGate;
    const options: AutocompleteItem[] = [
      {
        value: "humility on",
        label: current ? "on ✓" : "on",
        description: current
          ? "Humility gate armed · ● ACTIVE"
          : "Ask before mutating flagged unfamiliar subsystems",
      },
      {
        value: "humility on --global",
        label: "on --global",
        description: "Arm the humility gate globally (~/.pi/agent/uma.json)",
      },
      {
        value: "humility off",
        label: !current ? "off ✓" : "off",
        description: !current
          ? "Humility gate disabled · ● ACTIVE"
          : "Disable the humility confirm gate",
      },
      {
        value: "humility off --global",
        label: "off --global",
        description: "Disable the humility gate globally (~/.pi/agent/uma.json)",
      },
    ];
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "muscle") {
    const knownRoutines = state.muscleRoutineNames ?? [];
    const options: AutocompleteItem[] = [
      { value: "muscle list", label: "list", description: "Show operator-curated routines" },
      {
        value: "muscle run ",
        label: "run",
        description: "Execute a routine (dry-run unless --confirm)",
      },
    ];
    for (const name of knownRoutines) {
      options.push({
        value: `muscle run ${name} `,
        label: `run ${name}`,
        description: "Dry-run by default; add --confirm to execute",
      });
    }
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "skeptic") {
    return [
      {
        value: "skeptic ",
        label: "skeptic <intent>",
        description: "Adversarial critique of a risky intent before executing it",
      },
      {
        value: "skeptic --files ",
        label: "--files <a.rs,b.rs>",
        description: "Attach the files the intent will touch",
      },
      {
        value: "skeptic --off",
        label: "--off",
        description: "Deterministic offline judge (no Jev call)",
      },
    ].filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "debt") {
    const open = state.debts ?? [];
    const options: AutocompleteItem[] = [
      {
        value: "debt list",
        label: `list (${open.length} open)`,
        description: "Show open cognitive debts",
      },
      {
        value: "debt clear",
        label: "clear",
        description: "Clear all debts from this session",
      },
    ];
    for (const d of open) {
      options.push({
        value: `debt settle ${d.id}`,
        label: `settle ${d.id}`,
        description: `${d.blocking ? "[BLOCKING] " : ""}${d.requiredAction.slice(0, 60)}`,
      });
    }
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
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

  return null;
}