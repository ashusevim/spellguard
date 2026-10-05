/**
 * Markdown preprocessing: blanks out regions that should not be spell
 * checked, while preserving line numbers and column offsets so results
 * still map onto the original document.
 *
 * Handles: YAML/TOML frontmatter, fenced code blocks (``` and ~~~),
 * inline code spans, and HTML comments (inline and multi-line).
 */

export function stripMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;
  let fenceMarker = "";
  let inComment = false;

  lines.forEach((line, index) => {
    // Frontmatter: from the opening --- until the closing --- line.
    if (inFrontmatter) {
      out.push("");
      if (index > 0 && /^---\s*$/.test(line)) inFrontmatter = false;
      return;
    }

    // Multi-line HTML comments <!-- ... -->
    if (inComment) {
      out.push("");
      if (line.includes("-->")) inComment = false;
      return;
    }

    // Fenced code blocks.
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1];
        out.push("");
        return;
      }
      if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
        out.push("");
        return;
      }
    }
    if (inFence) {
      out.push("");
      return;
    }

    // Inline HTML comment on a single line.
    if (line.trimStart().startsWith("<!--")) {
      if (!line.includes("-->")) {
        inComment = true;
        out.push("");
        return;
      }
    }

    // Inline constructs: blank them at equal length to preserve columns.
    const blanked = line
      .replace(/<!--.*?-->/g, (m) => " ".repeat(m.length))
      .replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    out.push(blanked);
  });

  return out.join("\n");
}
