import { useState, useEffect, useRef, useCallback } from "react";
import { parseKNDL, typeColor, GraphData, GraphNodeData } from "../utils/kndlParser";
import { useForceLayout, Position } from "../hooks/useForceLayout";
import styles from "./ExplorerPage.module.css";

// ── Sample KNDL ───────────────────────────────────────────────────────────────

const SAMPLE = `node @berlin :: Location {
  name     = "Berlin"
  country  = "Germany"
  pop      = 3645000
  ~confidence 0.99
  ~source     "wikidata://Q64"
}

node @temp_01 :: Temperature {
  value    = 18.5
  unit     = "°C"
  location -> @berlin
  ~confidence 0.92
  ~source     "sensor://bldg-7/t-001"
  ~valid      2026-04-10T14:00Z .. 2026-04-10T14:05Z
  ~decay      0.95 / 1h
}

node @sensor_01 :: Device {
  model    = "Bosch BME280"
  floor    = 3
  location -> @berlin
  measures -> @temp_01
  ~confidence 0.97
  ~source     "inventory://sensors"
}

node @research_team :: Organization {
  name     = "Climate Data Lab"
  city     -> @berlin
  ~confidence 0.88
  ~source     "internal://org-chart"
}

node @dr_mueller :: Person {
  name     = "Dr. Lena Mueller"
  role     = "Lead Scientist"
  worksAt  -> @research_team
  ~confidence 0.95
  ~source     "agent://hr"
}

node @heat_alert :: Event {
  type     = "TemperatureAlert"
  severity = "moderate"
  triggers -> @temp_01
  ~confidence 0.80
  ~source     "agent://monitor"
}`;

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ confidence }: { confidence: string }) {
  const pct = Math.round((parseFloat(confidence) || 0) * 100);
  const color = pct > 80 ? "#4ECDC4" : pct > 50 ? "#F7C59F" : "#E63946";
  return (
    <div className={styles.confBar}>
      <div className={styles.confTrack}>
        <div className={styles.confFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.confPct} style={{ color }}>{pct}%</span>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  node: GraphNodeData;
  graph: GraphData;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

function DetailPanel({ node, graph, onClose, onNavigate }: DetailPanelProps) {
  const c = typeColor(node.typeName);
  const metaEntries = Object.entries(node.meta).filter(([k]) => k !== "confidence");

  return (
    <div className={styles.detailContent}>
      <div className={styles.detailHeader}>
        <div>
          <div
            className={styles.detailTypeBadge}
            style={{ background: c.bg, color: c.text }}
          >
            {node.typeName}
          </div>
          <div className={styles.detailId}>@{node.id}</div>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>

      {node.meta.confidence && (
        <div className={styles.sectionBlock}>
          <div className={styles.sectionLabel}>Confidence</div>
          <ConfBar confidence={node.meta.confidence} />
        </div>
      )}

      {Object.keys(node.fields).length > 0 && (
        <div className={styles.sectionBlock}>
          <div className={styles.sectionLabel}>Fields</div>
          {Object.entries(node.fields).map(([k, v]) => (
            <div key={k} className={styles.fieldRow}>
              <span className={styles.fieldKey}>{k}</span>
              <span className={styles.fieldVal}>
                {typeof v === "number" ? v.toLocaleString() : v}
              </span>
            </div>
          ))}
        </div>
      )}

      {node.edgesRaw.length > 0 && (
        <div className={styles.sectionBlock}>
          <div className={styles.sectionLabel}>Edges</div>
          {node.edgesRaw.map((e, i) => {
            const target = graph.nodes[e.target];
            const tc = typeColor(target?.typeName ?? "Unknown");
            return (
              <div key={i} className={styles.edgeRow} onClick={() => onNavigate(e.target)}>
                <span className={styles.edgeLabel}>{e.label}</span>
                <span className={styles.edgeArrow}>→</span>
                <span style={{ fontSize: 10, color: tc.bg }}>@{e.target}</span>
              </div>
            );
          })}
        </div>
      )}

      {metaEntries.length > 0 && (
        <div className={styles.sectionBlock}>
          <div className={styles.sectionLabel}>Meta</div>
          {metaEntries.map(([k, v]) => (
            <div key={k}>
              <div className={styles.metaKey}>~{k}</div>
              <div className={styles.metaVal}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ViewMode = "graph" | "editor";

export default function ExplorerPage() {
  const [source, setSource] = useState(SAMPLE);
  const [graph, setGraph] = useState<GraphData>({ nodes: {}, edges: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("graph");
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<Position | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 560 });

  // observe canvas size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // parse on source change
  useEffect(() => {
    try {
      setGraph(parseKNDL(source));
      setSelected(null);
    } catch {
      // keep previous graph on parse error
    }
  }, [source]);

  const nodeList = Object.values(graph.nodes);
  const { positions, posRef } = useForceLayout(nodeList, graph.edges, canvasSize.w, canvasSize.h);

  // ── Drag nodes ──────────────────────────────────────────────────────────────
  const onNodePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelected(id);
    setDragging(id);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;
      posRef.current[dragging] = { x, y };
      setGraph(g => ({ ...g }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, pan, zoom, posRef]);

  // ── Pan ─────────────────────────────────────────────────────────────────────
  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    const tgt = e.target as Element;
    if (tgt === svgRef.current || tgt.tagName === "rect" || tgt.tagName === "pattern") {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panStart.current) return;
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  // ── Zoom ────────────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(4, z - e.deltaY * 0.001)));
  }, []);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const avgConf = nodeList.length
    ? (nodeList.reduce((s, n) => s + (parseFloat(n.meta.confidence) || 0), 0) / nodeList.length).toFixed(2)
    : "—";
  const typeCount = new Set(nodeList.map(n => n.typeName)).size;
  const STAT_ITEMS: Array<[string, string | number, string]> = [
    ["nodes",    nodeList.length,     "#4ECDC4"],
    ["edges",    graph.edges.length,  "#F7C59F"],
    ["types",    typeCount,           "#8338EC"],
    ["avg conf", avgConf,             "#3A86FF"],
  ];

  const selNode = selected ? graph.nodes[selected] : null;
  const pos = positions;

  // ── Edge rendering helpers ──────────────────────────────────────────────────
  const R = 28; // node radius

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>
          <span className={styles.toolbarName}>Graph Explorer</span>
          <div className={styles.sep} />
          <div className={styles.stats}>
            {STAT_ITEMS.map(([label, val, color]) => (
              <div key={label} className={styles.stat}>
                <div className={styles.statValue} style={{ color }}>{val}</div>
                <div className={styles.statLabel}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.viewToggle}>
          {(["graph", "editor"] as ViewMode[]).map(v => (
            <button
              key={v}
              className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ""}`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Graph canvas */}
        <div
          className={styles.canvas}
          ref={containerRef}
          style={{ display: view === "graph" ? "flex" : "none" }}
        >
            <svg
              ref={svgRef}
              className={styles.svg}
              style={{ cursor: isPanning ? "grabbing" : dragging ? "grabbing" : "grab" }}
              onMouseDown={onSvgMouseDown}
              onWheel={onWheel}
              data-testid="graph-canvas"
            >
              <defs>
                <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#2a3348" />
                </marker>
                <marker id="arr-hl" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#FF6B35" />
                </marker>
                {nodeList.map(n => {
                  const c = typeColor(n.typeName);
                  return (
                    <radialGradient key={n.id} id={`grd-${n.id}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={c.bg} stopOpacity="0.25" />
                      <stop offset="100%" stopColor={c.bg} stopOpacity="0" />
                    </radialGradient>
                  );
                })}
              </defs>

              <rect width="100%" height="100%" fill="transparent" />

              {/* Dot grid background */}
              <pattern
                id="grid"
                width="32"
                height="32"
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${pan.x % 32},${pan.y % 32})`}
              >
                <circle cx="16" cy="16" r="0.8" fill="#1e2533" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />

              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {/* Selection glow */}
                {selected && pos[selected] && (
                  <circle
                    cx={pos[selected].x}
                    cy={pos[selected].y}
                    r={54}
                    fill={`url(#grd-${selected})`}
                    style={{ pointerEvents: "none" }}
                  />
                )}

                {/* Edges */}
                {graph.edges.map((e, idx) => {
                  const s = pos[e.source];
                  const t = pos[e.target];
                  if (!s || !t) return null;
                  const isHl = hovered === e.source || hovered === e.target
                    || selected === e.source || selected === e.target;
                  const dx = t.x - s.x;
                  const dy = t.y - s.y;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  const x1 = s.x + (dx / dist) * R;
                  const y1 = s.y + (dy / dist) * R;
                  const x2 = t.x - (dx / dist) * (R + 6);
                  const y2 = t.y - (dy / dist) * (R + 6);
                  const mx = (s.x + t.x) / 2;
                  const my = (s.y + t.y) / 2;

                  return (
                    <g key={idx}>
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={isHl ? "#FF6B35" : "#2a3348"}
                        strokeWidth={isHl ? 2 : 1.2}
                        markerEnd={isHl ? "url(#arr-hl)" : "url(#arr)"}
                        style={{ transition: "stroke 0.15s" }}
                      />
                      {isHl && (
                        <text
                          x={mx} y={my - 6}
                          textAnchor="middle"
                          fill="#FF6B35"
                          fontSize={9}
                          letterSpacing="0.06em"
                          style={{ pointerEvents: "none", fontFamily: "var(--font-mono)" }}
                        >
                          {e.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {nodeList.map(n => {
                  const p = pos[n.id];
                  if (!p) return null;
                  const c = typeColor(n.typeName);
                  const isSel = selected === n.id;
                  const isHov = hovered === n.id;
                  const conf = parseFloat(n.meta.confidence) || 0;
                  const circum = 201; // 2πr ≈ 2π×32

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      onPointerDown={(e) => onNodePointerDown(e, n.id)}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                      style={{ cursor: "pointer" }}
                      data-testid={`node-${n.id}`}
                    >
                      {/* Confidence ring */}
                      <circle r={32} fill="none" stroke="#1e2533" strokeWidth={3} />
                      {conf > 0 && (
                        <circle
                          r={32}
                          fill="none"
                          stroke={c.bg}
                          strokeWidth={3}
                          strokeDasharray={`${conf * circum} ${circum}`}
                          strokeDashoffset={50}
                          style={{ transition: "stroke-dasharray 0.5s" }}
                        />
                      )}
                      {/* Node body */}
                      <circle
                        r={26}
                        fill={isSel ? c.bg : "#141b2d"}
                        stroke={c.bg}
                        strokeWidth={isSel || isHov ? 2.5 : 1.5}
                        style={{ transition: "all 0.15s" }}
                        filter={isSel ? `drop-shadow(0 0 12px ${c.bg})` : undefined}
                      />
                      {/* Type initials */}
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={13}
                        fontWeight={700}
                        fill={isSel ? c.text : c.bg}
                        style={{ pointerEvents: "none", letterSpacing: "-0.02em", fontFamily: "var(--font-mono)" }}
                      >
                        {n.typeName.slice(0, 2).toUpperCase()}
                      </text>
                      {/* Label */}
                      <text
                        y={42}
                        textAnchor="middle"
                        fill={isSel || isHov ? "#fff" : "#5a6275"}
                        fontSize={10}
                        letterSpacing="0.04em"
                        style={{ pointerEvents: "none", transition: "fill 0.15s", fontFamily: "var(--font-mono)" }}
                      >
                        @{n.id.length > 14 ? n.id.slice(0, 14) + "…" : n.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Zoom controls */}
            <div className={styles.zoomControls}>
              {([
                ["+", () => setZoom(z => Math.min(4, z + 0.15))],
                ["−", () => setZoom(z => Math.max(0.25, z - 0.15))],
                ["⊙", () => { setZoom(1); setPan({ x: 0, y: 0 }); }],
              ] as Array<[string, () => void]>).map(([lbl, fn]) => (
                <button key={lbl} className={styles.zoomBtn} onClick={fn}>{lbl}</button>
              ))}
            </div>

            {/* Type legend */}
            <div className={styles.legend}>
              {[...new Set(nodeList.map(n => n.typeName))].map(t => {
                const c = typeColor(t);
                return (
                  <div key={t} className={styles.legendItem}>
                    <div className={styles.legendDot} style={{ background: c.bg }} />
                    <span className={styles.legendLabel}>{t}</span>
                  </div>
                );
              })}
            </div>
          </div>

        {/* Editor view */}
        <div
          className={styles.editor}
          style={{ display: view === "editor" ? "flex" : "none" }}
        >
          <div className={styles.editorLabel}>KNDL Source</div>
          <textarea
            className={styles.textarea}
            value={source}
            onChange={e => setSource(e.target.value)}
            spellCheck={false}
            data-testid="kndl-editor"
          />
          <div className={styles.editorActions}>
            <button className={styles.viewGraphBtn} onClick={() => setView("graph")}>
              VIEW GRAPH →
            </button>
          </div>
        </div>

        {/* Detail panel */}
        <div
          className={styles.detail}
          style={{ width: selNode ? 280 : 0 }}
          data-testid="detail-panel"
        >
          {selNode && (
            <DetailPanel
              node={selNode}
              graph={graph}
              onClose={() => setSelected(null)}
              onNavigate={(id) => setSelected(id)}
            />
          )}
        </div>
      </div>

      {/* Footer hints */}
      <div className={styles.footer}>
        <span>CLICK node to inspect</span>
        <span>DRAG to reposition</span>
        <span>SCROLL to zoom</span>
        <span>EDITOR tab to edit source</span>
      </div>
    </div>
  );
}
