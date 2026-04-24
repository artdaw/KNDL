/**
 * KNDL Agent Workflow — interactive 6-stage pipeline walkthrough.
 * Migrated from SRC/kndl-agent-workflow.jsx
 */

import { useState, useEffect } from "react";
import styles from "./WorkflowPage.module.css";
import { highlightKNDL } from "../components/CodeBlock";

// ── Integration architecture layers (rendered per-stage with one highlighted) ─

const LAYERS = [
  {
    name: "System Prompt",
    detail: "KNDL type definitions + context loaded as agent instructions",
    color: "var(--accent)",
  },
  {
    name: "Tool Interface",
    detail: "read_kndl / write_kndl / query_kndl as MCP tools",
    color: "var(--accent2)",
  },
  {
    name: "Memory Layer",
    detail: "KNDL graph persisted between sessions with ~decay applied",
    color: "var(--accent4)",
  },
  {
    name: "Multi-Agent",
    detail: "Agents exchange KNDL subgraphs with provenance chains intact",
    color: "var(--accent3)",
  },
] as const;

type LayerName = (typeof LAYERS)[number]["name"];

// ── Pipeline stages ───────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "ingest",
    label: "01 — Ingest",
    title: "Agent Receives Raw Input",
    description:
      "The agent gets unstructured data — a user message, API response, sensor reading, or tool output. This is the messy real world.",
    insight: {
      lead: "The first cognitive act is",
      highlight: "triage",
      body: "One paragraph of human prose hides three facts at three different confidence levels. Every downstream stage inherits whatever errors get made here — so KNDL forces the agent to separate the signals before committing to anything.",
    },
    activeLayer: "System Prompt" as LayerName,
    layerRole: "Type definitions in the system prompt tell the agent which node shapes to look for in raw input.",
    blocks: [
      {
        label: "raw input",
        animate: true,
        code: `User says: "The meeting room on floor 3 feels
really warm, probably around 27°C. Sarah from
facilities mentioned the AC has been acting up
since yesterday morning."`,
      },
      {
        label: "agent reasoning",
        animate: true,
        code: `I need to extract structured knowledge from this.
Multiple facts here with different confidence levels:
- Temperature claim (estimated by human → lower confidence)
- HVAC malfunction (secondhand report → medium confidence)
- Temporal info (since yesterday → time-bounded)
- Location context (floor 3 meeting room)

Let me produce KNDL nodes...`,
      },
    ],
  },
  {
    id: "produce",
    label: "02 — Produce",
    title: "Agent Emits KNDL Nodes",
    description:
      "The agent transforms unstructured input into typed, confidence-scored, temporally-scoped KNDL nodes. This is the critical step — the agent must assess its own certainty.",
    insight: {
      lead: "The format refuses to let a human estimate and a calibrated sensor reading look equally trustworthy.",
      highlight: "Emitting ~confidence isn't syntax — it's self-assessment.",
      body: "The agent must answer \"how sure am I?\" for every node it writes. That discipline is what separates KNDL output from prose with opinions.",
    },
    activeLayer: "Tool Interface" as LayerName,
    layerRole: "write_kndl is the tool call that commits a new node to the graph — each invocation is one self-assessed assertion.",
    blocks: [
      {
        label: "kndl output",
        animate: true,
        code: `node @user_temp_report_0410 :: Temperature {
  value     = 27.0
  unit      = "°C"
  location  -> @floor3_meeting_room
  ~confidence 0.6          // human estimate, not sensor
  ~source     "user://gleb/msg-4821"
  ~valid      2026-04-10T14:30Z .. *
  ~decay      0.90 / 2h    // rough estimate ages fast
}

node @hvac_issue_0409 :: SystemFault {
  system    -> @hvac_floor3
  status    = "degraded"
  reporter  = "Sarah (Facilities)"
  ~confidence 0.75         // secondhand but from domain expert
  ~source     "user://gleb/msg-4821"
  ~valid      2026-04-09T08:00Z .. *
  ~derived    [ @user_temp_report_0410 ]
}

edge @user_temp_report_0410 -[caused_by]-> @hvac_issue_0409 {
  ~confidence 0.7          // plausible causal link
  ~source     "agent://claude-sonnet-4.6"
}`,
      },
    ],
  },
  {
    id: "merge",
    label: "03 — Merge",
    title: "Agent Merges Into Knowledge Graph",
    description:
      "New nodes don't exist in isolation. The agent merges them into its existing knowledge graph, resolving conflicts and updating confidence scores when evidence converges or contradicts.",
    insight: {
      lead: "When two sources disagree,",
      highlight: "conflicts aren't errors — they're data.",
      body: "KNDL lets the agent compute a principled posterior instead of picking a winner. Both the merged value and its confidence shift, so downstream reasoning inherits a calibrated belief rather than a brittle override.",
    },
    activeLayer: "Memory Layer" as LayerName,
    layerRole: "The persisted graph is where merge happens — ~decay ages competing facts so stale readings don't overwhelm fresh ones.",
    blocks: [
      {
        label: "merge logic",
        animate: true,
        code: `// Agent's internal merge process:

existing = query {
  match ?t :: Temperature
  where ?t.location -> @floor3_meeting_room
    && ?t.~valid overlaps now
}

// Found: @sensor_t_f3 with value=26.2, confidence=0.94
// Two competing facts! Agent must reconcile:

// Sensor says 26.2°C (conf 0.94)
// User says  27.0°C (conf 0.60)

// Strategy: Bayesian-weighted merge
merged_value = weighted_avg(
  [26.2, 0.94],  // sensor: high confidence
  [27.0, 0.60]   // user: lower confidence
) // → 26.4°C

// But the HVAC fault is NEW information
// No conflict → insert directly`,
      },
    ],
  },
  {
    id: "reason",
    label: "04 — Reason",
    title: "Agent Queries & Reasons Over KNDL",
    description:
      "Now the agent can reason across its entire knowledge graph. KNDL's confidence-aware queries let it make probabilistic decisions, not binary ones.",
    insight: {
      lead: "Queries return gradients, not booleans.",
      highlight: "Crisp logic over fuzzy evidence.",
      body: "The same graph state can yield \"act now\" or \"wait\" depending on thresholds — because every match carries its confidence with it. Decisions become tunable, not hardcoded.",
    },
    activeLayer: "Memory Layer" as LayerName,
    layerRole: "Queries run against the persisted graph; confidence and ~valid are first-class match criteria, not afterthoughts.",
    blocks: [
      {
        label: "kndl query",
        animate: true,
        code: `// Agent asks: "Should I trigger an HVAC alert?"

query should_alert {
  match ?fault :: SystemFault
    -[affects]-> ?zone :: Zone
  where
    ?fault.~confidence > 0.7
    && ?fault.~valid overlaps now

  match ?temp :: Temperature
    -[located_in]-> ?zone
  where
    ?temp.value > 25.0
    && ?temp.~confidence > 0.8

  optional match ?wo :: WorkOrder
    -[addresses]-> ?fault
  where ?wo.status != "closed"

  return {
    zone:        ?zone,
    temperature: ?temp.value,
    fault:       ?fault,
    has_ticket:  ?wo != null,
    urgency:     ?temp.value * ?fault.~confidence
  }
}

// Result: zone=floor3, temp=26.4, urgency=0.72
// → Agent decides: create work order, don't escalate yet`,
      },
    ],
  },
  {
    id: "act",
    label: "05 — Act",
    title: "Agent Takes Action via Intents",
    description:
      "KNDL intents fire automatically when graph state matches their trigger conditions. The agent doesn't need external orchestration — the knowledge graph IS the orchestration layer.",
    insight: {
      lead: "The knowledge graph",
      highlight: "is the orchestration layer.",
      body: "Intents fire when state matches triggers — no scheduler, no polling loop, no imperative glue. State changes cascade through the graph and the graph decides what happens next.",
    },
    activeLayer: "Tool Interface" as LayerName,
    layerRole: "Intent actions emit Command and Notification nodes; the tool interface turns those emissions into real-world side effects.",
    blocks: [
      {
        label: "intent execution",
        animate: true,
        code: `intent @comfort_response :: AutoAction {
  trigger = query {
    match ?t :: Temperature
      -[located_in]-> ?zone
    where ?t.value > 25.0
      && ?t.~confidence > 0.8
      && ?zone.occupied == true
  }

  do {
    emit node :: Command {
      target   -> ?zone.hvac
      action   = "cool"
      setpoint = 22.0
      ~source  "agent://claude-sonnet-4.6"
      ~confidence 0.85
    }

    emit node :: Notification {
      channel  = "slack://facilities"
      message  = "Auto-adjusting HVAC. Current: {?t.value}°C"
      ~priority 0.7
    }

    emit node :: WorkOrder {
      title    = "HVAC degraded — {?zone.name}"
      assignee -> @facilities_team
      related  -> ?fault
      ~source  "agent://claude-sonnet-4.6"
    }
  }

  ~cooldown 30m
  ~priority 0.8
}

// ✓ Intent fired at 14:32Z
// ✓ HVAC setpoint adjusted
// ✓ Slack notification sent
// ✓ Work order WO-2026-0891 created`,
      },
    ],
  },
  {
    id: "communicate",
    label: "06 — Communicate",
    title: "Agent Responds to Human",
    description:
      "Finally, the agent converts its KNDL-structured knowledge back into natural language. But now its response is grounded in typed, confidence-scored facts — not vibes.",
    insight: {
      lead: "Every hedge in the response (\"high confidence\", \"since yesterday\") traces to a specific node annotation.",
      highlight: "The reply isn't generated prose — it's a projection of the graph.",
      body: "Ungrounded claims become impossible to make accidentally. And because provenance survives serialisation, the next agent downstream can re-verify every claim against its source.",
    },
    activeLayer: "Multi-Agent" as LayerName,
    layerRole: "Provenance chains travel with the subgraph, so the next agent (or the same one in a later session) can trust or re-derive every claim.",
    blocks: [
      {
        label: "agent → human",
        animate: true,
        code: `"I've cross-referenced your report with our floor 3
sensor data. The sensor reads 26.2°C (high confidence),
which corroborates your estimate of ~27°C.

Combined with the HVAC issue Sarah reported, I've:

 1. Adjusted the floor 3 HVAC setpoint to 22°C
 2. Created work order WO-2026-0891 for facilities
 3. Notified the #facilities Slack channel

The system fault has been tracked since yesterday
morning (confidence: 75% — secondhand report).
I'll monitor and escalate if it doesn't improve."

// What KNDL enabled:
// - "high confidence"  → from ~confidence 0.94
// - "corroborates"     → Bayesian merge of two sources
// - "75% confidence"   → transparent uncertainty
// - "since yesterday"  → from ~valid temporal range
// - auto-actions       → intent fired autonomously`,
      },
    ],
  },
] as const;

type StageId = (typeof STAGES)[number]["id"];

// ── Typewriter hook ────────────────────────────────────────────────────────────

function useTypewriter(text: string, speed = 8, active = false) {
  const [displayed, setDisplayed] = useState(active ? "" : text);
  const [done, setDone] = useState(!active);

  useEffect(() => {
    if (!active) {
      setDisplayed(text);
      setDone(true);
      return;
    }
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, active]);

  return [displayed, done] as const;
}

// ── Animated code block ────────────────────────────────────────────────────────

function AnimatedCode({
  code,
  label,
  active,
}: {
  code: string;
  label: string;
  active: boolean;
}) {
  const [displayed, done] = useTypewriter(code, 7, active);
  return (
    <div className={styles.codeBlock}>
      <span className={styles.codeLabel}>{label}</span>
      <pre
        className={styles.codePre}
        dangerouslySetInnerHTML={{ __html: highlightKNDL(displayed) }}
      />
      {!done && <span className={styles.cursor} aria-hidden />}
    </div>
  );
}

// ── Pipeline nav ───────────────────────────────────────────────────────────────

const ICONS = ["◇", "◈", "⊕", "⊛", "⚡", "◉"];

function PipelineNav({
  active,
  onSelect,
}: {
  active: StageId;
  onSelect: (id: StageId) => void;
}) {
  const activeIdx = STAGES.findIndex((s) => s.id === active);
  return (
    <div className={styles.pipeline}>
      {STAGES.map((stage, i) => {
        const isActive = stage.id === active;
        const isPast = activeIdx > i;
        return (
          <div key={stage.id} className={styles.pipelineItem}>
            <button
              onClick={() => onSelect(stage.id)}
              className={`${styles.stageBtn} ${isActive ? styles.stageBtnActive : ""} ${isPast ? styles.stageBtnPast : ""}`}
            >
              <span className={styles.stageIcon}>{ICONS[i]}</span>
              <span className={styles.stageLabel}>
                {stage.label.split(" — ")[1]}
              </span>
            </button>
            {i < STAGES.length - 1 && (
              <div
                className={`${styles.connector} ${isPast ? styles.connectorPast : ""}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const [activeId, setActiveId] = useState<StageId>("ingest");
  const [animateKey, setAnimateKey] = useState(0);

  const stage = STAGES.find((s) => s.id === activeId)!;

  const handleSelect = (id: StageId) => {
    setActiveId(id);
    setAnimateKey((k) => k + 1);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTag}>KNDL Agent Workflow</div>
          <h1 className={styles.headerTitle}>
            How does an AI agent actually <em>use</em> KNDL?
          </h1>
          <p className={styles.headerDesc}>
            Walk through the 6-stage pipeline: from messy human input to
            structured knowledge to autonomous action. Click each stage to see
            what the agent does internally.
          </p>
        </div>

        {/* Pipeline nav */}
        <PipelineNav active={activeId} onSelect={handleSelect} />

        {/* Stage content */}
        <div key={activeId} className={styles.stageContent}>
          <div className={styles.stageMeta}>
            <div className={styles.stageNum}>{stage.label.split(" — ")[0]}</div>
            <h2 className={styles.stageTitle}>{stage.title}</h2>
            <p className={styles.stageDesc}>{stage.description}</p>
          </div>

          <div className={styles.blocks}>
            {stage.blocks.map((block, i) => (
              <AnimatedCode
                key={`${animateKey}-${i}`}
                code={block.code}
                label={block.label}
                active={block.animate}
              />
            ))}
          </div>
        </div>

        {/* Per-stage key insight */}
        <div key={`insight-${activeId}`} className={styles.insight}>
          <div className={styles.insightLabel}>Key Insight · {stage.label.split(" — ")[1]}</div>
          <p className={styles.insightText}>
            {stage.insight.lead}{" "}
            <strong className={styles.insightHighlight}>
              {stage.insight.highlight}
            </strong>{" "}
            {stage.insight.body}
          </p>
        </div>

        {/* Per-stage integration architecture (one layer highlighted) */}
        <div key={`layers-${activeId}`} className={styles.layers}>
          <div className={styles.layersLabel}>
            Integration Architecture · <span className={styles.layersActiveName}>{stage.activeLayer}</span>
          </div>
          <p className={styles.layerRole}>{stage.layerRole}</p>
          {LAYERS.map((layer) => {
            const isActive = layer.name === stage.activeLayer;
            return (
              <div
                key={layer.name}
                className={`${styles.layer} ${isActive ? styles.layerActive : styles.layerInactive}`}
                style={{ borderLeftColor: layer.color }}
              >
                <span className={styles.layerName} style={{ color: layer.color }}>
                  {layer.name}
                </span>
                <span className={styles.layerDetail}>{layer.detail}</span>
                {isActive && <span className={styles.layerBadge} aria-hidden>◉ active</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
