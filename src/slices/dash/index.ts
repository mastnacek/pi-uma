/**
 * /uma dash slice — composition glue for the browser dashboard (Proposal 10).
 *
 * Owns the server lifecycle for this pi session: `registerDash` starts the
 * loopback HTTP server on first use, exposes start/stop through the shared
 * state (so the commands slice can dispatch `/uma dash [stop]` without
 * importing this slice — VSA: slices never import slices), and returns an
 * unsubscribe that kills the server on session_shutdown. A dashboard must
 * never outlive its pi session.
 *
 * Invariant: read-only. Nothing in this slice writes memory; consent stays
 * in the TUI approval modal.
 */

import { exec } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../../shared/types.js";
import { startDashServer, type DashServer } from "./server.ts";

/** Best-effort browser open; failure just means the operator visits the URL. */
function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {
    /* best effort — the notify already carries the URL */
  });
}

export function registerDash(_pi: ExtensionAPI, state: ExtensionState): () => void {
  let dash: DashServer | undefined;

  const stop = async (): Promise<void> => {
    const running = dash;
    dash = undefined;
    if (running) await running.close();
  };

  // Wired through shared state, not imported by the commands slice: the
  // composition root is the only multi-slice importer (VSA).
  state.dash = {
    /** Idempotent: re-opens the browser on the already-running server. */
    start: async (cwd: string): Promise<string> => {
      if (!dash) dash = await startDashServer(cwd);
      openBrowser(dash.url);
      return dash.url;
    },
    stop,
    isRunning: () => dash !== undefined,
  };

  return () => {
    void stop();
    state.dash = undefined;
  };
}
