/**
 * Full KNDL Specification page — renders spec/SPECIFICATION.md with a sticky
 * TOC sidebar, syntax-highlighted code blocks, and formatted tables.
 */

import { useState, useEffect, useRef } from "react";
import specText from "../../../spec/SPECIFICATION.md?raw";
import {
  parseMarkdown,
  extractToc,
  BlockRenderer,
} from "../utils/mdRenderer";
import type { TocEntry } from "../utils/mdRenderer";
import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./SpecFullPage.module.css";

// ── Parse once at module level ────────────────────────────────────────────────

const BLOCKS = parseMarkdown(specText);
const TOC = extractToc(BLOCKS);
const TOC_IDS = TOC.map((e) => e.id);

// ── TOC sidebar ───────────────────────────────────────────────────────────────

function Toc({
  entries,
  activeId,
}: {
  entries: TocEntry[];
  activeId: string;
}) {
  return (
    <nav className={styles.toc} aria-label="Table of contents">
      <div className={styles.tocTitle}>Contents</div>
      <ul className={styles.tocList}>
        {entries.map((e) => (
          <li
            key={e.id}
            className={`${styles.tocItem} ${
              e.level === 3 ? styles.tocSub : ""
            } ${activeId === e.id ? styles.tocActive : ""}`}
          >
            <a href={`#${e.id}`} className={styles.tocLink}>
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Active heading tracker ────────────────────────────────────────────────────

function useActiveHeading(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    const callback: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActive(entry.target.id);
          break;
        }
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: "-80px 0px -70% 0px",
      threshold: 0,
    });

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [ids]);

  return active;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SpecFullPage() {
  const activeId = useActiveHeading(TOC_IDS);

  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Specification v1.0 — Full Reference"
        description="Full KNDL v1.0 specification: lexical structure, type system (Quantity, Money, Vector, Frame, Code, Localized), core constructs, query language with multi-hop paths, processes, uncertainty model, serialization (text + binary), and conformance levels. Raw markdown available at /spec/SPECIFICATION.md."
        path="/spec/full"
        type="article"
        dateModified="2026-04-23"
        keywords="KNDL spec v1.0, EBNF grammar, knowledge graph, agent memory, semantic data, confidence, provenance"
        jsonLd={techArticleSchema({
          headline: "KNDL Language Specification v1.0",
          description:
            "Complete reference for the Knowledge Node Description Language version 1.0.",
          path: "/spec/full",
          dateModified: "2026-04-23",
        })}
      />
      {/* Page header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>KNDL</span>
            <h1 className={styles.title}>Language Specification</h1>
            <span className={styles.version}>v1.0.0 · April 2026</span>
          </div>
          <div className={styles.headerActions}>
            <a
              className={styles.rawLink}
              href="/spec/SPECIFICATION.md"
            >
              Raw Markdown ↗
            </a>
            <a
              className={styles.rawLink}
              href="/spec/kndl.ebnf"
            >
              EBNF Grammar ↗
            </a>
          </div>
        </div>
      </header>

      <div className={styles.layout}>
        {/* Sticky TOC */}
        <aside className={styles.sidebar}>
          <Toc entries={TOC} activeId={activeId} />
        </aside>

        {/* Main content */}
        <main className={styles.content}>
          {BLOCKS.map((block, i) => (
            <BlockRenderer key={i} block={block} styles={styles} />
          ))}
        </main>
      </div>
    </div>
  );
}
