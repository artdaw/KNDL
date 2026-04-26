import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router";
import { SEO, techArticleSchema } from "../components/SEO";
import { DOMAINS, type DomainBundle, type Fact } from "../data/examples";
import styles from "./ExplorerPage.module.css";

// ── Decay helpers ─────────────────────────────────────────────────────────────

const UNIT_SEC: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 };

function parseDecay(decay: string): { rate: number; windowSec: number } | null {
  const m = decay.match(/^([0-9.]+)\/(\d+(?:\.\d+)?)(s|m|h|d|w|mo|y)$/);
  if (!m) return null;
  return { rate: parseFloat(m[1]), windowSec: parseFloat(m[2]) * (UNIT_SEC[m[3]] ?? 86400) };
}

function effectiveConfidence(fact: Fact): number {
  if (!fact.decay) return fact.confidence;
  const parsed = parseDecay(fact.decay);
  if (!parsed) return fact.confidence;
  const elapsed = (Date.now() - new Date(fact.validFrom).getTime()) / 1000;
  if (elapsed <= 0) return fact.confidence;
  return fact.confidence * Math.pow(parsed.rate, elapsed / parsed.windowSec);
}

// Detect entity-reference objects (namespace:value format)
function isEntityRef(val: unknown): val is string {
  return typeof val === "string" && /^[a-z][a-z0-9_-]+:[a-z0-9]/.test(val);
}

// ── Graph data model ──────────────────────────────────────────────────────────

interface GNode {
  id: string;
  label: string;
  facts: Fact[];
  eff: number;        // max effective confidence
  isSubject: boolean; // vs. object-only node
}

interface GEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "predicate" | "supersedes" | "derivedFrom";
}

function buildGraph(facts: Fact[]): { nodes: GNode[]; edges: GEdge[] } {
  const nodeMap = new Map<string, GNode>();

  function ensureNode(id: string, isSubject: boolean) {
    if (!nodeMap.has(id)) {
      const label = id.includes(":") ? id.split(":").slice(1).join(":").slice(0, 24) : id.slice(0, 24);
      nodeMap.set(id, { id, label, facts: [], eff: 0, isSubject });
    }
    if (isSubject) nodeMap.get(id)!.isSubject = true;
  }

  const edges: GEdge[] = [];

  facts.forEach(f => {
    if (!f.subject) return;
    ensureNode(f.subject, true);
    const node = nodeMap.get(f.subject)!;
    node.facts.push(f);
    node.eff = Math.max(node.eff, effectiveConfidence(f));

    // Object → entity edge
    if (isEntityRef(f.object)) {
      ensureNode(f.object as string, false);
      edges.push({
        id: `pred-${f["@id"]}`,
        source: f.subject,
        target: f.object as string,
        label: f.predicate ?? "relates_to",
        kind: "predicate",
      });
    }

    // supersedes → edge between facts' subjects
    if (f.supersedes) {
      const oldFact = facts.find(x => x["@id"] === f.supersedes);
      if (oldFact?.subject && oldFact.subject !== f.subject) {
        ensureNode(oldFact.subject, true);
        edges.push({
          id: `sup-${f["@id"]}`,
          source: f.subject,
          target: oldFact.subject,
          label: "supersedes",
          kind: "supersedes",
        });
      }
    }

    // derivedFrom → edges
    if (f.derivedFrom) {
      f.derivedFrom.forEach((srcId, i) => {
        const srcFact = facts.find(x => x["@id"] === srcId);
        if (srcFact?.subject && srcFact.subject !== f.subject) {
          ensureNode(srcFact.subject, true);
          edges.push({
            id: `der-${f["@id"]}-${i}`,
            source: f.subject!,
            target: srcFact.subject,
            label: "derivedFrom",
            kind: "derivedFrom",
          });
        }
      });
    }
  });

  // Deduplicate edges (same source→target pair)
  const seen = new Set<string>();
  const dedupedEdges = edges.filter(e => {
    const key = [e.source, e.target, e.kind].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { nodes: [...nodeMap.values()], edges: dedupedEdges };
}

// ── Force simulation hook ─────────────────────────────────────────────────────

interface Vec2 { x: number; y: number; vx: number; vy: number; }

function useForce(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  width: number,
  height: number,
  paused: boolean,
) {
  const physicsRef = useRef<Map<string, Vec2>>(new Map());
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const rafRef = useRef<number>(0);
  const draggingRef = useRef<string | null>(null);

  // Initialise positions in a circle when the node list changes
  const nodeKey = nodeIds.join(",");
  useEffect(() => {
    const map = new Map<string, Vec2>();
    nodeIds.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodeIds.length, 1);
      const r = Math.min(width, height) * 0.32;
      map.set(id, { x: width / 2 + r * Math.cos(angle), y: height / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
    });
    physicsRef.current = map;
  }, [nodeKey, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const edgeKey = edges.map(e => e.source + e.target).join(",");

  useEffect(() => {
    const REPULSION     = 4000;
    const SPRING_K      = 0.04;
    const REST_LEN      = 150;
    const GRAVITY       = 0.015;
    const DAMPING       = 0.82;
    const MIN_DIST      = 30;

    const tick = () => {
      if (paused) { rafRef.current = requestAnimationFrame(tick); return; }
      const pos = physicsRef.current;
      const ids = [...pos.keys()];

      // Centre gravity
      ids.forEach(id => {
        const p = pos.get(id)!;
        p.vx += (width / 2 - p.x) * GRAVITY;
        p.vy += (height / 2 - p.y) * GRAVITY;
      });

      // Node–node repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos.get(ids[i])!;
          const b = pos.get(ids[j])!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
          const f = REPULSION / (dist * dist);
          const fx = f * dx / dist;
          const fy = f * dy / dist;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // Spring attraction along edges
      edges.forEach(({ source, target }) => {
        const a = pos.get(source);
        const b = pos.get(target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
        const f = SPRING_K * (dist - REST_LEN);
        const fx = f * dx / dist;
        const fy = f * dy / dist;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      // Integrate + clamp
      ids.forEach(id => {
        if (id === draggingRef.current) return; // don't move dragged node
        const p = pos.get(id)!;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x = Math.max(50, Math.min(width - 50, p.x + p.vx));
        p.y = Math.max(50, Math.min(height - 50, p.y + p.vy));
      });

      // Snapshot for rendering
      const snap = new Map<string, { x: number; y: number }>();
      pos.forEach((v, k) => snap.set(k, { x: v.x, y: v.y }));
      setPositions(snap);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodeKey, edgeKey, width, height, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag handlers
  const startDrag = useCallback((id: string) => { draggingRef.current = id; }, []);
  const moveDrag  = useCallback((x: number, y: number) => {
    const id = draggingRef.current;
    if (!id) return;
    const p = physicsRef.current.get(id);
    if (p) { p.x = x; p.y = y; p.vx = 0; p.vy = 0; }
  }, []);
  const endDrag   = useCallback(() => { draggingRef.current = null; }, []);

  return { positions, startDrag, moveDrag, endDrag };
}

// ── ForceGraph component ──────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  predicate:   "rgba(0,229,160,0.5)",
  supersedes:  "rgba(0,184,212,0.6)",
  derivedFrom: "rgba(255,217,61,0.55)",
};

const NODE_COLORS = [
  "#00e5a0","#00b8d4","#ffd93d","#ff6b9d",
  "#a78bfa","#f97316","#22d3ee","#86efac",
];

function nodeColor(_id: string, idx: number): string {
  return NODE_COLORS[idx % NODE_COLORS.length];
}

function ForceGraph({
  nodes, edges, onSelect, selected,
}: {
  nodes: GNode[];
  edges: GEdge[];
  onSelect: (node: GNode | null) => void;
  selected: GNode | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 520 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: width, h: Math.max(height, 420) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { positions, startDrag, moveDrag, endDrag } = useForce(
    nodes.map(n => n.id),
    edges.map(e => ({ source: e.source, target: e.target })),
    dims.w,
    dims.h,
    false,
  );

  const nodeColorMap = new Map(nodes.map((n, i) => [n.id, nodeColor(n.id, i)]));

  // SVG mouse event handlers for dragging
  function onMouseDown(e: React.MouseEvent, nodeId: string) {
    e.preventDefault();
    startDrag(nodeId);
    const svgEl = svgRef.current;
    if (!svgEl) return;

    function onMove(ev: MouseEvent) {
      const rect = svgEl!.getBoundingClientRect();
      moveDrag(ev.clientX - rect.left, ev.clientY - rect.top);
    }
    function onUp() {
      endDrag();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <svg
      ref={svgRef}
      className={styles.graphSvg}
      width={dims.w}
      height={dims.h}
    >
      <defs>
        {Object.entries(EDGE_COLORS).map(([kind, color]) => (
          <marker
            key={kind}
            id={`arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="20"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* Edges */}
      {edges.map(edge => {
        const s = positions.get(edge.source);
        const t = positions.get(edge.target);
        if (!s || !t) return null;
        const color = EDGE_COLORS[edge.kind] ?? EDGE_COLORS.predicate;
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        return (
          <g key={edge.id}>
            <line
              x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke={color}
              strokeWidth={edge.kind === "predicate" ? 1.5 : 2}
              strokeDasharray={edge.kind === "derivedFrom" ? "5 3" : undefined}
              markerEnd={`url(#arrow-${edge.kind})`}
            />
            <text
              x={mx} y={my - 5}
              textAnchor="middle"
              fontSize={9}
              fill={color}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {edge.label.slice(0, 18)}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map(node => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const color   = nodeColorMap.get(node.id)!;
        const r       = node.isSubject ? 22 : 14;
        const isSelected = selected?.id === node.id;
        const effPct  = Math.round(node.eff * 100);

        return (
          <g
            key={node.id}
            transform={`translate(${pos.x},${pos.y})`}
            style={{ cursor: "grab" }}
            onMouseDown={e => onMouseDown(e, node.id)}
            onClick={() => onSelect(isSelected ? null : node)}
          >
            {isSelected && (
              <circle r={r + 8} fill="none" stroke={color} strokeWidth={2} opacity={0.35} />
            )}
            <circle
              r={r}
              fill={`${color}22`}
              stroke={color}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            {/* Effective confidence arc */}
            {effPct < 100 && (
              <circle
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeDasharray={`${(effPct / 100) * 2 * Math.PI * r} 9999`}
                strokeDashoffset={Math.PI * r / 2}
                opacity={0.6}
                transform="rotate(-90)"
                style={{ pointerEvents: "none" }}
              />
            )}
            <text
              y={4}
              textAnchor="middle"
              fontSize={node.isSubject ? 10 : 8}
              fontWeight={600}
              fill={color}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
            </text>
            <text
              y={r + 13}
              textAnchor="middle"
              fontSize={8}
              fill="rgba(255,255,255,0.45)"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {effPct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Card view sub-components ──────────────────────────────────────────────────

function ConfBar({ base, effective }: { base: number; effective: number }) {
  const basePct = Math.round(base * 100);
  const effPct  = Math.round(effective * 100);
  const color   = effPct > 70 ? "var(--accent)" : effPct > 40 ? "var(--accent4)" : "var(--accent3)";
  return (
    <div className={styles.confBar}>
      <div className={styles.confTrack}>
        <div className={styles.confFillBase} style={{ width: `${basePct}%` }} title={`Base: ${basePct}%`} />
        <div className={styles.confFillEff}  style={{ width: `${effPct}%`, background: color }} title={`Effective: ${effPct}%`} />
      </div>
      <div className={styles.confLabels}>
        <span className={styles.confBase}>{base.toFixed(2)}</span>
        {effective !== base && (
          <><span className={styles.confArrow}>→</span><span className={styles.confEff} style={{ color }}>{effective.toFixed(2)}</span></>
        )}
      </div>
    </div>
  );
}

function ClassBadge({ cls }: { cls: string }) {
  const colorMap: Record<string, string> = {
    PHI: "var(--accent3)", PII: "var(--accent3)", CONFIDENTIAL: "var(--accent4)", INTERNAL: "var(--accent2)",
  };
  return (
    <span className={styles.classBadge} style={{ color: colorMap[cls] ?? "var(--text-dim)", borderColor: colorMap[cls] ?? "var(--border)" }}>
      {cls}
    </span>
  );
}

function FactCard({ fact, isSuperseded }: { fact: Fact; isSuperseded: boolean }) {
  const eff = effectiveConfidence(fact);
  return (
    <div className={`${styles.factCard} ${isSuperseded ? styles.superseded : ""}`}>
      {isSuperseded && <div className={styles.supersededBanner}>superseded</div>}
      {fact.negated && <div className={styles.negatedBanner}>negated</div>}
      <p className={styles.statement}>{fact.statement}</p>
      {(fact.subject || fact.predicate || fact.object !== undefined) && (
        <div className={styles.spo}>
          {fact.subject   && <span className={styles.spoSubject}>{fact.subject}</span>}
          {fact.predicate && <span className={styles.spoPredicate}>{fact.predicate}</span>}
          {fact.object !== undefined && <span className={styles.spoObject}>{String(fact.object)}</span>}
        </div>
      )}
      <ConfBar base={fact.confidence} effective={eff} />
      <div className={styles.meta}>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>source</span>
          <span className={styles.metaValue} title={fact.source}>{fact.source.replace(/^https?:\/\//, "").slice(0, 48)}</span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>validFrom</span>
          <span className={styles.metaValue}>{fact.validFrom.slice(0, 10)}</span>
        </div>
        {fact.decay && (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>decay</span>
            <span className={styles.metaValue} style={{ color: "var(--accent4)" }}>{fact.decay}</span>
          </div>
        )}
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.badgeRow}>
          {fact.classification && <ClassBadge cls={fact.classification} />}
          {fact.supersedes && <span className={styles.linkBadge} title={fact.supersedes}>supersedes ↑</span>}
          {fact.derivedFrom && fact.derivedFrom.length > 0 && (
            <span className={styles.linkBadge} title={fact.derivedFrom.join(", ")}>derived from {fact.derivedFrom.length}</span>
          )}
        </div>
        {fact.tags && fact.tags.length > 0 && (
          <div className={styles.tags}>{fact.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}</div>
        )}
      </div>
      <div className={styles.factId} title={fact["@id"]}>…{fact["@id"].replace(/^fact:/, "").slice(-20)}</div>
    </div>
  );
}

// ── Graph node detail panel ───────────────────────────────────────────────────

function NodeDetail({ node, superseded }: { node: GNode; superseded: Set<string> }) {
  return (
    <div className={styles.nodeDetail}>
      <div className={styles.nodeDetailHeader}>
        <span className={styles.nodeDetailId}>{node.id}</span>
        <span className={styles.nodeDetailEff}>{Math.round(node.eff * 100)}% eff.</span>
      </div>
      <div className={styles.nodeDetailFacts}>
        {node.facts.map(f => (
          <div key={f["@id"]} className={`${styles.nodeDetailFact} ${superseded.has(f["@id"]) ? styles.supersededMini : ""}`}>
            <div className={styles.nodeDetailStatement}>{f.statement}</div>
            {f.predicate && (
              <div className={styles.nodeDetailPred}>
                {f.predicate}: <strong>{f.object !== undefined ? String(f.object) : "—"}</strong>
              </div>
            )}
            {f.decay && <div className={styles.nodeDetailDecay}>decay {f.decay}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function GraphLegend() {
  return (
    <div className={styles.graphLegend}>
      {[
        { color: EDGE_COLORS.predicate,   dash: false, label: "predicate edge" },
        { color: EDGE_COLORS.supersedes,  dash: false, label: "supersedes" },
        { color: EDGE_COLORS.derivedFrom, dash: true,  label: "derivedFrom" },
      ].map(({ color, dash, label }) => (
        <div key={label} className={styles.legendItem}>
          <svg width={28} height={10}>
            <line x1={0} y1={5} x2={28} y2={5} stroke={color} strokeWidth={1.5}
              strokeDasharray={dash ? "4 2" : undefined} />
          </svg>
          <span>{label}</span>
        </div>
      ))}
      <div className={styles.legendItem}>
        <span className={styles.legendCircle} />
        <span>arc = effective confidence</span>
      </div>
      <div className={styles.legendHint}>drag nodes · click to inspect</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ViewMode = "cards" | "graph";

export default function ExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domainParam = searchParams.get("domain") ?? "loan-decision";
  const [selectedDomainId, setSelectedDomainId] = useState(domainParam);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);

  const domain: DomainBundle = DOMAINS.find(d => d.id === selectedDomainId) ?? DOMAINS[0];

  const supersededIds = useCallback(() => {
    const ids = new Set<string>();
    for (const f of domain.facts) if (f.supersedes) ids.add(f.supersedes);
    return ids;
  }, [domain]);
  const superseded = supersededIds();

  const { nodes: graphNodes, edges: graphEdges } = buildGraph(domain.facts);

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("domain", selectedDomainId);
      return next;
    }, { replace: true });
    setSelectedNode(null);
  }, [selectedDomainId, setSearchParams]);

  useEffect(() => {
    const d = searchParams.get("domain");
    if (d && d !== selectedDomainId && DOMAINS.some(x => x.id === d)) setSelectedDomainId(d);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const avgEff = domain.facts.reduce((s, f) => s + effectiveConfidence(f), 0) / domain.facts.length;

  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Explorer — Browse Fact Bundles"
        description="Explore KNDL fact bundles across 8 domains. Cards and force-directed graph view with confidence decay, supersession chains, provenance, and classification badges."
        path="/explorer"
        type="website"
        keywords="KNDL explorer, fact graph, confidence decay, supersession, provenance, JSON-LD facts"
        jsonLd={techArticleSchema({
          headline: "KNDL Explorer",
          description: "Interactive browser for KNDL fact bundles across 8 domains.",
          path: "/explorer",
        })}
      />

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarTitle}>Fact Explorer</span>
          <div className={styles.sep} />
          <div className={styles.domainStats}>
            <span className={styles.statItem}><span className={styles.statVal}>{domain.facts.length}</span><span className={styles.statLbl}>facts</span></span>
            <span className={styles.statItem}><span className={styles.statVal}>{superseded.size}</span><span className={styles.statLbl}>superseded</span></span>
            <span className={styles.statItem}><span className={styles.statVal}>{avgEff.toFixed(2)}</span><span className={styles.statLbl}>avg eff. conf</span></span>
          </div>
        </div>
        <div className={styles.toolbarRight}>
          {/* View toggle */}
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === "cards" ? styles.viewBtnActive : ""}`}
              onClick={() => setViewMode("cards")}
            >
              Cards
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === "graph" ? styles.viewBtnActive : ""}`}
              onClick={() => setViewMode("graph")}
            >
              Graph
            </button>
          </div>
          <select
            className={styles.domainSelect}
            value={selectedDomainId}
            onChange={e => setSelectedDomainId(e.target.value)}
            aria-label="Select domain"
          >
            {DOMAINS.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.facts.length} facts)</option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.domainDesc}>{domain.description}</div>

      {viewMode === "cards" ? (
        <>
          <div className={styles.grid}>
            {domain.facts.map(fact => (
              <FactCard key={fact["@id"]} fact={fact} isSuperseded={superseded.has(fact["@id"])} />
            ))}
          </div>
          <div className={styles.footer}>
            <span>Confidence bar: dim = base &nbsp;|&nbsp; bright = effective (post-decay)</span>
            <span>Grey cards are superseded by a newer fact in this bundle</span>
          </div>
        </>
      ) : (
        <div className={styles.graphPane}>
          {graphNodes.length === 0 ? (
            <div className={styles.graphEmpty}>
              No entity subjects in this bundle — no graph to show.
            </div>
          ) : (
            <>
              <div className={styles.graphCanvas}>
                <ForceGraph
                  nodes={graphNodes}
                  edges={graphEdges}
                  onSelect={setSelectedNode}
                  selected={selectedNode}
                />
                {selectedNode && (
                  <NodeDetail node={selectedNode} superseded={superseded} />
                )}
              </div>
              <GraphLegend />
              {graphEdges.length === 0 && (
                <div className={styles.graphHint}>
                  No entity-reference edges found. Nodes represent subjects; facts with numeric / string objects appear as node properties only.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
