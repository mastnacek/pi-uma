import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Word-wraps text into lines that do not exceed `maxWidth`.
 * Preserves explicit newlines and breaks long words if necessary.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];

  for (const rawLine of text.split("\n")) {
    if (rawLine.trim().length === 0) {
      lines.push("");
      continue;
    }

    const words = rawLine.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;

      if (currentLine.length === 0) {
        if (visibleWidth(word) <= maxWidth) {
          currentLine = word;
        } else {
          let rem = word;
          while (visibleWidth(rem) > maxWidth) {
            lines.push(rem.slice(0, maxWidth));
            rem = rem.slice(maxWidth);
          }
          currentLine = rem;
        }
      } else if (visibleWidth(currentLine + " " + word) <= maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        if (visibleWidth(word) <= maxWidth) {
          currentLine = word;
        } else {
          let rem = word;
          while (visibleWidth(rem) > maxWidth) {
            lines.push(rem.slice(0, maxWidth));
            rem = rem.slice(maxWidth);
          }
          currentLine = rem;
        }
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  return lines;
}
