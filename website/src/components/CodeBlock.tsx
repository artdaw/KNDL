import { useEffect, useState } from "react";
import styles from "./CodeBlock.module.css";

/** Applies KNDL syntax highlighting to a code string. Returns HTML. */
export function highlightKNDL(code: string): string {
  return code
    .replace(
      /\b(node|edge|intent|type|query|context|match|where|return|emit|do|trigger|optional|cron|import|export|from|and|or|not|in|overlaps|within|aggregate|sum|avg|min|max|count|group)\b/g,
      '<span class="kw">$1</span>'
    )
    .replace(/::\s*(\w+)/g, ':: <span class="tp">$1</span>')
    .replace(/(~[\w:]+)/g, '<span class="cf">$1</span>')
    .replace(/(@[\w.]+)/g, '<span class="id">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="st">$1</span>')
    .replace(/(\/\/[^\n]*)/g, '<span class="cm">$1</span>')
    .replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, '<span class="num">$1</span>')
    .replace(/(-\[[\w]+\]->|<->|->)/g, '<span class="op">$1</span>')
    .replace(/(✓)/g, '<span class="kw">$1</span>');
}

interface Props {
  code: string;
  label?: string;
  animate?: boolean;
  speed?: number;
  maxHeight?: number;
}

export default function CodeBlock({
  code,
  label,
  animate = false,
  speed = 8,
  maxHeight = 480,
}: Props) {
  const [displayed, setDisplayed] = useState(animate ? "" : code);
  const [done, setDone] = useState(!animate);

  useEffect(() => {
    if (!animate) {
      setDisplayed(code);
      setDone(true);
      return;
    }
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(code.slice(0, i));
      if (i >= code.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(id);
  }, [code, animate, speed]);

  return (
    <div className={styles.block} style={{ maxHeight }}>
      {label && <span className={styles.label}>{label}</span>}
      <pre
        className={styles.pre}
        dangerouslySetInnerHTML={{ __html: highlightKNDL(displayed) }}
      />
      {!done && (
        <span className={styles.cursor} aria-hidden />
      )}
    </div>
  );
}
