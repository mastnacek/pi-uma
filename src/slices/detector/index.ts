/**
 * UMA Detector & Status HUD slice.
 *
 * Provides a live, width-safe status display above the status line / below the editor,
 * plus a footer badge showing UMA engine version, active modules, and store scope.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { findUmaBinary, runUma } from "../../shared/client.js";
import type { ExtensionState } from "../../shared/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface UmaProbeState {
  version: string;
  binaryType: "bundled" | "local" | "system" | "missing";
  contractsCount: number;
  factsCount: number;
  draftsCount: number;
  projectScope: string;
}

let cachedProbe: UmaProbeState | undefined;
let lastProbeTime = 0;
const PROBE_TTL_MS = 15_000;

export async function probeUma(cwd: string, force = false): Promise<UmaProbeState> {
  const now = Date.now();
  if (!force && cachedProbe && now - lastProbeTime < PROBE_TTL_MS) {
    return cachedProbe;
  }

  const binPath = findUmaBinary(cwd);
  let binaryType: UmaProbeState["binaryType"] = "missing";
  let version = "unknown";

  if (fs.existsSync(binPath)) {
    if (binPath.includes("bin" + path.sep + "uma")) {
      binaryType = "bundled";
    } else if (binPath.includes("target")) {
      binaryType = "local";
    } else {
      binaryType = "system";
    }

    try {
      const res = await runUma(binPath, ["--version"], cwd);
      if (res.code === 0 && res.stdout) {
        version = res.stdout.trim().replace(/^uma\s*/i, "v");
      }
    } catch {
      version = "v0.1.0";
    }
  }

  let contractsCount = 0;
  const contractsDir = path.join(cwd, ".uma", "contracts");
  if (fs.existsSync(contractsDir)) {
    try {
      const files = fs.readdirSync(contractsDir);
      contractsCount = files.filter((f) => f.endsWith(".yml") && f !== "sgconfig.yml").length;
    } catch {
      // ignore
    }
  }

  let factsCount = 0;
  const umaDir = path.join(cwd, ".uma");
  if (fs.existsSync(umaDir)) {
    try {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== "contracts" && entry.name !== ".staging") {
            walk(path.join(dir, entry.name));
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            factsCount++;
          }
        }
      };
      walk(umaDir);
    } catch {
      // ignore
    }
  }

  let draftsCount = 0;
  const stagingDir = path.join(cwd, ".uma", ".staging");
  if (fs.existsSync(stagingDir)) {
    try {
      const files = fs.readdirSync(stagingDir);
      draftsCount = files.filter((f) => f.endsWith(".json")).length;
    } catch {
      // ignore
    }
  }

  const projectName = path.basename(cwd) || "project";

  cachedProbe = {
    version,
    binaryType,
    contractsCount,
    factsCount,
    draftsCount,
    projectScope: `project:${projectName}`,
  };
  lastProbeTime = now;
  return cachedProbe;
}

export function formatDetectorLine(
  probe: UmaProbeState,
  state: ExtensionState,
  maxWidth: number,
): string {
  const statusEmoji = probe.binaryType !== "missing" ? "🧠" : "⚠️";
  const binLabel = probe.binaryType !== "missing" ? `online:${probe.binaryType}` : "missing";

  const immuneLabel = `🛡️ immune:${state.config.immuneMode}${probe.contractsCount > 0 ? ` (${probe.contractsCount} contract)` : ""}`;
  const recallLabel = `⚡ recall:${state.config.recallGate ? `on [${state.config.fastbrainJudge}]` : "off"}`;
  const gateLabel = `🔒 gate:${state.config.autoApprove ? "auto" : "modal"}`;
  const storeLabel = `📁 ${probe.projectScope} (${probe.factsCount} facts)`;
  const blockingDebts = (state.debts ?? []).filter((d) => d.blocking).length;
  const debtLabel = blockingDebts > 0 ? `📋 ${blockingDebts} debt(s)` : undefined;
  const draftsLabel = probe.draftsCount > 0 ? `✦ ${probe.draftsCount} draft(s)` : undefined;

  const parts = [
    `${statusEmoji} UMA ${probe.version} [${binLabel}]`,
    immuneLabel,
    recallLabel,
    gateLabel,
    storeLabel,
  ];
  if (debtLabel) {
    parts.push(debtLabel);
  }
  if (draftsLabel) {
    parts.push(draftsLabel);
  }

  const raw = parts.join(" │ ");
  if (visibleWidth(raw) <= maxWidth) {
    return raw;
  }

  const compactParts = [
    `${statusEmoji} UMA ${probe.version}`,
    `🛡️ ${state.config.immuneMode} (${probe.contractsCount}c)`,
    `⚡ ${state.config.recallGate ? "on" : "off"}`,
    `📁 ${probe.factsCount} facts`,
  ];
  const compactRaw = compactParts.join(" │ ");
  return truncateToWidth(compactRaw, Math.max(10, maxWidth));
}

export async function refreshDetector(
  ctx: ExtensionContext,
  state: ExtensionState,
  force = false,
): Promise<void> {
  if (!ctx.hasUI) return;

  if (state.config.hud === false) {
    ctx.ui.setWidget("uma-detector", undefined);
    ctx.ui.setStatus("uma", undefined);
    return;
  }

  const probe = await probeUma(ctx.cwd, force);

  const footerBadge = `🧠 UMA ${probe.version} [${state.config.immuneMode}]${probe.draftsCount > 0 ? ` · ✦ ${probe.draftsCount} draft(s)` : ""}`;
  ctx.ui.setStatus("uma", footerBadge);

  if (ctx.mode === "tui") {
    ctx.ui.setWidget(
      "uma-detector",
      (tui, widgetTheme) => ({
        render(width: number): string[] {
          const line = formatDetectorLine(probe, state, width);
          return [widgetTheme.fg("muted", line)];
        },
        invalidate(): void {},
      }),
      { placement: "belowEditor" },
    );
  } else {
    ctx.ui.setWidget("uma-detector", [formatDetectorLine(probe, state, 120)], { placement: "belowEditor" });
  }
}

export function registerDetector(pi: ExtensionAPI, state: ExtensionState): () => void {
  state.refreshDetector = (ctx, force) => refreshDetector(ctx, state, force);

  const unsub1 = pi.on("session_start", (_event, ctx) => {
    void refreshDetector(ctx, state, true);
  });

  const unsub2 = pi.on("turn_end", (_event, ctx) => {
    void refreshDetector(ctx, state, false);
  });

  pi.on("session_shutdown", () => {
    cachedProbe = undefined;
  });

  return () => {
    unsub1();
    unsub2();
  };
}
