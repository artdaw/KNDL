import { useEffect, useState } from "react";
import styles from "./CodeBlock.module.css";

const KEYWORDS = new Set([
  'node','edge','intent','type','query','context','process','state',
  'match','where','return','emit','do','trigger','optional','cron',
  'import','export','from','and','or','not','in','on','goto',
  'overlaps','within','aggregate','sum','avg','min','max','count','group',
]);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls: string, s: string): string {
  return `<span class="${cls}">${esc(s)}</span>`;
}

/** Applies KNDL syntax highlighting via a single-pass tokenizer. Returns HTML. */
export function highlightKNDL(code: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    // line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const s = end === -1 ? code.slice(i) : code.slice(i, end);
      out.push(span('cm', s));
      i += s.length;
      continue;
    }
    // string literal
    if (code[i] === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== '"') { if (code[j] === '\\') j++; j++; }
      j++;
      out.push(span('st', code.slice(i, j)));
      i = j;
      continue;
    }
    // meta annotation ~key
    if (code[i] === '~') {
      let j = i + 1;
      while (j < code.length && /[\w:]/.test(code[j])) j++;
      out.push(span('cf', code.slice(i, j)));
      i = j;
      continue;
    }
    // node ref @name
    if (code[i] === '@') {
      let j = i + 1;
      while (j < code.length && /[\w.]/.test(code[j])) j++;
      out.push(span('id', code.slice(i, j)));
      i = j;
      continue;
    }
    // typed arrows -[T]-> <->
    if (code[i] === '-' && code[i + 1] === '[') {
      const m = code.slice(i).match(/^-\[\w+\]->/);
      if (m) { out.push(span('op', m[0])); i += m[0].length; continue; }
    }
    if (code[i] === '<' && code[i + 1] === '-' && code[i + 2] === '>') {
      out.push(span('op', '<->')); i += 3; continue;
    }
    if (code[i] === '-' && code[i + 1] === '>') {
      out.push(span('op', '->')); i += 2; continue;
    }
    // :: TypeName
    if (code[i] === ':' && code[i + 1] === ':') {
      let j = i + 2;
      while (j < code.length && code[j] === ' ') j++;
      const ts = j;
      while (j < code.length && /\w/.test(code[j])) j++;
      out.push(':: ');
      if (j > ts) out.push(span('tp', code.slice(ts, j)));
      i = j;
      continue;
    }
    // keyword or identifier
    if (/[a-zA-Z_]/.test(code[i])) {
      let j = i;
      while (j < code.length && /\w/.test(code[j])) j++;
      const w = code.slice(i, j);
      out.push(KEYWORDS.has(w) ? span('kw', w) : esc(w));
      i = j;
      continue;
    }
    // number
    if (/\d/.test(code[i])) {
      let j = i;
      while (j < code.length && /[\d.]/.test(code[j])) j++;
      out.push(span('num', code.slice(i, j)));
      i = j;
      continue;
    }
    // ✓
    if (code[i] === '✓') { out.push(span('kw', '✓')); i++; continue; }
    // plain character
    out.push(esc(code[i]));
    i++;
  }
  return out.join('');
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
