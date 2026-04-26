// Syntax highlighter for KNDL .fact.json examples.
// Single-pass tokenizer — no external library.

type Token = { type: string; value: string };

function tokenizeJson(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (/[\s,[\]{}]/.test(src[i])) {
      let v = "";
      while (i < src.length && /[\s,[\]{}]/.test(src[i])) v += src[i++];
      tokens.push({ type: "punct", value: v });
      continue;
    }
    if (src[i] === ":") { tokens.push({ type: "punct", value: src[i++] }); continue; }
    if (src[i] === '"') {
      let v = '"'; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === "\\") v += src[i++]; v += src[i++]; }
      v += '"'; i++;
      // Is this a key or a value?
      let j = i;
      while (j < src.length && src[j] === " ") j++;
      const isKey = src[j] === ":";
      const raw = v.slice(1, -1);
      if (isKey) {
        tokens.push({ type: raw.startsWith("@") ? "at-key" : "key", value: v });
      } else {
        const isUri = raw.startsWith("http") || raw.startsWith("fact:") ||
          raw.startsWith("human://") || raw.startsWith("sensor://") ||
          raw.startsWith("person:") || raw.startsWith("customer:");
        tokens.push({ type: isUri ? "url" : "string", value: v });
      }
      continue;
    }
    if (/[-\d]/.test(src[i])) {
      let v = "";
      while (i < src.length && /[-\d.eE+]/.test(src[i])) v += src[i++];
      tokens.push({ type: "number", value: v });
      continue;
    }
    if (src.startsWith("true",  i)) { tokens.push({ type: "bool", value: "true"  }); i += 4; continue; }
    if (src.startsWith("false", i)) { tokens.push({ type: "bool", value: "false" }); i += 5; continue; }
    if (src.startsWith("null",  i)) { tokens.push({ type: "null", value: "null"  }); i += 4; continue; }
    tokens.push({ type: "punct", value: src[i++] });
  }
  return tokens;
}

const COLORS: Record<string, string> = {
  "at-key":  "var(--accent)",
  "key":     "var(--accent2)",
  "string":  "var(--accent4)",
  "url":     "#7dd3fc",
  "number":  "#f97316",
  "bool":    "var(--accent3)",
  "null":    "var(--text-dim)",
  "punct":   "var(--text-dim)",
};

interface Props {
  src: string;
  className?: string;
}

export default function JsonHighlight({ src, className }: Props) {
  return (
    <pre className={className}>
      {tokenizeJson(src).map((t, i) => (
        <span key={i} style={{ color: COLORS[t.type] }}>{t.value}</span>
      ))}
    </pre>
  );
}
