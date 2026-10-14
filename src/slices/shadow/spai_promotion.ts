/**
 * SPAI → UMA promotion policy (SPAI-037, Tier 3).
 *
 * Pure: no pi imports, no I/O — tested by `test/spai_promotion.test.ts`.
 *
 * The shadow worker observes a SPAI item reaching `done` and *stages* a fact
 * proposal; the operator curates it through `/uma review`. Information flows
 * task → knowledge only: nothing here writes a fact, and a draft that is never
 * approved leaves no trace in the store. SPAI stays the volatile work ledger.
 */

export const SPAI_PROMOTION_TRIGGER = "spai_done";

/**
 * Confidence handed to `uma staging create`. Deliberately below the shadow
 * worker's 0.85 default: *finishing* a task is no evidence that its text has
 * become a durable fact. The operator's review is the deciding step, and a low
 * number keeps the draft visibly weaker than a telemetry-derived one.
 */
export const SPAI_PROMOTION_CONFIDENCE = 0.7;

/** The record shape the pi-spai tools place in `tool_result.details.record`. */
export interface SpaiRecordLike {
  id?: unknown;
  title?: unknown;
  body?: unknown;
  tags?: unknown;
}

export interface PromotionDraft {
  type: string;
  title: string;
  body: string;
  trigger: string;
  confidence: number;
  tags: string[];
  spai: string[];
}

/** True only for a `update_spai_status` call that lands the item on `done`. */
export function isSpaiCompletion(
  toolName: string,
  input: Record<string, unknown> | undefined,
): boolean {
  if (toolName !== "update_spai_status") return false;
  return typeof input?.status === "string" && input.status.toLowerCase() === "done";
}

/**
 * First SPAI id mentioned in a text (the status response names the item),
 * canonicalized to `SPAI-NNN` so padding can never create two identities.
 */
export function spaiIdFromText(text: string): string | null {
  const match = text.match(/SPAI-(\d+)/i);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  if (Number.isNaN(number)) return null;
  return `SPAI-${String(number).padStart(3, "0")}`;
}

/**
 * Canonical `SPAI-NNN` form of an id, or `null` when the value is not one.
 * `SPAI-7` and `spai-007` mean the same item; padding must never create a second
 * identity.
 */
export function canonicalizeSpaiId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^SPAI-(\d+)$/i);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  if (Number.isNaN(number)) return null;
  return `SPAI-${String(number).padStart(3, "0")}`;
}

/**
 * True for an id-shaped value. `record.id` comes from the pi-spai index and is
 * trusted only after this shape check — a malformed id must not become a
 * provenance reference.
 */
export function isCanonicalSpaiId(value: unknown): value is string {
  return canonicalizeSpaiId(value) !== null;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

/**
 * Tidies a raw SPAI line for review: drops the leading status marker and the
 * metadata tokens (`@project`, `!priority`, `:tags:`) — mirroring what the Rust
 * parser in pi-spai consumes.
 *
 * Faithful rather than aggressive: pi-spai reads the **first** token per category
 * and every tag block. Anything beyond that is prose and is left alone, because
 * over-stripping would silently delete content the operator never reviewed. The
 * parser stays the source of truth for *storage*; this is a readability aid for a
 * candidate body the operator is about to edit.
 */
export function cleanTaskText(raw: string): string {
  let text = raw.trim();
  // Leading status marker: ". ", "/ ", "/. ", "x ", "X ", "z ", "Z ", "? ", "- ", "# "
  text = text.replace(/^(?:\/\.|[./xzXZ?#-])\s+/, "");
  text = text
    // Every tag block (pi-spai accumulates them all).
    .replace(/(?:^|\s):[A-Za-z0-9_./-]+(?::[A-Za-z0-9_./-]+)*:(?=\s|$)/g, " ")
    // First priority token only.
    .replace(/(?:^|\s)!(?:high|low|medium)?(?=\s|$)/i, " ")
    // First quoted project, then a date-shaped token, then the first bare project.
    .replace(/(?:^|\s)@"[^"\n]+"/, " ")
    .replace(/(?:^|\s)@\d{4}-\d{2}-\d{2}(?=\s|$)/, " ")
    .replace(/(?:^|\s)@[A-Za-z0-9_./:\\-]+(?=\s|$)/, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text;
}

/** All ids referenced by a promotion draft, in order, de-duplicated. */
export function promotionSpaiIds(draft: PromotionDraft): string[] {
  return Array.from(new Set(draft.spai));
}

/**
 * Builds the staged proposal for a completed item.
 *
 * Returns `null` when no usable id exists — a promotion without provenance is
 * not worth staging, because the link back to the task is the whole point.
 */
export function buildPromotionDraft(
  record: SpaiRecordLike | undefined,
  fallbackId: string | null,
): PromotionDraft | null {
  const recordId = canonicalizeSpaiId(record?.id);
  const id = recordId ?? canonicalizeSpaiId(fallbackId);
  if (!id) return null;

  const title = asText(record?.title) ?? `Completed ${id}`;
  const rawBody = asText(record?.body) ?? title;
  const evidence = cleanTaskText(rawBody);

  return {
    type: "note",
    title,
    body: `Completed ${id} — ${title}\n\nTask text (evidence):\n${evidence}`,
    trigger: SPAI_PROMOTION_TRIGGER,
    confidence: SPAI_PROMOTION_CONFIDENCE,
    tags: Array.from(new Set([...asTags(record?.tags), "spai"])),
    spai: [id],
  };
}

/**
 * In-session dedupe: one proposal per completed item. Re-marking an item `done`
 * (a second call, a retried tool call) must not stage a second draft.
 */
export class PromotionLedger {
  private readonly seen = new Set<string>();

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    this.seen.add(id);
  }

  size(): number {
    return this.seen.size;
  }
}
