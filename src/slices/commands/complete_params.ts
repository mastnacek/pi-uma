/**
 * Level-2/3 parameter completions for `/uma <sub> ...` (extracted from
 * complete.ts to keep both files under the 300-line soft target).
 *
 * Follows the pi-plugin-dev trailing-space + lazy-parameter contract and the
 * current-value state annotation rules (✓ in label, ● ACTIVE in description).
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionState } from "../../shared/types.js";
import { commandHelpFor } from "../../shared/command_help.ts";

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
  const currentHumility = state.config.humilityGate;
  const currentImmune = state.config.immuneMode;
  const h = commandHelpFor(state.config.lang);

  if (sub === "lang") {
    const options: AutocompleteItem[] = [
      {
        value: "lang cs",
        label: currentLang === "cs" ? "cs ✓" : "cs",
        description: currentLang === "cs" ? `Čeština${h.selectedMarker}` : "Čeština",
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
        description: `${h.paramAutoApproveOn}${currentAuto ? h.selectedMarker : ""}`,
      },
      {
        value: "auto-approve on --global",
        label: "on --global",
        description: `${h.paramAutoApproveOn}${h.paramGlobalSuffix}`,
      },
      {
        value: "auto-approve off",
        label: !currentAuto ? "off ✓" : "off",
        description: `${h.paramAutoApproveOff}${!currentAuto ? h.selectedMarker : ""}`,
      },
      {
        value: "auto-approve off --global",
        label: "off --global",
        description: `${h.paramAutoApproveOff}${h.paramGlobalSuffix}`,
      },
    ];
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "recall") {
    const options: AutocompleteItem[] = [
      {
        value: "recall on",
        label: currentGate ? "on ✓" : "on",
        description: `${h.paramRecallOn}${currentGate ? h.selectedMarker : ""}`,
      },
      {
        value: "recall on --global",
        label: "on --global",
        description: `${h.paramRecallOn}${h.paramGlobalSuffix}`,
      },
      {
        value: "recall off",
        label: !currentGate ? "off ✓" : "off",
        description: `${h.paramRecallOff}${!currentGate ? h.selectedMarker : ""}`,
      },
      {
        value: "recall off --global",
        label: "off --global",
        description: `${h.paramRecallOff}${h.paramGlobalSuffix}`,
      },
    ];
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "append") {
    const currentAppend = state.config.appendPrompt;
    const options: AutocompleteItem[] = [
      {
        value: "append on",
        label: currentAppend ? "on ✓" : "on",
        description: `${h.paramAppendOn}${currentAppend ? h.selectedMarker : ""}`,
      },
      {
        value: "append on --global",
        label: "on --global",
        description: `${h.paramAppendOn}${h.paramGlobalSuffix}`,
      },
      {
        value: "append off",
        label: !currentAppend ? "off ✓" : "off",
        description: `${h.paramAppendOff}${!currentAppend ? h.selectedMarker : ""}`,
      },
      {
        value: "append off --global",
        label: "off --global",
        description: `${h.paramAppendOff}${h.paramGlobalSuffix}`,
      },
    ];
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "judge") {
    const options: AutocompleteItem[] = [
      {
        value: "judge jev",
        label: currentJudge === "jev" ? "jev ✓" : "jev",
        description: `${h.paramJudgeJev}${currentJudge === "jev" ? h.selectedMarker : ""}`,
      },
      {
        value: "judge jev --global",
        label: "jev --global",
        description: `${h.paramJudgeJev}${h.paramGlobalSuffix}`,
      },
      {
        value: "judge off",
        label: currentJudge === "off" ? "off ✓" : "off",
        description: `${h.paramJudgeOff}${currentJudge === "off" ? h.selectedMarker : ""}`,
      },
      {
        value: "judge off --global",
        label: "off --global",
        description: `${h.paramJudgeOff}${h.paramGlobalSuffix}`,
      },
    ];
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "immune") {
    const current = state.config.immuneMode;
    const descriptions: Record<string, string> = {
      off: h.paramImmuneOff,
      warn: h.paramImmuneWarn,
      ask: h.paramImmuneAsk,
      auto: h.paramImmuneAuto,
      block: h.paramImmuneBlock,
    };
    const options: AutocompleteItem[] = [];
    for (const m of valid_immune) {
      options.push({
        value: `immune ${m}`,
        label: current === m ? `${m} ✓` : m,
        description: current === m ? `${descriptions[m]}${h.selectedMarker}` : descriptions[m],
      });
      options.push({
        value: `immune ${m} --global`,
        label: `${m} --global`,
        description: `${descriptions[m]}${h.paramGlobalSuffix}`,
      });
    }
    return options.filter((o) => o.value.toLowerCase().startsWith(normalizedPrefix));
  }

  if (sub === "hud") {
    const options: AutocompleteItem[] = [
      {
        value: "hud on",
        label: currentHud ? "on ✓" : "on",
        description: `${h.paramHudOn}${currentHud ? h.selectedMarker : ""}`,
      },
      {
        value: "hud on --global",
        label: "on --global",
        description: `${h.paramHudOn}${h.paramGlobalSuffix}`,
      },
      {
        value: "hud off",
        label: !currentHud ? "off ✓" : "off",
        description: `${h.paramHudOff}${!currentHud ? h.selectedMarker : ""}`,
      },
      {
        value: "hud off --global",
        label: "off --global",
        description: `${h.paramHudOff}${h.paramGlobalSuffix}`,
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
        description: `${h.paramHumilityOn}${current ? h.selectedMarker : ""}`,
      },
      {
        value: "humility on --global",
        label: "on --global",
        description: `${h.paramHumilityOn}${h.paramGlobalSuffix}`,
      },
      {
        value: "humility off",
        label: !current ? "off ✓" : "off",
        description: `${h.paramHumilityOff}${!current ? h.selectedMarker : ""}`,
      },
      {
        value: "humility off --global",
        label: "off --global",
        description: `${h.paramHumilityOff}${h.paramGlobalSuffix}`,
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