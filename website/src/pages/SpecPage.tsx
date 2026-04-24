/**
 * KNDL Specification Page — full language spec with live playground.
 * Draws content from spec/SPECIFICATION.md.
 */

import { useState } from "react";
import { Link } from "react-router";
import { highlightKNDL } from "../components/CodeBlock";
import styles from "./SpecPage.module.css";

// ── Inline code block ─────────────────────────────────────────────────────────

function Code({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={styles.code}>
      {label && <span className={styles.codeLabel}>{label}</span>}
      <button className={`${styles.copyBtn}${copied ? ` ${styles.copyBtnDone}` : ''}`} onClick={copy} aria-label="Copy code">
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <pre
        className={styles.codePre}
        dangerouslySetInnerHTML={{ __html: highlightKNDL(code) }}
      />
    </div>
  );
}

// ── Principle card ─────────────────────────────────────────────────────────────

function Principle({
  num,
  title,
  desc,
}: {
  num: string;
  title: string;
  desc: string;
}) {
  return (
    <div className={styles.principle}>
      <div className={styles.principleNum}>{num}</div>
      <div>
        <h4 className={styles.principleTitle}>{title}</h4>
        <p className={styles.principleDesc}>{desc}</p>
      </div>
    </div>
  );
}

// ── Comparison block ──────────────────────────────────────────────────────────

function Comparison({
  oldLabel,
  newLabel,
  oldCode,
  newCode,
}: {
  oldLabel: string;
  newLabel: string;
  oldCode: string;
  newCode: string;
}) {
  return (
    <div className={styles.comparison}>
      <div className={`${styles.compareCard} ${styles.compareOld}`}>
        <h4>{oldLabel}</h4>
        <pre dangerouslySetInnerHTML={{ __html: highlightKNDL(oldCode) }} />
      </div>
      <div className={`${styles.compareCard} ${styles.compareNew}`}>
        <h4>{newLabel}</h4>
        <pre dangerouslySetInnerHTML={{ __html: highlightKNDL(newCode) }} />
      </div>
    </div>
  );
}

// ── Playground (client-side mini-parser) ──────────────────────────────────────

const PLAYGROUND_DEFAULT = `node @room_204 :: SmartRoom {
  temp     = 22.3
  unit     = "°C"
  humidity = 45
  occupied = true
  hvac     -> @hvac_unit_2
  ~confidence 0.91
  ~source     "sensor://zigbee/room-204"
  ~valid      2026-04-10T14:00Z .. *
  ~decay      0.98 / 30m
}

edge @room_204 -[part_of]-> @floor_2 {
  ~weight 1.0
}

intent @comfort_check :: Action {
  trigger = @room_204.temp > 25
  do { emit :: Alert { level = "warn" } }
  ~priority 0.7
}`;

function miniParse(src: string): object {
  const graph: {
    nodes: object[];
    edges: object[];
    intents: object[];
    types: object[];
    _summary: object;
  } = { nodes: [], edges: [], intents: [], types: [], _summary: {} };

  const lines = src.split("\n");
  let i = 0;

  const parseBlock = () => {
    const fields: Record<string, unknown> = {};
    const edges: {field: string; target: string}[] = [];
    const meta: Record<string, string> = {};
    i++; // skip opening line (already consumed)
    while (i < lines.length) {
      const line = lines[i].trim();
      i++;
      if (line === "}" || line === "") { if (line === "}") break; continue; }
      if (line.startsWith("//")) continue;
      if (line.startsWith("~")) {
        const [k, ...rest] = line.slice(1).split(/\s+/);
        meta[k] = rest.join(" ").replace(/"/g, "");
      } else if (line.includes("->")) {
        const [f, t] = line.split("->").map((s) => s.trim());
        edges.push({ field: f, target: t.replace("@", "") });
      } else if (line.includes("=")) {
        const eq = line.indexOf("=");
        const key = line.slice(0, eq).trim();
        let val: unknown = line.slice(eq + 1).trim().replace(/"/g, "");
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (typeof val === "string" && val !== "" && !isNaN(Number(val)))
          val = parseFloat(val);
        fields[key] = val;
      }
    }
    return { fields, edges, meta };
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//")) { i++; continue; }

    if (line.startsWith("node ")) {
      const id = (line.match(/@([\w]+)/) || [])[1] ?? "?";
      const type = (line.match(/::\s*(\w+)/) || [])[1] ?? null;
      const { fields, edges, meta } = parseBlock();
      graph.nodes.push({ id, type, fields, edges, meta });
    } else if (line.startsWith("edge ")) {
      const src = (line.match(/@([\w]+)/) || [])[1] ?? "?";
      const etype = (line.match(/-\[([\w]+)\]/) || [])[1] ?? "relates_to";
      const tgts = [...line.matchAll(/->\s*@([\w]+)/g)].map((m) => m[1]);
      const meta: Record<string, string> = {};
      if (line.includes("{")) {
        i++;
        while (i < lines.length) {
          const l = lines[i].trim(); i++;
          if (l === "}") break;
          if (l.startsWith("~")) {
            const [k, ...r] = l.slice(1).split(/\s+/);
            meta[k] = r.join(" ");
          }
        }
      } else { i++; }
      graph.edges.push({ source: src, type: etype, targets: tgts, meta });
    } else if (line.startsWith("intent ")) {
      const id = (line.match(/@([\w]+)/) || [])[1] ?? "?";
      const type = (line.match(/::\s*(\w+)/) || [])[1] ?? null;
      const { meta } = parseBlock();
      graph.intents.push({ id, type, meta });
    } else if (line.startsWith("type ")) {
      const name = (line.match(/type\s+(\w+)/) || [])[1] ?? "?";
      graph.types.push({ name });
      while (i < lines.length && lines[i].trim() !== "}") i++;
      i++;
    } else {
      i++;
    }
  }

  graph._summary = {
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    total_intents: graph.intents.length,
    total_types: graph.types.length,
  };
  return graph;
}

function Playground() {
  const [input, setInput] = useState(PLAYGROUND_DEFAULT);
  const [output, setOutput] = useState("← Write KNDL and click Parse");
  const [error, setError] = useState(false);

  const run = () => {
    try {
      const result = miniParse(input);
      setOutput(JSON.stringify(result, null, 2));
      setError(false);
    } catch (e: unknown) {
      setOutput(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
      setError(true);
    }
  };

  return (
    <div className={styles.playground}>
      <div className={styles.pgHeader}>
        <div className={styles.dot} />
        <div className={styles.dot} />
        <div className={styles.dot} />
        <span className={styles.pgTitle}>kndl-playground v1.0</span>
      </div>
      <div className={styles.pgBody}>
        <div className={styles.pgLeft}>
          <span className={styles.paneLabel}>KNDL Source</span>
          <textarea
            className={styles.pgTextarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
          <button className={styles.parseBtn} onClick={run}>
            ▶ Parse
          </button>
        </div>
        <div className={styles.pgRight}>
          <span className={styles.paneLabel}>Parsed Graph</span>
          <pre
            className={styles.pgOutput}
            style={{ color: error ? "var(--accent3)" : "var(--text)" }}
          >
            {output}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Domain profile data ───────────────────────────────────────────────────────

const DOMAINS = [
  {
    id: "iot",
    label: "IoT / Building",
    desc: "Smart building sensors with temporal decay and Gaussian uncertainty.",
    filename: "smart-building.kndl",
    code: `node @room_204 :: Room {
  name  = "Conference Room 204"
  floor = 2
  area  = 45
  ~confidence 1.0
  ~source     "bms://floor-plan"
}

node @hvac_unit_2 :: HVACUnit {
  model    = "Daikin-VRV-4"
  capacity = 12
  unit     = "kW"
  ~confidence 1.0
  ~source     "bms://equipment-registry"
}

node @temp_01 :: Temperature {
  value    = 22.5
  unit     = "°C"
  location -> @room_204
  hvac     -> @hvac_unit_2
  ~confidence  0.94
  ~source      "sensor://bldg-7/t-001"
  ~valid       2026-04-10T14:00Z .. *
  ~decay       0.95 / 1h
  ~uncertainty Gaussian { mean = 22.5  stddev = 0.3 }
}

edge @room_204 -[monitored_by]-> @temp_01 {
  ~weight 1.0
}

intent @overheat :: Action {
  trigger = @temp_01.value > 28.0
  do {
    emit node :: Alert {
      severity = "critical"
      ~source  "agent://monitor"
    }
  }
  ~priority 0.9
  ~cooldown 5m
}`,
  },
  {
    id: "fintech",
    label: "FinTech",
    desc: "Trade records with classification, retention policies, and FIX protocol provenance.",
    filename: "trade-ledger.kndl",
    code: `node @nasdaq :: Exchange {
  name    = "NASDAQ"
  mic     = "XNAS"
  country = "US"
  ~confidence 1.0
  ~source     "fix://exchange-registry"
}

node @clearing_house_01 :: ClearingHouse {
  name = "DTCC"
  lei  = "549300HNBDIYP2DGPX92"
  ~confidence 1.0
  ~source     "fix://ccp-registry"
}

node @trader_001 :: Trader {
  name = "Jane Smith"
  desk = "Equity"
  ~confidence 1.0
  ~source     "oms://users"
}

node @trade_8821 :: Trade {
  symbol = "AAPL"
  qty    = 100
  price  = 184.32
  side   = "buy"
  venue  -> @nasdaq
  trader -> @trader_001
  ~confidence      0.99
  ~source          "fix://prime-broker"
  ~recorded        2026-04-10T09:31:00Z
  ~classification  "confidential"
  ~retention       "7y"
}

edge @trade_8821 -[executed_at]-> @nasdaq {
  ~weight 1.0
}

edge @trade_8821 -[clears_through]-> @clearing_house_01 {
  ~weight 1.0
}`,
  },
  {
    id: "ecom",
    label: "eCommerce",
    desc: "Product catalog with parameterised types, inventory counts, and warehouse edges.",
    filename: "catalog.kndl",
    code: `node @furniture :: Category {
  name = "Furniture"
  slug = "furniture"
  ~confidence 1.0
  ~source     "erp://categories"
}

node @wh_berlin :: Warehouse {
  name     = "Berlin Central"
  location = "Berlin, Germany"
  capacity = 50000
  ~confidence 1.0
  ~source     "wms://warehouses"
}

type Product<SKU> {
  name  : String
  sku   : SKU
  price : Float
  stock : Int
}

node @product_ch2048 :: Product<String> {
  name      = "Ergonomic Chair"
  sku       = "CH-2048-BLK"
  price     = 349.99
  stock     = 12
  category  -> @furniture
  warehouse -> @wh_berlin
  ~confidence 0.99
  ~source     "erp://catalog"
}

intent @low_stock :: Action {
  trigger = @product_ch2048.stock < 5
  do { emit node :: Reorder { product -> @product_ch2048 } }
  ~priority 0.7
  ~cooldown 24h
}`,
  },
  {
    id: "logistics",
    label: "Logistics",
    desc: "Shipment tracking with decaying GPS confidence and arrival interval uncertainty.",
    filename: "shipment.kndl",
    code: `node @hub_frankfurt :: LogisticsHub {
  name    = "Frankfurt Hub"
  country = "DE"
  lat     = 50.0379
  lon     = 8.5622
  ~confidence 1.0
  ~source     "tms://hubs"
}

node @warehouse_berlin :: Warehouse {
  name    = "Berlin Distribution Centre"
  country = "DE"
  lat     = 52.5200
  lon     = 13.4050
  ~confidence 1.0
  ~source     "wms://depots"
}

node @shipment_789 :: Shipment {
  status      = "in_transit"
  weight      = 240
  unit        = "kg"
  location    -> @hub_frankfurt
  destination -> @warehouse_berlin
  eta         = "2026-04-11T08:00Z"
  ~confidence 0.87
  ~source     "gps://truck-432"
  ~valid      2026-04-10T12:00Z .. 2026-04-11T08:00Z
  ~decay      0.85 / 2h
  ~uncertainty Interval { lo = "2026-04-11T06:00Z"  hi = "2026-04-11T10:00Z" }
}

edge @hub_frankfurt -[dispatched]-> @warehouse_berlin {
  ~weight 1.0
}

intent @delay_alert :: Action {
  trigger = @shipment_789.~confidence < 0.5
  do { emit node :: Delay { shipment -> @shipment_789 } }
  ~priority 0.8
}`,
  },
  {
    id: "medicine",
    label: "Medicine",
    desc: "FHIR-compatible observations with LOINC parameterised codes and separate recorded/observed timestamps.",
    filename: "observation.kndl",
    code: `node @patient_p001 :: Patient {
  mrn    = "P-00142"
  age    = 34
  gender = "female"
  ward   = "Internal Medicine"
  ~confidence 1.0
  ~source     "ehr://patients"
  ~access     "role:clinical-staff"
}

node @encounter_4421 :: Encounter {
  type    = "outpatient"
  date    = "2026-04-10"
  patient -> @patient_p001
  ~confidence 1.0
  ~source     "ehr://encounters"
}

type Observation<C> where C <: Code {
  code  : C
  value : Float
  unit  : String
}

node @obs_4421 :: Observation<Code<"LOINC">> {
  code      = "8310-5"
  display   = "Body temperature"
  value     = 38.2
  unit      = "°C"
  subject   -> @patient_p001
  encounter -> @encounter_4421
  ~confidence  0.96
  ~source      "ehr://encounter-4421"
  ~recorded    2026-04-10T09:15:00Z
  ~observed    2026-04-10T09:10:00Z
}

edge @obs_4421 -[part_of]-> @encounter_4421 {
  ~weight 1.0
}

intent @fever_alert :: Action {
  trigger = @obs_4421.value > 38.5
  do {
    emit node :: ClinicalAlert {
      severity = "moderate"
      patient  -> @patient_p001
      ~source  "agent://clinical-monitor"
    }
  }
  ~priority 0.9
  ~cooldown 30m
}`,
  },
  {
    id: "robotics",
    label: "Robotics",
    desc: "Robot joint state with sub-second decay and a state-machine process block.",
    filename: "arm-control.kndl",
    code: `node @arm_unit_3 :: RobotArm {
  model   = "UR10e"
  reach   = 1300
  payload = 10
  unit    = "kg"
  station = "assembly-7"
  ~confidence 1.0
  ~source     "ros2://robot_description"
}

node @joint_01 :: JointState {
  angle  = 34.7
  unit   = "deg"
  torque = 2.1
  robot  -> @arm_unit_3
  ~confidence 0.99
  ~source     "ros2://joint_states"
  ~valid      2026-04-10T14:00:01.000Z .. *
  ~decay      0.5 / 100ms
}

node @joint_02 :: JointState {
  angle  = 12.3
  unit   = "deg"
  torque = 1.4
  robot  -> @arm_unit_3
  ~confidence 0.99
  ~source     "ros2://joint_states"
  ~decay      0.5 / 100ms
}

edge @arm_unit_3 -[has_joint]-> @joint_01
edge @arm_unit_3 -[has_joint]-> @joint_02

intent @overload :: Action {
  trigger = @joint_01.torque > 4.0
  do { emit node :: SafetyStop { robot -> @arm_unit_3 } }
  ~priority 1.0
  ~cooldown 1s
}`,
  },
  {
    id: "factory",
    label: "Smart Factory",
    desc: "ISA-95 work orders with deadlines, retention policies, and MES provenance.",
    filename: "work-order.kndl",
    code: `node @product_ch2048 :: Product {
  name = "Ergonomic Chair"
  sku  = "CH-2048-BLK"
  ~confidence 1.0
  ~source     "erp://catalog"
}

node @production_line_3 :: ProductionLine {
  name       = "Assembly Line 3"
  plant      = "Berlin"
  throughput = 120
  unit       = "units/h"
  ~confidence 1.0
  ~source     "mes://lines"
}

type WorkOrder = {
  qty      : Int
  status   : String
  batch_id : String
}

node @wo_4421 :: WorkOrder {
  qty      = 500
  status   = "in_progress"
  batch_id = "B-2026-04-10-001"
  product  -> @product_ch2048
  line     -> @production_line_3
  ~confidence      0.98
  ~source          "mes://sap-pp"
  ~deadline        2026-04-11T06:00Z
  ~retention       "2y"
  ~classification  "internal"
}

edge @production_line_3 -[executes]-> @wo_4421 {
  ~weight 1.0
}

intent @deadline_risk :: Action {
  trigger = @wo_4421.status == "in_progress"
  do { emit node :: ProductionAlert { work_order -> @wo_4421 } }
  ~priority 0.8
  ~cooldown 1h
}`,
  },
  {
    id: "networking",
    label: "Networking",
    desc: "UniFi network topology — fiber uplink through UDM Pro, core switch, access points, and IoT sensors. Link confidence decays between SNMP polls.",
    filename: "unifi-topology.kndl",
    code: `// ── Layer 0: ISP fiber uplink ────────────────────────────────
node @fiber_ont :: FiberUplink {
  isp         = "Deutsche Telekom"
  bandwidth   = 1000
  unit        = "Mbps"
  ~confidence 0.99
  ~source     "snmp://unifi-controller"
  ~decay      0.80 / 5m
}

// ── Layer 1: Router / firewall ───────────────────────────────
node @udm_pro :: UniFiRouter {
  model    = "UDM-Pro"
  firmware = "4.0.21"
  ip       = "192.168.1.1"
  uplink   -> @fiber_ont
  ~confidence 0.98
  ~source     "snmp://unifi-controller"
  ~decay      0.85 / 5m
}

// ── Layer 2: Core switch ─────────────────────────────────────
node @usw_pro_48 :: UniFiSwitch {
  model    = "USW-Pro-48"
  ports    = 48
  poe      = true
  ip       = "192.168.1.2"
  uplink   -> @udm_pro
  ~confidence 0.97
  ~source     "snmp://unifi-controller"
  ~decay      0.85 / 5m
}

// ── Layer 3: Access switches ─────────────────────────────────
node @usw_flex_floor2 :: UniFiSwitch {
  model  = "USW-Flex-Mini"
  ports  = 5
  poe    = true
  ip     = "192.168.1.10"
  uplink -> @usw_pro_48
  ~confidence 0.96
  ~source     "snmp://unifi-controller"
  ~decay      0.85 / 5m
}

// ── Layer 3: WiFi access points ──────────────────────────────
node @ap_lobby :: UniFiAP {
  model    = "U6-Pro"
  band     = "WiFi 6"
  location = "Lobby"
  ip       = "192.168.1.20"
  uplink   -> @usw_pro_48
  ~confidence 0.95
  ~source     "snmp://unifi-controller"
  ~valid      2026-04-10T14:00Z .. *
  ~decay      0.90 / 5m
}

node @ap_floor2 :: UniFiAP {
  model    = "U6-LR"
  band     = "WiFi 6"
  location = "Floor 2 Open Space"
  ip       = "192.168.1.21"
  uplink   -> @usw_flex_floor2
  ~confidence 0.95
  ~source     "snmp://unifi-controller"
  ~valid      2026-04-10T14:00Z .. *
  ~decay      0.90 / 5m
}

// ── Layer 4: IoT sensors via WiFi ────────────────────────────
node @sensor_motion_lobby :: MotionSensor {
  vendor   = "Aqara"
  model    = "FP2"
  location = "Lobby"
  occupied = true
  ap       -> @ap_lobby
  ~confidence 0.91
  ~source     "zigbee://coordinator/lobby"
  ~decay      0.70 / 10m
}

node @sensor_temp_floor2 :: TempSensor {
  vendor = "Aqara"
  model  = "WSDCGQ12LM"
  value  = 21.8
  unit   = "°C"
  ap     -> @ap_floor2
  ~confidence 0.93
  ~source     "zigbee://coordinator/floor2"
  ~decay      0.85 / 15m
}

// ── Edges: physical topology ─────────────────────────────────
edge @fiber_ont     -[feeds]->       @udm_pro          { ~weight 1.0 }
edge @udm_pro       -[trunk]->       @usw_pro_48       { ~weight 1.0 }
edge @usw_pro_48    -[poe_trunk]->   @usw_flex_floor2  { ~weight 0.9 }
edge @usw_pro_48    -[poe_uplink]->  @ap_lobby         { ~weight 0.9 }
edge @usw_flex_floor2 -[poe_uplink]-> @ap_floor2       { ~weight 0.9 }
edge @ap_lobby      -[wifi]->        @sensor_motion_lobby { ~weight 0.8 }
edge @ap_floor2     -[wifi]->        @sensor_temp_floor2  { ~weight 0.8 }

// ── Intent: uplink degradation ───────────────────────────────
intent @uplink_alert :: Action {
  trigger = @udm_pro.~confidence < 0.5
  do { emit node :: Incident { severity = "p1"  component = "fiber-uplink" } }
  ~priority 0.95
  ~cooldown 2m
}

// ── Intent: AP offline ───────────────────────────────────────
intent @ap_offline :: Action {
  trigger = @ap_lobby.~confidence < 0.4
  do { emit node :: Incident { severity = "p2"  component = "ap-lobby" } }
  ~priority 0.8
  ~cooldown 5m
}`,
  },
];

// ── Spec page ─────────────────────────────────────────────────────────────────

export default function SpecPage() {
  const [activeDomain, setActiveDomain] = useState("iot");
  return (
    <div className={styles.page}>
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.glowBg} />
        <div className={styles.logo}>KNDL</div>
        <div className={styles.subtitle}>Knowledge Node Description Language</div>
        <div className={styles.tagline}>
          semantic-first · agent-native · confidence-aware · graph-structured
        </div>
        <p className={styles.footerSmall}>
          <Link to="/spec/full" className={styles.footerLink}>
            Read the full language specification →
          </Link>
        </p>
      </div>

      <div className={styles.container}>

        {/* 01 — Why */}
        <section className={styles.section}>
          <h2 className={styles.h2}>01 — Why a New Language</h2>
          <p className={styles.p}>
            Existing formats were designed for humans (Markdown), machines (JSON), or
            documents (XML). None were designed for <em>agents</em> — entities that
            need to reason about knowledge, track certainty, attribute provenance, and
            traverse relationships. KNDL is built from the ground up for this world.
          </p>
          <Principle num="01" title="Meaning over Markup"
            desc="Every token carries semantic weight. No presentational noise. Structure IS meaning." />
          <Principle num="02" title="Confidence is Native"
            desc="Every fact has a certainty level. Agents don't deal in absolutes — neither should their data." />
          <Principle num="03" title="Graphs, Not Trees"
            desc="Knowledge is a web, not a hierarchy. KNDL is natively a directed graph with typed edges." />
          <Principle num="04" title="Time is a Dimension"
            desc="Facts change. KNDL tracks temporal validity — when something was true, not just what was true." />
          <Principle num="05" title="Provenance by Default"
            desc="Every assertion traces back to its source. Trust is computed, not assumed." />
        </section>

        {/* 02 — Domain Profiles */}
        <section className={styles.section}>
          <h2 className={styles.h2}>02 — Domain Profiles</h2>
          <p className={styles.p}>
            KNDL is domain-agnostic. The same core primitives — nodes, typed edges,
            meta-annotations, intents, processes — serve radically different verticals.
            Each example below is self-contained and can be pasted directly into the{" "}
            <Link to="/explorer" className={styles.footerLink}>Explorer</Link> to visualise the graph.
          </p>

          <div className={styles.domainTabs}>
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                className={`${styles.domainTab} ${activeDomain === d.id ? styles.domainTabActive : ""}`}
                onClick={() => setActiveDomain(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {DOMAINS.filter((d) => d.id === activeDomain).map((d) => (
            <div key={d.id}>
              <p className={styles.p} style={{ marginTop: 20 }}>{d.desc}</p>
              <Code label={d.filename} code={d.code} />
            </div>
          ))}
        </section>

        {/* 03 — Core Syntax */}
        <section className={styles.section}>
          <h2 className={styles.h2}>03 — Core Syntax</h2>
          <h3 className={styles.h3}>Nodes — the atomic unit</h3>
          <p className={styles.p}>
            A node is a typed, identified container for structured data and meta-annotations.
          </p>
          <Code label="node declaration" code={`node @sensor_t001 :: Temperature {
  value    = 22.5
  unit     = "°C"
  location -> @building_7     // inline edge
  ~confidence 0.94             // certainty of this assertion
  ~source     "sensor://bldg-7/t-001"
  ~valid      2026-04-10T14:00Z .. *   // open-ended validity
  ~decay      0.95 / 1h        // confidence halves every ~14h
}`} />

          <h3 className={styles.h3}>Edges — typed relationships</h3>
          <Code label="edge declaration" code={`// Simple typed edge
edge @room_204 -[located_in]-> @floor_2

// Edge with metadata
edge @temp_reading -[measured_by]-> @sensor_t001 {
  protocol = "modbus"
  ~weight  0.95
}

// Multi-target edge
edge @building_7 -[contains]-> [ @floor_1, @floor_2, @floor_3 ]

// Bidirectional
edge @room_204 <-[adjacent_to]-> @room_205`} />

          <h3 className={styles.h3}>Meta-annotations</h3>
          <p className={styles.p}>
            All standard meta-keys are prefixed with <code className={styles.inlineCode}>~</code>:
          </p>
          <div className={styles.metaTable}>
            {[
              ["~confidence", "0.0–1.0", "Certainty of the assertion"],
              ["~source", "URI", "Who asserted this fact"],
              ["~valid", "range", "Temporal validity window"],
              ["~decay", "rate/duration", "Confidence decay over time"],
              ["~supersedes", "NodeRef", "Previous version of this fact"],
              ["~derived", "NodeRef[]", "Nodes this was computed from"],
              ["~access", "String", "Permission scope expression"],
              ["~weight", "0.0–1.0", "Relative importance (edges)"],
              ["~priority", "0.0–1.0", "Execution priority (intents)"],
              ["~cooldown", "Duration", "Min time between intent firings"],
              ["~tags", "String[]", "Free-form labels"],
              ["~recorded", "DateTime", "When this fact was recorded in the system"],
              ["~observed", "DateTime", "When the event was actually observed"],
              ["~negated", "Boolean", "Assert that this fact is false"],
              ["~deadline", "DateTime", "Time by which an action must complete"],
              ["~classification", "String", "Security classification label"],
              ["~retention", "Duration", "How long to retain this record"],
              ["~uncertainty", "Distribution", "Full probability distribution (Gaussian / Interval / Categorical)"],
            ].map(([key, type, desc]) => (
              <div key={key} className={styles.metaRow}>
                <span className={styles.metaKey}>{key}</span>
                <span className={styles.metaType}>{type}</span>
                <span className={styles.metaDesc}>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 04 — Type System */}
        <section className={styles.section}>
          <h2 className={styles.h2}>04 — Type System</h2>
          <p className={styles.p}>
            KNDL has a rich structural type system with intersection, union, optional,
            and constrained types.
          </p>

          <h3 className={styles.h3}>Struct types</h3>
          <Code label="type declaration" code={`type Measurement {
  value : Float
  unit  : String
}

type Building {
  name      : String
  address   : String
  floors    : Int
  esg_score : Float
}`} />

          <h3 className={styles.h3}>Intersection & Union</h3>
          <Code label="composite types" code={`// Intersection: must satisfy ALL
type SmartSensor = Device & Measurement & {
  firmware : SemVer
}

// Union: must satisfy ONE
type Protocol = "knx" | "bacnet" | "modbus" | "zigbee"

// Optional field
type Sensor {
  value    : Float
  location : Place?    // may be absent
}`} />

          <h3 className={styles.h3}>Constrained types</h3>
          <Code label="where constraints" code={`type Temperature = Measurement where {
  .unit in ["°C", "°F", "K"]
  .value >= -273.15 if .unit == "°C"
  .value >= 0.0     if .unit == "K"
}`} />

          <h3 className={styles.h3}>Parameterised types</h3>
          <p className={styles.p}>
            Types can take type parameters, enabling domain-generic schemas that
            remain strongly typed at instantiation — useful for coded observations,
            unit-tagged quantities, and typed containers.
          </p>
          <Code label="parameterised types" code={`// Generic quantity with a unit type parameter
type Quantity<Unit> {
  value : Float
  unit  : Unit
}

// Generic coded observation (constrained to Code subtypes)
type Observation<C> where C <: Code {
  code    : C
  value   : Float
  subject : Patient
}

// Instantiation — unit locked to "LOINC" coded type
node @obs_001 :: Observation<Code<"LOINC">> {
  code    = "8310-5"
  value   = 38.2
  subject -> @patient_p001
  ~confidence 0.96
}`} />
        </section>

        {/* 05 — Contexts & Intents */}
        <section className={styles.section}>
          <h2 className={styles.h2}>05 — Contexts & Intents</h2>

          <h3 className={styles.h3}>Contexts — scoped namespaces</h3>
          <p className={styles.p}>
            Contexts define scoped namespaces. Meta-annotations on the context are
            inherited by all contained nodes unless overridden.
          </p>
          <Code label="context inheritance" code={`context @campus {
  ~source  "system://digital-twin"
  ~access  "role:operators"

  context @building_7 {
    ~access "role:building-7-team"   // overrides parent

    node @sensor_01 :: Temperature {
      value = 22.0
      unit  = "°C"
      // inherits ~source from @campus
      // inherits ~access from @building_7
    }
  }
}`} />

          <h3 className={styles.h3}>Intents — reactive rules</h3>
          <p className={styles.p}>
            Intents fire when their trigger condition is satisfied. Three trigger
            types: expression, query, and cron.
          </p>
          <Code label="intent declaration" code={`intent @overheat_alert :: Action {
  trigger = query {
    match ?t :: Temperature
    where ?t.value > 30.0 && ?t.~confidence > 0.8
  }
  do {
    emit node :: Alert {
      severity = "critical"
      message  = "Overheating detected"
      related  -> ?t
      ~source  "agent://claude-sonnet-4.6"
    }
  }
  ~priority 0.9
  ~cooldown 15m
}

// Cron trigger
intent @daily_report :: ScheduledAction {
  trigger = cron "0 8 * * *"
  do { emit node :: Report }
}`} />
        </section>

        {/* 06 — Query Language */}
        <section className={styles.section}>
          <h2 className={styles.h2}>06 — Query Language</h2>
          <Code label="query example" code={`query hot_rooms {
  match ?sensor :: Temperature
    -[located_in]-> ?room :: Room
  optional match ?fault :: SystemFault
    -[affects]-> ?room
  where
    ?sensor.value > 26.0
    && ?sensor.~confidence > 0.8
    && ?sensor.~valid overlaps now
  return {
    room:        ?room,
    temperature: ?sensor.value,
    confidence:  ?sensor.~confidence,
    has_fault:   ?fault != null
  }
}

// With aggregation
query energy_summary {
  match ?e :: EnergyReading
    -[located_in]-> @hq
  where ?e.~valid within last 30d
  return ?e aggregate {
    total_kwh = sum(.value)
    by_source = group(.source_type)
  }
}`} />
        </section>

        {/* 07 — JSON/Markdown comparison */}
        <section className={styles.section}>
          <h2 className={styles.h2}>07 — KNDL vs Other Formats</h2>
          <Comparison
            oldLabel="JSON"
            newLabel="KNDL"
            oldCode={`{
  "id": "t_reading",
  "type": "temperature",
  "value": 18.5,
  "unit": "°C",
  "location": "bldg7_floor3",
  "timestamp": "2026-04-10T14:00Z"
}
// No confidence.
// No provenance.
// No decay.
// No agent instructions.`}
            newCode={`node @t_reading :: Temperature {
  value    = 18.5
  unit     = "°C"
  location -> @bldg7_floor3
  ~confidence 0.92
  ~source "sensor://t-001"
  ~valid  2026-04-10T14:00Z .. *
  ~decay  0.95 / 1h
}`}
          />

          <Comparison
            oldLabel="Markdown"
            newLabel="KNDL — Agent Knowledge"
            oldCode={`## Building 7 — Floor 3

**Temperature:** 18.5°C
**Status:** Normal

The sensor on floor 3 reports
a temperature of 18.5°C as of
2:00 PM today.

// Pure presentation.
// Completely unstructured.
// An agent can't reason on this.`}
            newCode={`context @bldg7 {
  node @floor3 :: FloorStatus {
    temp  -> @t_reading
    state = "normal"
    ~derived [ @t_reading ]
    ~confidence 0.88
  }
  intent @alert :: Action {
    trigger = @floor3.temp.value > 28
    do { emit :: Alert }
  }
}`}
          />
        </section>

        {/* 08 — Wire format */}
        <section className={styles.section}>
          <h2 className={styles.h2}>08 — Storage & Wire Format</h2>
          <p className={styles.p}>
            KNDL has two representations: the human-readable text format (<code className={styles.inlineCode}>.kndl</code>),
            and a compact binary encoding called <strong>KNDL-B</strong> (<code className={styles.inlineCode}>.kndlb</code>)
            for wire transport and storage.
          </p>
          <Code label="kndl-b format" code={`// Binary encoding layout (big-endian)
//
// ┌────────────┬──────┬──────────┬──────────┬──────────────┐
// │ Magic      │ Ver  │ Flags    │ Node Ct  │ Edge Ct      │
// │ 4B "KNDL"  │ 2B   │ 2B       │ 4B       │ 4B           │
// ├────────────┴──────┴──────────┴──────────┴──────────────┤
// │ Type Table  (varint-prefixed string pool)              │
// ├────────────────────────────────────────────────────────┤
// │ Node Blocks (id + type_ref + fields + meta)           │
// ├────────────────────────────────────────────────────────┤
// │ Edge Blocks (src + dst + type_ref + meta)              │
// ├────────────────────────────────────────────────────────┤
// │ Intent Blocks (trigger + action + meta)                │
// └────────────────────────────────────────────────────────┘
//
// Confidence stored as uint16 (0–65535 → 0.0–1.0)
// Timestamps as int64 microseconds since epoch
// Node IDs are 128-bit UUIDs internally`} />
          <div className={styles.mimeBox}>
            <code className={styles.inlineCode}>text/kndl</code> — KNDL text format
            &nbsp;&nbsp;·&nbsp;&nbsp;
            <code className={styles.inlineCode}>application/kndl+b</code> — KNDL binary format
          </div>
        </section>

        {/* 09 — Playground */}
        <section className={styles.section}>
          <h2 className={styles.h2}>09 — Playground</h2>
          <p className={styles.p}>
            Try writing KNDL and see it parsed into a structured representation.
            The parser handles the core syntax — nodes, edges, types, and meta-annotations.
          </p>
          <Playground />
        </section>

      </div>

      <footer className={styles.footer}>
        <p>KNDL — Knowledge Node Description Language</p>
        <p className={styles.footerMono}>
          Designed for the age of agents · v1.0 specification
        </p>
        <p className={styles.footerSmall}>
          <Link to="/spec/full" className={styles.footerLink}>
            Read the full language specification →
          </Link>
        </p>
        <p className={styles.footerSmall}>
          &copy; <a href="https://artdaw.com" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Gleb Galkin</a> — April 2026
        </p>
      </footer>
    </div>
  );
}
