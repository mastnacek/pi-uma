export interface ContractRule {
  pattern: string;
  inside?: string;
  message: string;
  language?: string;
}

export interface ContractDefinition {
  engine: string;
  severity: "deny" | "warn";
  rule: ContractRule;
}

export interface MemoryProposal {
  title: string;
  body: string;
  type: string;
  scope: string;
  tags: string[];
  /** ULID of the fact this proposal replaces, when superseding. */
  supersedes?: string;
  /** Invocation template for `skill` facts. Displayed for review; never executed. */
  template?: string;
  /** Executable AST invariant contract (Proposal 03a). */
  contract?: ContractDefinition;
  /** ISO 8601 date/timestamp after which the claim needs re-verification. */
  stale_after?: string;
  /** ISO 8601 date/timestamp when the claim started to hold (imports). */
  since?: string;
}

export interface ProposalResult {
  action: "approved" | "rejected";
  proposal: MemoryProposal;
}

export interface PluginConfig {
  lang: "cs" | "en";
  autoApprove: boolean;
  /** Fastbrain recall gate (S3 compromise): OFF — recall stays explicit. */
  recallGate: boolean;
  /** Immune interceptor mode: off | warn (default) | ask | auto | block. */
  immuneMode: "off" | "warn" | "ask" | "auto" | "block";
  /** Recall judge transport: "off" (markers) or "jev" (Jev via OpenRouter). */
  fastbrainJudge: "off" | "jev";
  /** Live detector / HUD widget visible above the status line / editor. */
  hud: boolean;
}

export interface ExtensionState {
  config: PluginConfig;
  globalConfigFile: string;
  unsubscribers: Array<() => void>;
  refreshDetector?: (ctx: any, force?: boolean) => Promise<void>;
}
