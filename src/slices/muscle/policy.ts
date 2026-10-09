/**
 * Muscle-synthesis policy (Proposal 05, Pillar I + the recorded amendment):
 * pure detection of repeated command sequences — import-free so `node --test`
 * (strip-types) can exercise it directly.
 *
 * The shadow worker may only PROPOSE: a detected repetition becomes a staged
 * draft; curation (turning it into a runnable skill fact) is always the
 * operator's action through the review modal.
 */

/** A normalized command: "cmd first-arg" (shape, not exact values). */
export type NormalizedCommand = string;

/** Commands that never belong in a routine (interactive / one-off / destructive). */
const EXCLUDED = new Set([
  "git push",
  "git pull",
  "git reset",
  "git rebase",
  "git checkout",
  "rm",
  "rmdir",
  "del",
  "sudo",
  "npm publish",
  "cargo publish",
  "pi install",
]);

/** Normalizes a raw command line to its repeatable shape. */
export function normalizeCommand(raw: string): string | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const shape = tokens.slice(0, 2).join(" ").toLowerCase();
  if (EXCLUDED.has(shape) || EXCLUDED.has(tokens[0].toLowerCase())) return undefined;
  return shape;
}

/** Routine-name slug from a sequence: kebab-case of the distinct words. */
export function routineName(sequence: NormalizedCommand[]): string {
  const words: string[] = [];
  for (const cmd of sequence) {
    for (const word of cmd.split(/\s+/)) {
      if (!words.includes(word)) words.push(word);
    }
  }
  return words.slice(0, 3).join("-");
}

export interface RepetitionHit {
  sequence: NormalizedCommand[];
  occurrences: number;
  name: string;
  /** The raw command lines of the last occurrence (for the proposal body). */
  rawLines: string[];
}

/**
 * Finds the FIRST repeated 3-step subsequence in the recent history.
 * Occurrences must be non-overlapping; 2 occurrences of the same shape count.
 */
export function detectRepeatedSequence(
  history: NormalizedCommand[],
  rawLines: string[],
  window = 30,
  minLength = 3,
  minOccurrences = 2,
): RepetitionHit | undefined {
  const recent = history.slice(-window);
  const recentRaw = rawLines.slice(-window);

  for (let start = 0; start + minLength <= recent.length; start++) {
    const candidate = recent.slice(start, start + minLength);
    if (candidate.every((c) => c === candidate[0])) continue; // same command thrice is not a sequence

    let occurrences = 0;
    let consumed = -1;
    const occurrenceStarts: number[] = [];
    for (let i = 0; i + minLength <= recent.length; i++) {
      if (i <= consumed) continue;
      if (recent.slice(i, i + minLength).join("→") === candidate.join("→")) {
        occurrences += 1;
        occurrenceStarts.push(i);
        consumed = i + minLength - 1;
      }
    }

    if (occurrences >= minOccurrences) {
      const raw = occurrenceStarts
        .flatMap((s) => recentRaw.slice(s, s + minLength))
        .filter(Boolean);
      return {
        sequence: candidate,
        occurrences,
        name: routineName(candidate),
        rawLines: raw,
      };
    }
  }
  return undefined;
}

/** Builds the staged-proposal payload for a detected repetition. */
export function buildRoutineProposal(hit: RepetitionHit): {
  title: string;
  body: string;
  template: string;
  tags: string[];
} {
  const steps = hit.rawLines
    .slice(-hit.sequence.length * hit.occurrences)
    .slice(0, hit.sequence.length)
    .map((line) => {
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      return { command: tokens[0], args: tokens.slice(1), label: line.trim().slice(0, 60) };
    });

  const title = `muscle:${hit.name}`;
  const body =
    `### Context\nThe same ${hit.sequence.length}-command sequence was observed ` +
    `${hit.occurrences}× in this session (shadow-worker repetition detection).\n\n` +
    `### Steps\n${hit.rawLines.map((l) => `- ${l}`).join("\n")}\n\n` +
    `### Rule\nRun the sequence as one motor chunk with \`uma muscle run ${hit.name} --confirm\`.`;

  return {
    title,
    body,
    template: JSON.stringify(steps),
    tags: ["muscle", "routine", "routine-proposal", "shadow-worker"],
  };
}