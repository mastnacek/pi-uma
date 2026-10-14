/**
 * Pure argv builder for `uma staging create` (SPAI-037 seam).
 *
 * Extracted so the shadow worker's *integration seam* is tested: the previous
 * inline construction typed its parameter without `spai`, so a draft carrying
 * provenance was passed happily and the flag was never sent — `spai: []` in the
 * staged JSON, discovered only by inspecting a real draft. A pure builder plus a
 * test is what makes that class of silent drop impossible here.
 */

export const DEFAULT_DRAFT_CONFIDENCE = 0.85;

export interface StagedDraftRequest {
  type: string;
  title: string;
  body: string;
  trigger: string;
  confidence?: number;
  tags?: string[];
  /** SPAI backlog ids this draft derives from; never dropped silently. */
  spai?: string[];
  template?: string;
}

/** Builds the exact argv passed to the engine, or drops nothing. */
export function buildStagingCreateArgs(draft: StagedDraftRequest): string[] {
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
    String(draft.confidence ?? DEFAULT_DRAFT_CONFIDENCE),
  ];

  if (draft.tags && draft.tags.length > 0) {
    args.push("--tags", draft.tags.join(","));
  }
  // Provenance is the point of a promotion: an empty list means "no reference",
  // which is legitimate, but a non-empty one must always reach the engine.
  if (draft.spai && draft.spai.length > 0) {
    args.push("--spai", draft.spai.join(","));
  }
  if (draft.template) {
    args.push("--template", draft.template);
  }
  return args;
}
