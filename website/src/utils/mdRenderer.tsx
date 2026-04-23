/**
 * Minimal Markdown-to-React renderer used for the KNDL Specification page.
 * Handles: headings, fenced code blocks, tables, lists, blockquotes, HR, paragraphs.
 * Inline: **bold**, *italic*, `code`.
 */

import type { ReactNode } from "react";
import { highlightKNDL } from "../components/CodeBlock";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Block =
  | { kind: "h1"; text: string; id: string }
  | { kind: "h2"; text: string; id: string }
  | { kind: "h3"; text: string; id: string }
  | { kind: "h4"; text: string; id: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "blockquote"; text: string }
  | { kind: "hr" }
  | { kind: "paragraph"; text: string };

export interface TocEntry {
  level: 2 | 3;
  text: string;
  id: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseCells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

// ── Block tokeniser ───────────────────────────────────────────────────────────

export function parseMarkdown(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Heading
    const hm = trimmed.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      const level = hm[1].length;
      const text = hm[2].trim();
      const id = slugify(text);
      if (level === 1) blocks.push({ kind: "h1", text, id });
      else if (level === 2) blocks.push({ kind: "h2", text, id });
      else if (level === 3) blocks.push({ kind: "h3", text, id });
      else blocks.push({ kind: "h4", text, id });
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ kind: "code", lang, text: codeLines.join("\n").trimEnd() });
      continue;
    }

    // Horizontal rule (--- or ***)
    if (trimmed.match(/^[-*]{3,}$/)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        qLines.push(lines[i].replace(/^[ \t]*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", text: qLines.join("\n") });
      continue;
    }

    // Table (next line must be a separator row)
    if (
      trimmed.startsWith("|") &&
      i + 1 < lines.length &&
      lines[i + 1].match(/^\|?[-: |]+\|/)
    ) {
      const headers = parseCells(trimmed);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseCells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Ordered list
    if (trimmed.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^\d+\.\s/)) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    // Unordered list
    if (trimmed.match(/^[-*+]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^[-*+]\s/)) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    // Paragraph — accumulate lines until a block boundary
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (
        t.match(/^#{1,4}\s/) ||
        t.startsWith("```") ||
        t.match(/^[-*]{3,}$/) ||
        t.startsWith(">") ||
        t.startsWith("|") ||
        t.match(/^\d+\.\s/) ||
        t.match(/^[-*+]\s/)
      ) break;
      paraLines.push(t);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

// ── TOC extraction ────────────────────────────────────────────────────────────

export function extractToc(blocks: Block[]): TocEntry[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "h2" | "h3" }> =>
      b.kind === "h2" || b.kind === "h3"
    )
    .map((b) => ({ level: b.kind === "h2" ? 2 : 3, text: b.text, id: b.id } as TocEntry));
}

// ── Inline renderer ───────────────────────────────────────────────────────────

export function renderInline(
  text: string,
  icClass: string
): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={key++}>{m[2]}</em>);
    else if (m[3] !== undefined)
      parts.push(<code key={key++} className={icClass}>{m[3]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Block renderer ────────────────────────────────────────────────────────────

interface BlockRendererProps {
  block: Block;
  styles: Record<string, string>;
}

export function BlockRenderer({ block, styles }: BlockRendererProps) {
  const ri = (t: string) => renderInline(t, styles.ic ?? "ic");

  switch (block.kind) {
    case "h1":
      return <h1 id={block.id} className={styles.h1}>{ri(block.text)}</h1>;
    case "h2":
      return <h2 id={block.id} className={styles.h2}>{ri(block.text)}</h2>;
    case "h3":
      return <h3 id={block.id} className={styles.h3}>{ri(block.text)}</h3>;
    case "h4":
      return <h4 id={block.id} className={styles.h4}>{ri(block.text)}</h4>;

    case "code": {
      const isKndl = block.lang === "kndl" || block.lang === "";
      return (
        <div className={styles.codeBlock}>
          {block.lang && (
            <span className={styles.codeLang}>{block.lang || "kndl"}</span>
          )}
          <pre
            className={styles.codePre}
            dangerouslySetInnerHTML={{
              __html: isKndl
                ? highlightKNDL(block.text)
                : escapeHtml(block.text),
            }}
          />
        </div>
      );
    }

    case "table":
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.headers.map((h, j) => (
                  <th key={j}>{ri(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri2) => (
                <tr key={ri2}>
                  {row.map((cell, j) => (
                    <td key={j}>{ri(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "list":
      return block.ordered ? (
        <ol className={styles.ol}>
          {block.items.map((item, j) => (
            <li key={j}>{ri(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className={styles.ul}>
          {block.items.map((item, j) => (
            <li key={j}>{ri(item)}</li>
          ))}
        </ul>
      );

    case "blockquote":
      return (
        <blockquote className={styles.bq}>
          {ri(block.text)}
        </blockquote>
      );

    case "hr":
      return <hr className={styles.hr} />;

    case "paragraph":
      return <p className={styles.p}>{ri(block.text)}</p>;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
