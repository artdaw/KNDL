import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Plugin: expose spec/SPECIFICATION.md and spec/grammar/kndl.ebnf at
//    stable URLs (/spec/SPECIFICATION.md, /spec/kndl.ebnf) in both dev
//    and build. Also emits /llms-full.txt = preamble + spec + EBNF so
//    agents can slurp everything in one request.
function kndlSpecAssets(): Plugin {
  const repoRoot = resolve(__dirname, "..");
  const specPath = resolve(repoRoot, "spec/SPECIFICATION.md");
  const ebnfPath = resolve(repoRoot, "spec/grammar/kndl.ebnf");
  const examplesIndexPath = resolve(__dirname, "public/examples/index.md");

  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

  const buildLlmsFull = () => {
    const spec = read(specPath);
    const ebnf = read(ebnfPath);
    const examplesIdx = read(examplesIndexPath);
    return [
      "# KNDL — Full Machine-Readable Bundle",
      "",
      "This file bundles the KNDL specification, EBNF grammar, and example",
      "index into a single document for LLM consumption. It is regenerated",
      "at build time from the canonical sources in the repository.",
      "",
      "Canonical URLs:",
      "- Spec:     https://kndl.artdaw.com/spec/SPECIFICATION.md",
      "- Grammar:  https://kndl.artdaw.com/spec/kndl.ebnf",
      "- Examples: https://kndl.artdaw.com/examples/",
      "- Index:    https://kndl.artdaw.com/llms.txt",
      "",
      "---",
      "",
      "# PART 1 — SPECIFICATION",
      "",
      spec,
      "",
      "---",
      "",
      "# PART 2 — EBNF GRAMMAR",
      "",
      "```ebnf",
      ebnf,
      "```",
      "",
      "---",
      "",
      "# PART 3 — EXAMPLE INDEX",
      "",
      examplesIdx,
      "",
    ].join("\n");
  };

  const serveMap: Record<string, () => string> = {
    "/spec/SPECIFICATION.md": () => read(specPath),
    "/spec/kndl.ebnf": () => read(ebnfPath),
    "/llms-full.txt": () => buildLlmsFull(),
  };

  return {
    name: "kndl-spec-assets",

    // Dev: serve files straight from disk at their stable URLs.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const handler = serveMap[url];
        if (!handler) return next();
        const body = handler();
        const ext = url.endsWith(".ebnf")
          ? "text/plain; charset=utf-8"
          : url.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8";
        res.setHeader("Content-Type", ext);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(body);
      });
    },

    // Build: emit the files into the final bundle.
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "spec/SPECIFICATION.md",
        source: read(specPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "spec/kndl.ebnf",
        source: read(ebnfPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "llms-full.txt",
        source: buildLlmsFull(),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), kndlSpecAssets()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
    css: false,
  },
});

