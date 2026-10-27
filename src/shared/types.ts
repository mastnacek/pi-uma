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

export interface PlasticityDefinition {
  weight: number;
  reinforcements: number;
  frustrations: number;
  last_activated?: string;
  half_life_days: number;
}

export interface SaliencyDefinition {
  shock_level: number;
  multiplier: number;
  immune_to_decay: boolean;
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
  /** Synaptic plasticity metadata (Proposal 03b / Hebbian fitness weight & decay). */
  plasticity?: PlasticityDefinition;
  /** Saliency & emotional valence (Proposal 05a / decay immunity). */
  saliency?: SaliencyDefinition;
  /** ISO 8601 date/timestamp after which the claim needs re-verification. */
  stale_after?: string;
  /** ISO 8601 date/timestamp when the claim started to hold (imports). */
  since?: string;
  /** SPAI backlog item IDs this fact is linked to (e.g. ["SPAI-035"]). Cross-reference only. */
  spai?: string[];
  /** Domain tags restricting recall to projects that declare matching domains (e.g. ["domino"]). */
  domains?: string[];
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
  /** Humility gate: ask before mutating a flagged low-familiarity subsystem. */
  humilityGate: boolean;
  /** Append active UMA rules to system prompt (via systemPromptOptions.sections.uma_rules). */
  appendPrompt: boolean;
}

export interface ExtensionState {
  config: PluginConfig;
  globalConfigFile: string;
  unsubscribers: Array<() => void>;
  refreshDetector?: (ctx: any, force?: boolean) => Promise<void>;
  /** Session-scoped Prospective Debt Ledger (Proposal 04, Pillar III). */
  debts?: Array<{
    id: string;
    sourceAction: string;
    requiredAction: string;
    blocking: boolean;
    createdAt: number;
  }>;
  /** Flagged low-familiarity subsystems (Proposal 04, Pillar IV). */
  humilityFlags?: Array<{
    dir: string;
    flaggedAt: number;
    confirmed: boolean;
    hypothesis?: string;
    reads: string[];
  }>;
  /**
   * Fact IDs already injected into THIS session's context.
   * Re-injecting a fact the model already has is pure token waste — the
   * injected message persists in the transcript for the whole session.
   * Restored from the branch's uma-recall entries on session_start
   * (survives reload/resume); cleared on compaction, because after a
   * compaction the context may no longer hold the facts and re-injection
   * becomes useful again.
   */
  injectedFactIds?: Set<string>;
  /** Rolling command history for muscle-synthesis repetition detection. */
  muscleHistory?: { shapes: string[]; raw: string[] };
  /** Sequence keys already proposed this session (one proposal per sequence). */
  muscleProposed?: string[];
  /** Routine names from the last detector probe (muscle run/list completions). */
  muscleRoutineNames?: string[];
  /** Browser dashboard control surface wired by the dash slice (Proposal 10).
   *  The commands slice calls these to dispatch `/uma dash [stop]` without
   *  importing the dash slice (VSA: slices never import slices). */
  dash?: {
    /** Starts (or reuses) the loopback server and opens the browser; returns the token URL.
     *  The command context is used once, to build a model-access-only translation
     *  environment for per-card display translation. */
    start: (cwd: string, ctx?: unknown) => Promise<string>;
    /** Closes the server if running. */
    stop: () => Promise<void>;
    isRunning: () => boolean;
  };
}
