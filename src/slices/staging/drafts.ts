import * as fs from "node:fs";
import * as path from "node:path";

export interface StagedDraftRecord {
  id: string;
  status: string;
  confidence: number;
  provenance: {
    session_id?: string;
    trigger_type: string;
    context?: string;
  };
  fact: {
    id: string;
    scope: unknown;
    fact_type: string;
    title: string;
    body: string;
    tags: string[];
  };
}

export function readStagedDraftsFromDisk(cwd: string): StagedDraftRecord[] {
  const stagingDir = path.join(cwd, ".uma", ".staging");
  if (!fs.existsSync(stagingDir)) return [];

  const drafts: StagedDraftRecord[] = [];
  try {
    for (const file of fs.readdirSync(stagingDir)) {
      if (file.endsWith(".json")) {
        try {
          const content = fs.readFileSync(path.join(stagingDir, file), "utf-8");
          drafts.push(JSON.parse(content));
        } catch {
          // ignore corrupted draft
        }
      }
    }
  } catch {
    return [];
  }
  return drafts;
}
