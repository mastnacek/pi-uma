/**
 * Shadow Worker: zero-latency background telemetry mining (Proposal 02).
 *
 * Monitors behavioral inflection points (compiler/test recoveries, user corrections,
 * dependency additions) and creates non-blocking draft candidates in `.uma/.staging/<ULID>.json`.
 * Never interrupts active turns; updates the status HUD with `✦ N drafts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../../shared/types.js";
import { findUmaBinary, runUma } from "../../shared/client.js";

interface CommandFailure {
  command: string;
  output: string;
  timestamp: number;
}

let lastCommandFailure: CommandFailure | null = null;
const FAILURE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isTestOrBuildCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  return (
    lower.includes("cargo test") ||
    lower.includes("cargo build") ||
    lower.includes("npm test") ||
    lower.includes("npm run build") ||
    lower.includes("pytest") ||
    lower.includes("go test") ||
    lower.includes("tsc")
  );
}

function extractCommandOutput(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null) {
    const res = result as Record<string, unknown>;
    if (typeof res.output === "string") return res.output;
    if (typeof res.stderr === "string") return res.stderr;
    if (Array.isArray(res.content)) {
      return res.content
        .map((c) => (typeof c === "object" && c !== null ? String((c as Record<string, unknown>).text || "") : ""))
        .join("\n");
    }
  }
  return "";
}

function detectUserCorrection(text: string): boolean {
  const lower = text.toLowerCase();
  const markers = [
    "takhle ne",
    "nepouzivej",
    "nepoužívej",
    "spatne",
    "špatně",
    "chyba",
    "tam ne",
    "don't use",
    "do not use",
    "never use",
    "instead of",
    "that's wrong",
    "thats wrong",
    "you should not",
  ];
  return markers.some((m) => lower.includes(m));
}

export async function createStagedDraft(
  cwd: string,
  draft: {
    type: string;
    title: string;
    body: string;
    trigger: string;
    confidence?: number;
    tags?: string[];
  },
): Promise<boolean> {
  try {
    const binPath = findUmaBinary(cwd);
    const args = [
      "staging",
      "create",
      "--type",
      draft.type,
      "--title",
      draft.title,
      "--body",
      draft.body,
      "--trigger",
      draft.trigger,
      "--confidence",
      String(draft.confidence ?? 0.85),
    ];
    if (draft.tags && draft.tags.length > 0) {
      args.push("--tags", draft.tags.join(","));
    }
    const res = await runUma(binPath, args, cwd);
    return res.code === 0;
  } catch {
    return false;
  }
}

export async function distillTelemetry(
  cwd: string,
  trigger: string,
  context: string,
  judge: string,
): Promise<boolean> {
  try {
    const binPath = findUmaBinary(cwd);
    const args = [
      "staging",
      "distill",
      "--trigger",
      trigger,
      "--context",
      context,
      "--judge",
      judge === "off" ? "off" : "jev",
      "--json",
    ];
    const res = await runUma(binPath, args, cwd);
    if (res.code === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout) as { id?: string; durable?: boolean };
      return parsed.durable !== false && Boolean(parsed.id);
    }
    return false;
  } catch {
    return false;
  }
}

export function registerShadowWorker(pi: ExtensionAPI, state: ExtensionState): () => void {
  const judge = () => (state.config.fastbrainJudge === "off" ? "off" : "jev");

  const unsub1 = pi.on("tool_result", async (event, ctx) => {
    // 1. Telemetry on command execution: compiler / test recovery
    if (event.toolName === "bash") {
      const input = event.input as Record<string, unknown> | undefined;
      const cmd = typeof input?.command === "string" ? input.command : "";
      if (!isTestOrBuildCommand(cmd)) return;

      const output = extractCommandOutput(event.content);
      const isError =
        event.isError ||
        output.toLowerCase().includes("failed") ||
        output.toLowerCase().includes("error[e") ||
        output.toLowerCase().includes("err!");

      const now = Date.now();

      if (isError) {
        lastCommandFailure = {
          command: cmd,
          output: output.slice(0, 500),
          timestamp: now,
        };
      } else if (lastCommandFailure && now - lastCommandFailure.timestamp < FAILURE_TTL_MS) {
        // Recovery detected: a prior failure was followed by a successful run!
        const prev = lastCommandFailure;
        lastCommandFailure = null;

        const context =
          `Command \`${prev.command}\` initially failed:\n${prev.output.trim()}\n\nSubsequent command succeeded: \`${cmd}\`.`;

        void distillTelemetry(ctx.cwd, "compiler_recovery", context, judge()).then((created) => {
          if (created) {
            void state.refreshDetector?.(ctx, true);
          }
        });
      }
    }

    // 2. Dependency changes in Cargo.toml or package.json
    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as Record<string, unknown> | undefined;
      const filePath = typeof input?.path === "string" ? input.path : "";
      if (filePath.endsWith("Cargo.toml") || filePath.endsWith("package.json")) {
        const addedText = typeof input?.content === "string" ? input.content : "";
        if (addedText.includes("dependencies") || event.toolName === "edit") {
          const context = `File: ${filePath}\nModified dependencies:\n${addedText.slice(0, 300)}`;

          void distillTelemetry(ctx.cwd, "dependency_change", context, judge()).then((created) => {
            if (created) {
              void state.refreshDetector?.(ctx, true);
            }
          });
        }
      }
    }
  });

  const unsub2 = pi.on("turn_end", async (_event, ctx) => {
    // 3. User correction detection
    const messages = ctx.sessionManager.getBranch();
    const lastUserTurn = [...messages]
      .reverse()
      .find((m) => m.type === "message" && "role" in m.message && m.message.role === "user");
    if (!lastUserTurn || lastUserTurn.type !== "message") return;

    const rawMsg = lastUserTurn.message as Record<string, unknown>;
    const userText =
      typeof rawMsg.content === "string"
        ? rawMsg.content
        : Array.isArray(rawMsg.content)
          ? rawMsg.content
              .map((c: unknown) =>
                typeof c === "object" && c !== null ? String((c as Record<string, unknown>).text || "") : "",
              )
              .join(" ")
          : "";

    if (userText && detectUserCorrection(userText) && userText.length < 300) {
      void distillTelemetry(ctx.cwd, "user_correction", userText.trim(), judge()).then((created) => {
        if (created) {
          void state.refreshDetector?.(ctx, true);
        }
      });
    }
  });

  return () => {
    unsub1();
    unsub2();
  };
}
