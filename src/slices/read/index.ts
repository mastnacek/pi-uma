import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionState } from "../../shared/types.js";
import { executeUma } from "../../shared/client.js";

export function registerReadTool(pi: ExtensionAPI, _state: ExtensionState): void {
  pi.registerTool({
    name: "uma_read",
    label: "UMA Read",
    description: "Read a complete fact from UMA memory by its ULID identifier.",
    parameters: Type.Object({
      id: Type.String({ description: "The ULID identifier of the fact." }),
      resolveSpai: Type.Optional(
        Type.Boolean({
          description:
            "Also resolve SPAI-NNN references (spai field + body mentions) against the live docs/spai backlog and append each item's current status and title.",
        })
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const args = ["read", params.id];
      if (params.resolveSpai) args.push("--resolve-spai");
      return executeUma(ctx.cwd, args);
    },
  });
}
