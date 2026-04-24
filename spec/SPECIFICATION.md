# KNDL Language Specification

**Knowledge Node Description Language**
Version 1.0.0 — April 2026

---

## 1. Introduction

### 1.1 Purpose

KNDL (pronounced "kindle") is a language designed for AI agents to represent,
store, query, and exchange structured knowledge. Unlike general-purpose data
formats (JSON, YAML, XML) or presentation formats (Markdown, HTML), KNDL is
purpose-built for agent cognition: every assertion carries confidence,
provenance, temporal scope, and typed relationships as first-class constructs.

### 1.2 Design Goals

1. **Semantic-first**: Structure encodes meaning, not presentation.
2. **Confidence-native**: Every fact carries uncertainty (scalar or distribution).
3. **Graph-structured**: Knowledge is a directed graph with typed edges.
4. **Bitemporal**: Valid time (when true in the world) and recorded time
   (when the system learned it) are tracked independently.
5. **Provenance-tracked**: Every assertion traces to its source;
   cryptographic provenance is supported but optional.
6. **Dimensionally safe**: Physical quantities carry units; money carries
   currency. The type system rejects dimensionally incoherent operations.
7. **Agent-actionable**: Intents encode trigger-action patterns; processes
   encode sequenced workflows with preconditions and compensation.
8. **Composable**: Types support intersection, union, optional, parameters,
   and value constraints.
9. **Dual-format**: Human-readable text (`.kndl`) and compact binary (`.kndlb`).
10. **Profile-friendly**: Domain profiles (IoT, FinTech, Healthcare, …) add
    conventions without changing the core language.

### 1.3 Knowledge Model

KNDL adopts an **open-world assumption**: absence of a fact does not imply
its negation. To assert that something is known to be false, use the
`~negated true` meta-annotation (§4.3.1). This matters for domains like
medicine ("no history of diabetes" is a positive assertion of absence, not
missing data) and security ("no observed connection" vs "not observed").

Every assertion has an **epistemic component** (how sure the agent is that
the assertion is true) represented by `~confidence`, and optionally an
**aleatoric component** (how variable the asserted value itself is)
represented by `~uncertainty` (§9). These are distinct: a stock price
measurement may be 100% confidently observed yet aleatorically volatile.

### 1.4 Notation Conventions

- `UPPERCASE` — grammar non-terminals
- `'literal'` — literal tokens
- `[x]` — optional
- `{x}` — zero or more repetitions
- `x | y` — alternatives
- `(x)` — grouping

---

## 2. Lexical Structure

### 2.1 Character Set

KNDL source files are encoded in UTF-8. All keywords and operators use ASCII.
String values may contain any valid Unicode.

### 2.2 Whitespace and Line Terminators

Whitespace characters (space U+0020, tab U+0009) are insignificant except
within string literals. Line terminators (LF U+000A, CR U+000D, CRLF) separate
logical lines. Blank lines are ignored.

### 2.3 Comments

```
COMMENT       = LINE_COMMENT | BLOCK_COMMENT
LINE_COMMENT  = '//' {any char except newline} NEWLINE
BLOCK_COMMENT = '/*' {any char} '*/'
```

Comments are stripped during lexing and carry no semantic weight. Block
comments may be nested.

### 2.4 Identifiers

```
IDENTIFIER    = LETTER { LETTER | DIGIT | '_' }
LETTER        = 'a'..'z' | 'A'..'Z'
DIGIT         = '0'..'9'
```

Identifiers are case-sensitive. Reserved keywords (§2.6) cannot be used as
identifiers.

### 2.5 Node References

```
NODE_REF      = '@' IDENTIFIER { '.' IDENTIFIER }
```

Node references begin with `@` and may use dot-notation for path traversal:
`@building_7.floor_3.sensor_01`.

### 2.6 Reserved Keywords

```
node    edge    type    intent    context    query   process
match   where   return  with      emit       do      state
trigger cron    if      else      in         and     on
or      not     true    false     null       now     goto
last    within  overlaps aggregate  group    as      compensate
import  export  from    optional  by         of
sum     avg     min     max       count
```

The keyword `group` is reserved for the query `group by` clause and is
**not** an aggregation function (see §5.4).

### 2.7 Operators

```
=       Assignment
::      Type annotation
->      Directed edge (forward)
<->     Bidirectional edge (sugar for two directed edges)
-[T]->  Typed directed edge
<-[T]-  Reversed typed edge
-[T]-   Undirected typed edge (sugar for <-[T]-> )
..      Range operator
*..N    Path repetition lower bound N
*N..M   Path repetition range N..M
{       Block open
}       Block close
#{      Map literal open (disambiguates from block)
[       Array open / typed-edge bracket
]       Array close
(       Group open
)       Group close
,       Separator
:       Type field declaration
?       Optional type marker
&       Type intersection
|       Type union
>  <  >= <= == !=   Comparison operators
&& ||               Logical operators
+  -  *  /  %       Arithmetic operators
```

### 2.8 Literals

#### 2.8.1 Integer Literals

```
INT_LITERAL   = ['-'] DIGIT { DIGIT }
              | '0x' HEX_DIGIT { HEX_DIGIT }
              | '0b' BIN_DIGIT { BIN_DIGIT }
```

#### 2.8.2 Float Literals

```
FLOAT_LITERAL = ['-'] DIGIT { DIGIT } '.' DIGIT { DIGIT } [ EXPONENT ]
EXPONENT      = ('e' | 'E') ['+' | '-'] DIGIT { DIGIT }
```

#### 2.8.3 Decimal Literals

Arbitrary-precision decimals, used for money and any value where binary
floating-point rounding is unacceptable.

```
DECIMAL_LITERAL = ['-'] DIGIT { DIGIT } '.' DIGIT { DIGIT } 'd'
```

Examples: `19.99d`, `0.0001d`.

#### 2.8.4 String Literals

```
STRING        = '"' { STRING_CHAR | ESCAPE } '"'
STRING_CHAR   = any Unicode char except '"' and '\'
ESCAPE        = '\' ( '"' | '\' | '/' | 'n' | 'r' | 't' | 'u' HEX4 )
HEX4          = HEX_DIGIT HEX_DIGIT HEX_DIGIT HEX_DIGIT
```

Triple-quoted strings (`"""..."""`) allow embedded newlines without escapes.

#### 2.8.5 Boolean Literals

```
BOOL_LITERAL  = 'true' | 'false'
```

#### 2.8.6 Null Literal

```
NULL_LITERAL  = 'null'
```

#### 2.8.7 Duration Literals

```
DURATION      = DIGIT { DIGIT } DURATION_UNIT
DURATION_UNIT = 'ns' | 'us' | 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'mo' | 'y'
```

Durations `mo` and `y` are **calendar** durations (variable wall-clock
length). `d` and shorter are **exact** durations (SI seconds). Mixing
calendar and exact durations in arithmetic is a type error.

Examples: `5s`, `30m`, `24h`, `7d`, `100ms`, `6mo`, `30y`.

#### 2.8.8 Datetime Literals

```
DATETIME      = DATE [ 'T' TIME [ TIMEZONE ] ]
DATE          = YEAR '-' MONTH '-' DAY
              | YEAR '-Q' QUARTER
              | YEAR '-W' WEEK
TIME          = HOUR ':' MINUTE [ ':' SECOND [ '.' FRACTION ] ]
TIMEZONE      = 'Z' | ('+' | '-') HOUR ':' MINUTE
```

Examples: `2026-04-10`, `2026-04-10T14:30:00Z`, `2026-Q1`.

#### 2.8.9 Quantity Literals

Physical quantities combine a numeric magnitude with a unit expression
(§3.4). Whitespace between magnitude and unit is optional.

```
QUANTITY_LITERAL = (INT_LITERAL | FLOAT_LITERAL | DECIMAL_LITERAL) UNIT_EXPR
UNIT_EXPR        = UNIT_ATOM { ('*' | '/' | '^' INT_LITERAL) UNIT_ATOM }
UNIT_ATOM        = '°C' | '°F' | 'K'
                 | 'm'  | 'cm' | 'mm' | 'km' | 'ft' | 'in'
                 | 'kg' | 'g'  | 'mg' | 'lb'
                 | 's'  | 'ms' | 'min' | 'hr'
                 | 'A'  | 'V'  | 'W'  | 'Wh' | 'kWh' | 'J'
                 | 'Pa' | 'kPa' | 'bar'
                 | 'mol' | 'cd' | 'lm' | 'lx'
                 | 'Hz' | 'kHz' | 'MHz' | 'GHz'
                 | 'B'  | 'KB' | 'MB' | 'GB' | 'TB'
                 | 'bps' | 'kbps' | 'Mbps' | 'Gbps'
                 | IDENTIFIER      (* user-registered unit *)
```

Examples: `22.5 °C`, `5 m/s`, `9.81 m/s^2`, `100 kWh`, `3.14e8 m/s`.

A quantity literal produces a value of type `Quantity<D>` where `D` is the
dimension inferred from the unit (§3.4).

#### 2.8.10 Money Literals

```
MONEY_LITERAL = DECIMAL_LITERAL ' ' ISO4217
              | DECIMAL_LITERAL ISO4217
ISO4217       = 'USD' | 'EUR' | 'GBP' | 'JPY' | ...   (* ISO 4217 3-letter *)
```

Examples: `19.99d USD`, `1000.00d EUR`.

Shorthand for amounts with no fractional part: `100 USD` (compiler inserts
`.00d`).

#### 2.8.11 Bytes Literals

```
BYTES_LITERAL = 'b"' { BASE64_CHAR } '"'
```

#### 2.8.12 Vector Literals

```
VECTOR_LITERAL = 'v[' FLOAT_LITERAL { ',' FLOAT_LITERAL } ']'
```

Example: `v[0.12, -0.03, 0.91]` — a 3-dimensional vector of floats.

Vectors are fixed-dimension at declaration time; see §3.1 `Vector<N>`.

---

## 3. Type System

### 3.1 Primitive Types

| Type          | Description                           | Literal Examples          |
|---------------|---------------------------------------|---------------------------|
| `Int`         | 64-bit signed integer                 | `42`, `-7`, `0xFF`        |
| `Float`       | 64-bit IEEE 754                       | `3.14`, `-0.5`, `1e6`     |
| `Decimal`     | Arbitrary-precision decimal           | `19.99d`, `0.0001d`       |
| `String`      | UTF-8 text                            | `"hello"`                 |
| `Bool`        | Boolean                               | `true`, `false`           |
| `Duration`    | Time span (exact)                     | `5s`, `30m`               |
| `CalDuration` | Calendar duration (wall-clock)        | `6mo`, `1y`               |
| `DateTime`    | Point in time                         | `2026-04-10T14:00Z`       |
| `Null`        | Absent value                          | `null`                    |
| `Bytes`       | Raw binary (base64 in text form)      | `b"SGVsbG8="`             |
| `Quantity<D>` | Magnitude with dimension `D`          | `22.5 °C`, `5 m/s`        |
| `Money`       | Amount with ISO 4217 currency         | `19.99d USD`              |
| `Vector<N>`   | Fixed-dimension vector of `Float`     | `v[0.1, 0.2, 0.3]`        |
| `UUID`        | 128-bit identifier                    | `u"0189..."`              |

### 3.2 Collection Types

```
Array<T>        Ordered sequence of elements of type T
Map<K, V>       Key-value mapping
Set<T>          Unordered unique collection
```

### 3.3 Parameterised Built-in Types

| Type                  | Description                                   |
|-----------------------|-----------------------------------------------|
| `Code<System>`        | Term from a coded vocabulary (ICD, SNOMED…)   |
| `Localized<T>`        | Value of type `T` keyed by BCP-47 locale tag  |
| `Frame`               | Named coordinate frame (§3.5)                 |
| `Pose<Frame>`         | Position + orientation in a named frame       |
| `Distribution<T>`     | Probability distribution over `T` (§9)        |

Example:

```kndl
type Diagnosis {
  code     : Code<"ICD-10">
  name     : Localized<String>
  onset    : DateTime?
}
```

### 3.4 Units & Dimensions

KNDL tracks **physical dimensions** through the type system. Every
quantity literal has an inferred dimension; operations that would produce
a dimensionally incoherent result are rejected at parse time.

The seven SI base dimensions are:

| Symbol | Dimension           |
|--------|---------------------|
| `L`    | length              |
| `M`    | mass                |
| `T`    | time                |
| `I`    | electric current    |
| `Θ`    | temperature         |
| `N`    | amount of substance |
| `J`    | luminous intensity  |

Derived dimensions are expressed as products of powers (`L*T^-1` is velocity).
`Quantity<D>` with dimension `D` is the canonical type for values carrying
units. Unit conversion within the same dimension is permitted and automatic:
`22 °C` and `295.15 K` are equal after normalisation.

```kndl
type Temperature = Quantity<Θ>            // any temperature unit
type Velocity    = Quantity<L*T^-1>
type Energy      = Quantity<M*L^2*T^-2>
```

User-defined units may be registered in a module:

```kndl
type BTU = Quantity<M*L^2*T^-2> where { .unit == "BTU" }
```

### 3.5 Frames

A `Frame` names a coordinate system. Positions and poses carry a frame
reference; transforms between frames are first-class nodes.

```kndl
type Frame { id : String, parent : Frame? }

type Pose<F :: Frame> {
  x : Float, y : Float, z : Float
  qx : Float, qy : Float, qz : Float, qw : Float
}

node @world :: Frame { id = "world" }
node @base  :: Frame { id = "base_link", parent -> @world }

node @gripper_pose :: Pose<@base> {
  x = 0.3, y = 0.0, z = 0.5
  qx = 0.0, qy = 0.0, qz = 0.0, qw = 1.0
}
```

### 3.6 Type Declarations

```
TYPE_DECL     = 'type' TYPE_NAME [ TYPE_PARAMS ]
                [ '=' TYPE_EXPR ]
                [ '{' TYPE_BODY '}' ]
                [ 'where' '{' { CONSTRAINT } '}' ]
TYPE_PARAMS   = '<' TYPE_PARAM { ',' TYPE_PARAM } '>'
TYPE_PARAM    = IDENTIFIER [ '::' TYPE_EXPR ]
TYPE_EXPR     = TYPE_NAME [ '<' TYPE_ARG { ',' TYPE_ARG } '>' ]
              | TYPE_EXPR '&' TYPE_EXPR       (* intersection *)
              | TYPE_EXPR '|' TYPE_EXPR       (* union *)
              | STRING                         (* literal type *)
              | TYPE_EXPR '?'                  (* optional *)
              | '{' TYPE_BODY '}'              (* anonymous struct *)
TYPE_BODY     = { FIELD_DECL }
FIELD_DECL    = IDENTIFIER ':' TYPE_EXPR
CONSTRAINT    = EXPRESSION
```

Intersection, union, optional, and constrained types (examples below):

```kndl
type SmartSensor = Device & Measurement & { firmware : SemVer }

type Protocol = "knx" | "bacnet" | "modbus" | "zigbee" | "matter"

type Temperature = Quantity<Θ> where {
  .value >= 0.0 K
}
```

---

## 4. Core Constructs

### 4.1 Node Declaration

```
NODE_DECL     = 'node' NODE_REF '::' TYPE_EXPR '{' NODE_BODY '}'
NODE_BODY     = { FIELD_ASSIGN | INLINE_EDGE | META_ANNOTATION }
FIELD_ASSIGN  = IDENTIFIER '=' EXPRESSION
INLINE_EDGE   = IDENTIFIER '->' NODE_REF
```

Map literals in expression position use `#{ ... }` (§7.1) to avoid parsing
ambiguity with node bodies and blocks.

```kndl
node @sensor_t001 :: Temperature {
  value       = 22.5 °C
  location   -> @building_7
  ~confidence 0.94
  ~source     "sensor://bldg-7/floor-3/t-001"
  ~valid      2026-04-10T14:00Z .. 2026-04-10T14:05Z
  ~recorded   2026-04-10T14:05:03Z
}
```

### 4.2 Edge Declaration

```
EDGE_DECL     = 'edge' NODE_REF EDGE_OP TARGET_SPEC [ '{' EDGE_BODY '}' ]
EDGE_OP       = '->' | '<->'
              | '-[' TYPE_NAME ']->'
              | '<-[' TYPE_NAME ']-'
              | '-[' TYPE_NAME ']-'
TARGET_SPEC   = NODE_REF | '[' NODE_REF { ',' NODE_REF } ']'
```

Edge direction arities are now unambiguous:

- `-[T]->` — forward typed edge
- `<-[T]-` — reverse typed edge (creates one edge from target to source)
- `-[T]-`  — undirected typed edge (sugar for two directed edges)
- `<->`    — undirected untyped edge

```kndl
edge @room_204 -[located_in]-> @floor_2
edge @building_7 -[contains]-> [ @floor_1, @floor_2, @floor_3 ]
edge @router_a -[peer]- @router_b      // undirected BGP peering
```

### 4.3 Meta-Annotations

```
META_ANNOTATION = '~' META_KEY META_VALUE
META_KEY        = IDENTIFIER [ ':' IDENTIFIER ]      (* ns:key namespace *)
META_VALUE      = EXPRESSION
                | EXPRESSION '..' EXPRESSION         (* range *)
                | EXPRESSION '/' DURATION            (* decay rate *)
                | '{' { META_FIELD } '}'             (* structured *)
```

#### 4.3.1 Standard Meta-Annotations

| Key              | Value Type                      | Description                                     |
|------------------|---------------------------------|-------------------------------------------------|
| `~confidence`    | `Float` (0.0–1.0)               | Epistemic certainty of the assertion            |
| `~uncertainty`   | `Distribution<T>` (§9)          | Aleatoric variability of the asserted value    |
| `~source`        | `String` (URI) or `NodeRef`     | Asserting entity                                |
| `~valid`         | `DateTime .. DateTime`          | When the fact is true in the world              |
| `~recorded`      | `DateTime`                      | When the system learned the fact                |
| `~observed`      | `DateTime`                      | When the fact was directly observed             |
| `~decay`         | `Float / Duration`              | Confidence decay rate over time                 |
| `~supersedes`    | `NodeRef`                       | Previous version of this knowledge              |
| `~derived`       | `Array<NodeRef>`                | Nodes this was computed from                    |
| `~inference`     | `NodeRef`                       | Reference to the inference rule / activity      |
| `~negated`       | `Bool`                          | Strong negation (open-world assumption)         |
| `~access`        | `{...}` policy block (§4.3.5)   | Structured access policy                        |
| `~weight`        | `Float` (0.0–1.0)               | Relative importance (edges)                     |
| `~priority`      | `Float` (0.0–1.0)               | Execution priority (intents / actions)          |
| `~deadline`      | `DateTime` or `Duration`        | Latency budget for intents                      |
| `~cooldown`      | `Duration`                      | Minimum time between intent firings             |
| `~tags`          | `Array<String>`                 | Free-form labels                                |
| `~version`       | `Int`                           | Schema version                                  |
| `~frame`         | `NodeRef` (`Frame`)             | Coordinate frame for spatial fields             |
| `~sample_rate`   | `Quantity<T^-1>`                | Sampling rate for streamed facts                |
| `~last_seen`     | `DateTime`                      | Last contact from a source (liveness)           |
| `~signature`     | `{alg, key, sig}` block         | Detached cryptographic signature                |
| `~attestation`   | `NodeRef`                       | Reference to an attestation node                |
| `~classification`| `String`                        | Data sensitivity class (PHI, PCI, PII, …)       |
| `~retention`     | `Duration` or `DateTime`        | Retention policy / scheduled deletion           |
| `~consent`       | `NodeRef`                       | Consent scope node (healthcare/GDPR)            |

#### 4.3.2 Custom Meta-Annotations

Custom annotations MUST use a namespace prefix:

```kndl
~iot:sampling_rate     1000 Hz
~fhir:effective_period 2026-04-10 .. 2026-04-30
~stix:confidence_label "high"
```

Reserved namespaces: `iot`, `fin`, `hl7`, `fhir`, `stix`, `isa95`, `brick`,
`matter`, `prov`, `w3c`. These SHOULD follow the relevant external standard.

#### 4.3.3 Confidence Semantics

- `0.0` — known false (equivalent to `~negated true ~confidence 1.0`)
- `0.0 < c < 0.5` — leaning false
- `0.5` — maximum uncertainty
- `0.5 < c < 1.0` — leaning true
- `1.0` — axiomatic

With `~decay`, effective confidence at time `t` is:

```
effective(t) = ~confidence × (rate ^ ((t - t₀) / window))
```

where `t₀` is the start of `~valid` (or `~observed` if present).

#### 4.3.4 Bitemporal Semantics

Three temporal annotations play distinct roles:

- `~valid` — when the fact holds **in the world**.
- `~observed` — when a sensor/agent **directly saw** the fact.
- `~recorded` — when the fact **entered the system**.

Queries may restrict over any axis. "What did we know on 2026-01-01 about
readings from 2025-Q4?" requires both `~recorded <= 2026-01-01` and
`~valid overlaps 2025-Q4`.

#### 4.3.5 Structured Access Policy

```
~access {
  read     = ["role:operators", "role:building-7-team"]
  write    = ["role:admins"]
  purpose  = ["operations", "billing"]
  classify = "PII"
}
```

Policy evaluation is implementation-defined but MUST be deterministic:
two policies with identical fields MUST yield the same decision for the
same subject/action.

#### 4.3.6 Negation and Open-World

`~negated true` asserts that the fact is **known false**. Absence of a
matching node MUST NOT be interpreted as `~negated true` — that is the
open-world assumption (§1.3). Example:

```kndl
node @pat_001.hx_diabetes :: MedicalHistoryItem {
  condition  = "diabetes_mellitus"
  ~negated   true
  ~confidence 0.95
  ~source    "user://dr-wong"
}
```

### 4.4 Context Declaration

Meta-annotations are inherited from parent contexts. A `~tenant` meta-annotation
is reserved for multi-tenant isolation — a query engine MUST refuse to return
nodes across tenants without explicit `~access` override.

### 4.5 Intent Declaration

```
INTENT_DECL   = 'intent' NODE_REF '::' TYPE_EXPR '{' INTENT_BODY '}'
INTENT_BODY   = TRIGGER_CLAUSE DO_CLAUSE { META_ANNOTATION }
TRIGGER_CLAUSE = 'trigger' '=' TRIGGER_EXPR
TRIGGER_EXPR  = QUERY_DECL | EXPRESSION | 'cron' STRING
DO_CLAUSE     = 'do' '{' { ACTION } '}'
ACTION        = EMIT_ACTION | UPDATE_ACTION | DELETE_ACTION | GOTO_ACTION
EMIT_ACTION   = 'emit' NODE_DECL
UPDATE_ACTION = 'emit' 'update' NODE_REF '{' NODE_BODY '}'
DELETE_ACTION = 'emit' 'delete' NODE_REF
GOTO_ACTION   = 'goto' STATE_REF                       (* within a process *)
```

Intents remain reactive rules. Sequenced behaviour belongs in processes
(§6).

### 4.6 Node, Edge, Intent Identity

Every declaration generates a stable 128-bit UUID derived from:

1. The fully-qualified node reference (context path + local id), or
2. An explicit `~id` annotation if provided.

This enables distributed systems to agree on identifiers without a central
registry.

---

## 5. Query Language

### 5.1 Query Syntax

```
QUERY_DECL    = 'query' [ IDENTIFIER ] '{' QUERY_BODY '}'
QUERY_BODY    = { MATCH_CLAUSE } [ WHERE_CLAUSE ]
                [ GROUP_CLAUSE ] RETURN_CLAUSE
MATCH_CLAUSE  = [ 'optional' ] 'match' PATH_PATTERN
WHERE_CLAUSE  = 'where' EXPRESSION
GROUP_CLAUSE  = 'group' 'by' EXPRESSION { ',' EXPRESSION }
RETURN_CLAUSE = 'return' RETURN_EXPR

PATH_PATTERN  = STEP { EDGE_STEP STEP }
STEP          = VAR_BIND '::' TYPE_EXPR
              | NODE_REF
EDGE_STEP     = EDGE_OP
              | '-[' EDGE_TYPE REPETITION? ']->'
              | '<-[' EDGE_TYPE REPETITION? ']-'
              | '-[' EDGE_TYPE REPETITION? ']-'
EDGE_TYPE     = IDENTIFIER | VAR_BIND
REPETITION    = '*' INT_LITERAL
              | '*' INT_LITERAL '..' INT_LITERAL
              | '*' '..' INT_LITERAL
              | '*'                                   (* 1..∞, capped by engine *)
```

### 5.2 Multi-Hop Paths

Path patterns with repetition find paths of variable length:

```kndl
// 1 to 5 contains-hops from campus to any sensor
query campus_sensors {
  match ?s :: Sensor
    <-[contains*1..5]- @campus
  return ?s
}

// Named path variable for trace reconstruction
query shipment_route {
  match ?p = ?origin -[ships_to*]-> ?dest
  where ?origin == @hub_frankfurt
     && ?dest   == @hub_tokyo
  return { hops: len(?p), path: ?p }
}
```

### 5.3 Variables and Optional Matches

Variable binding and optional match patterns are supported.

### 5.4 Return, Group, Aggregate

Aggregation is no longer a sub-clause of `return`; grouping is a top-level
`group by` clause.

```
RETURN_EXPR   = EXPRESSION
              | EXPRESSION 'with' 'edges' INT_LITERAL
              | AGG_FIELD { ',' AGG_FIELD }           (* implicit group *)
AGG_FIELD     = IDENTIFIER '=' AGG_FUNC '(' EXPRESSION ')'
              | IDENTIFIER '=' EXPRESSION            (* passthrough *)
AGG_FUNC      = 'sum' | 'avg' | 'min' | 'max' | 'count'
```

`group` is a **clause**, not a function. Example:

```kndl
query daily_power {
  match ?m :: PowerMeasurement -[at]-> ?site :: Site
  group by ?site, day(?m.~observed)
  return {
    site  = ?site,
    day   = day(?m.~observed),
    total = sum(?m.value)
  }
}
```

### 5.5 Full Example

```kndl
query hot_rooms {
  match ?sensor :: Temperature
    -[located_in]-> ?room :: Room
  optional match ?fault :: SystemFault
    -[affects]-> ?room
  where
    ?sensor.value > 26 °C
    && ?sensor.~confidence > 0.8
    && ?sensor.~valid overlaps now
  return {
    room        = ?room,
    temperature = ?sensor.value,
    confidence  = ?sensor.~confidence,
    has_fault   = ?fault != null
  }
}
```

---

## 6. Processes (Stateful Workflows)

A **process** encodes an ordered workflow with states, transitions,
preconditions, and compensation. Unlike intents (reactive, stateless), a
process has a persistent current state per instance.

```
PROCESS_DECL  = 'process' NODE_REF '::' TYPE_EXPR '{' PROCESS_BODY '}'
PROCESS_BODY  = { STATE_DECL | TRANSITION_DECL | META_ANNOTATION }
STATE_DECL    = 'state' IDENTIFIER [ '{' { META_ANNOTATION } '}' ]
TRANSITION_DECL = 'on' EVENT_EXPR 'in' IDENTIFIER '->' IDENTIFIER
                  [ 'where' EXPRESSION ]
                  [ 'do' '{' { ACTION } '}' ]
                  [ 'compensate' '{' { ACTION } '}' ]
EVENT_EXPR    = IDENTIFIER | QUERY_DECL
```

Example — shipment lifecycle:

```kndl
process @shipment_sm :: Workflow {
  state picked
  state packed
  state shipped
  state delivered
  state lost { ~priority 1.0 }

  on pack_complete in picked -> packed
    do { emit update @shipment { packed_at = now() } }

  on scan_at_dock in packed -> shipped
    where ?event.location == "dock"
    do { emit update @shipment { shipped_at = now() } }

  on delivery_scan in shipped -> delivered
    compensate {
      emit node :: Alert { severity = "warn", message = "delivery rollback" }
    }
}
```

Processes compose with intents: a transition's `do` block may emit intents
that fire elsewhere in the graph.

---

## 7. Expression Language

### 7.1 Expression Grammar

```
EXPRESSION    = LITERAL
              | NODE_REF
              | VAR_BIND
              | ACCESS_EXPR
              | BINARY_EXPR
              | UNARY_EXPR
              | FUNC_CALL
              | '(' EXPRESSION ')'
              | ARRAY_LITERAL
              | MAP_LITERAL
ACCESS_EXPR   = EXPRESSION '.' IDENTIFIER
              | EXPRESSION '[' EXPRESSION ']'
BINARY_EXPR   = EXPRESSION BINARY_OP EXPRESSION
UNARY_EXPR    = UNARY_OP EXPRESSION
FUNC_CALL     = IDENTIFIER '(' [ EXPRESSION { ',' EXPRESSION } ] ')'
ARRAY_LITERAL = '[' [ EXPRESSION { ',' EXPRESSION } ] ']'
MAP_LITERAL   = '#{' [ KV_PAIR { ',' KV_PAIR } ] '}'
KV_PAIR       = EXPRESSION ':' EXPRESSION
```

Map literals use `#{ ... }` to remove ambiguity against node bodies,
blocks, and `do { }` sections.

### 7.2 Operator Precedence (high → low)

1. `.` `[]` — access (not binary operators)
2. `not` `-` (unary)
3. `*` `/` `%`
4. `+` `-`
5. `..` — range
6. `>` `<` `>=` `<=`
7. `==` `!=`
8. `in` `overlaps` `within` `matches`
9. `&&` `and`
10. `||` `or`

### 7.3 Built-in Functions

| Function           | Signature                          | Description                     |
|--------------------|------------------------------------|---------------------------------|
| `len(x)`           | `Array<T> -> Int`                  | Array length                    |
| `keys(x)`          | `Map<K,V> -> Array<K>`             | Map keys                        |
| `values(x)`        | `Map<K,V> -> Array<V>`             | Map values                      |
| `abs(x)`           | `Quantity<D> -> Quantity<D>`       | Absolute value                  |
| `floor(x)`         | `Float -> Int`                     | Floor                           |
| `ceil(x)`          | `Float -> Int`                     | Ceiling                         |
| `round(x, n)`      | `Decimal, Int -> Decimal`          | Bankers' round                  |
| `now()`            | `-> DateTime`                      | Current timestamp               |
| `elapsed(dt)`      | `DateTime -> Duration`             | Time since `dt`                 |
| `day(dt)`          | `DateTime -> Date`                 | Truncate to day                 |
| `convert(q, unit)` | `Quantity<D>, UnitExpr -> Quantity<D>` | Unit conversion            |
| `convert_money(m, ccy, rate)` | `Money, ISO4217, Decimal -> Money` | Currency conversion  |
| `uuid()`           | `-> UUID`                          | Generate UUID v7                |
| `hash(x)`          | `Any -> Bytes`                     | BLAKE3-256 hash                 |
| `merge(a, b)`      | `Node, Node -> Node`               | Merge two nodes                 |
| `weighted_avg`     | `Array<(Float,Float)> -> Float`    | Confidence-weighted average     |
| `similarity(a, b)` | `Vector<N>, Vector<N> -> Float`    | Cosine similarity               |
| `verify(sig, msg, key)` | `Signature, Bytes, Key -> Bool` | Verify detached signature      |
| `transform(p, fr)` | `Pose<A>, Frame -> Pose<fr>`       | Change coordinate frame         |

---

## 8. Module System

Imports are URI-based (`kndl://std/...`).

```kndl
import { Temperature, Quantity } from "kndl://std/units"
import { Money }                 from "kndl://std/money"
import { Frame, Pose }           from "kndl://std/frames"
import { Diagnosis, Medication } from "kndl://std/healthcare"
```

---

## 9. Uncertainty Model

`~confidence` remains a scalar in [0.0, 1.0]. `~uncertainty` describes the
**distribution of the asserted value** and is parameterised by the field's
type:

```kndl
// Gaussian — robotics pose
~uncertainty gaussian { mean: 0.0, stddev: 0.03 }

// Interval — sensor calibration bound
~uncertainty interval { min: 21.8 °C, max: 23.2 °C }

// Categorical — differential diagnosis
~uncertainty categorical {
  "J45.9": 0.6,     // asthma
  "J44.9": 0.3,     // COPD
  "R05.9": 0.1      // cough, unspecified
}

// Histogram — empirical
~uncertainty histogram {
  bins:   [0 W, 100 W, 200 W, 300 W],
  counts: [12, 58, 21, 4]
}
```

A conforming Level 3 implementation MUST support `gaussian`, `interval`,
and `categorical`. `histogram` is optional.

Aleatoric and epistemic channels compose: an agent can be 95% confident
that a robot's pose is a Gaussian with σ=3 cm. One value, two sources of
uncertainty, tracked separately.

---

## 10. Serialization

### 10.1 Text Format (.kndl)

Human-readable format described throughout. UTF-8, `.kndl` extension.

### 10.2 Binary Format (.kndlb)

Compact binary encoding for wire transport and storage.

#### 10.2.1 File Header

```
Offset  Size   Field             Description
0       4      magic             ASCII "KNDL"
4       2      version           Protocol version (major.minor)
6       2      flags             Bit flags:
                                   bit 0: compressed (zstd)
                                   bit 1: encrypted
                                   bit 2: has type table
                                   bit 3: has intent table
                                   bit 4: compact id profile (varint ids)
                                   bit 5: has signature block
8       4      node_count        uint32 BE
12      4      edge_count        uint32 BE
16      4      type_count        uint32 BE
20      4      intent_count      uint32 BE
24      4      process_count     uint32 BE
28      4      string_pool_size  uint32 BE
32      32     payload_hash      BLAKE3-256 of payload (replaces CRC32)
64      ...    payload
```

Endianness is big-endian throughout the header for network ordering.

#### 10.2.2 Compact ID Profile

When flag bit 4 is set, node and edge ids are varint-encoded integers
scoped to the file, rather than 128-bit UUIDs. Used for constrained IoT
channels (LoRaWAN, BLE mesh) where 16 bytes per id is prohibitive.

#### 10.2.3 String Pool, Node Block, Edge Block

Node/edge blocks include an `uncertainty_type` byte after `confidence` to
encode structured uncertainty. Quantity values are encoded as
`(magnitude: float64, unit_ref: uint32)` pairs.

#### 10.2.4 Signature Block

When flag bit 5 is set, the file ends with a detached signature block:

```
Field            Size       Encoding
alg_ref          4          String pool index ("ed25519", "ecdsa-p256", ...)
key_ref          4          String pool index (key id / URI)
sig_len          2          uint16
signature        sig_len    Raw signature bytes
```

The signature covers the payload hash in the header.

---

## 11. Source URIs

Supported URI schemes:

| Scheme            | Description                  | Example                              |
|-------------------|------------------------------|--------------------------------------|
| `matter://`       | Matter-protocol device       | `matter://node-0x5A/cluster-0x0402`  |
| `bacnet://`       | BACnet object                | `bacnet://192.0.2.10/analog-input/3` |
| `modbus://`       | Modbus register              | `modbus://plc-03/holding/40021`      |
| `fhir://`         | FHIR resource                | `fhir://hospital/Observation/123`    |
| `stix://`         | STIX indicator               | `stix://indicator--abc-…`            |
| `did:`            | Decentralized Identifier     | `did:web:example.com`                |
| `gtin:`           | Global Trade Item Number     | `gtin:04012345678901`                |
| `oci://`          | OCI artifact                 | `oci://ghcr.io/foo/bar@sha256:…`     |

---

## 12. Conformance Levels

### Level 1: Core

Node/edge declarations, primitives, standard meta-annotations
(`~confidence`, `~source`, `~valid`, `~recorded`, `~negated`), comments,
text parsing & serialisation, **units & Quantity**, **Money**, **Decimal**.

### Level 2: Extended

Everything in Level 1 plus: type declarations (generic parameters,
intersection, union, optional, constraints), contexts with inheritance,
expression evaluation, query language (including multi-hop paths and
`group by`), import/export, binary format, **Vector**, **Frame/Pose**,
**Localized**, **Code**.

### Level 3: Agent

Everything in Level 2 plus: intents with all trigger types, **processes
with states/transitions/compensation**, confidence decay computation,
query aggregation, temporal operators, full built-in library,
**structured uncertainty** (`gaussian`, `interval`, `categorical`),
**cryptographic provenance** (`~signature`, `verify()`).

---

## 13. EBNF Grammar Summary

The authoritative grammar lives in `spec/grammar/kndl.ebnf`. A textual
summary:

```ebnf
program         = { top_level_decl } ;
top_level_decl  = node_decl | edge_decl | type_decl | context_decl
                | intent_decl | process_decl | query_decl
                | import_decl | export_decl ;

node_decl       = 'node' node_ref '::' type_expr '{' { node_member } '}' ;
edge_decl       = 'edge' node_ref edge_op target_spec
                  [ '{' { edge_member } '}' ] ;
type_decl       = 'type' identifier [ type_params ] [ '=' type_expr ]
                  [ '{' { field_decl } '}' ]
                  [ 'where' '{' { constraint } '}' ] ;
context_decl    = 'context' node_ref '{' { context_member } '}' ;
intent_decl     = 'intent' node_ref '::' type_expr '{' trigger_clause
                  do_clause { meta_annotation } '}' ;
process_decl    = 'process' node_ref '::' type_expr '{'
                  { state_decl | transition_decl | meta_annotation } '}' ;
query_decl      = 'query' [ identifier ] '{' { match_clause }
                  [ where_clause ] [ group_clause ] return_clause '}' ;

edge_op         = '->' | '<->' | '-[' identifier ']->' |
                  '<-[' identifier ']-' | '-[' identifier ']-' ;

meta_annotation = '~' meta_key meta_value ;
meta_key        = identifier [ ':' identifier ] ;
meta_value      = expression
                | expression '..' expression
                | expression '/' duration
                | '{' { meta_field } '}' ;

path_pattern    = step { edge_step step } ;
edge_step       = edge_op | '-[' edge_type repetition? ']->'
                | '<-[' edge_type repetition? ']-'
                | '-[' edge_type repetition? ']-' ;
repetition      = '*' int_literal
                | '*' int_literal '..' int_literal
                | '*' '..' int_literal
                | '*' ;
```

---

## Appendix A: Standard Library Types

```kndl
// kndl://std/core
type Entity       { id : String, name : String? }
type Measurement  { value : Float, unit : String }
type Place        { lat : Float?, lon : Float?, address : String? }
type SemVer       { major : Int, minor : Int, patch : Int }
type Signature    { alg : String, key : String, sig : Bytes }

// kndl://std/units — re-exports Quantity with common dimensions
type Temperature  = Quantity<Θ>
type Pressure     = Quantity<M*L^-1*T^-2>
type Velocity     = Quantity<L*T^-1>
type Energy       = Quantity<M*L^2*T^-2>
type Power        = Quantity<M*L^2*T^-3>
type Frequency    = Quantity<T^-1>
type Mass         = Quantity<M>
type Length       = Quantity<L>

// kndl://std/agents
type Action        { }
type ScheduledAction = Action & { schedule : String }
type Alert         { severity : "info" | "warn" | "critical", message : String }
type Command       { target : Entity, action : String }
type Report        { title : String, generated : DateTime }
type Notification  { channel : String, message : String }
type WorkOrder     { title : String, status : "open" | "in_progress" | "closed" }
type Workflow      { }

// kndl://std/inference
type InferenceRule { method : String, version : SemVer }
type Attestation   { issuer : String, claim : String, evidence : Bytes }
```

---

## Appendix B: Domain Profiles

Each profile is an importable module that adds conventional types and
meta-annotations without changing core semantics.

### B.1 IoT / PropTech (`kndl://std/iot`)

- Types: `Device`, `Sensor`, `Actuator`, `Gateway`, `Building`, `Floor`,
  `Room`, `Zone`.
- Annotations: `iot:sampling_rate`, `iot:calibration`, `iot:last_seen`,
  `matter:cluster`, `brick:class`.
- Source schemes: `sensor://`, `matter://`, `bacnet://`, `modbus://`,
  `knx://`, `zigbee://`.

### B.2 FinTech (`kndl://std/fin`)

- Types: `Account`, `Transaction`, `Instrument`, `Position`, `Quote`.
- Constraint: `Transaction` MUST satisfy `sum(debits) == sum(credits)`
  (double-entry) with matching currencies per leg.
- Annotations: `fin:jurisdiction`, `fin:mic` (market identifier code).

### B.3 Healthcare (`kndl://std/fhir`)

- Types: `Patient`, `Encounter`, `Observation`, `Condition`, `Medication`,
  `Allergy`, `Consent`.
- Classifications: `~classification "PHI"`; `~consent` required on write.
- Terminology: `Code<"SNOMED-CT">`, `Code<"ICD-10">`, `Code<"LOINC">`,
  `Code<"RxNorm">`.

### B.4 Logistics (`kndl://std/logistics`)

- Types: `Shipment`, `Package`, `Lot`, `Hub`, `Route`.
- Processes: `shipment_sm` standard state machine.
- Identifiers: `gtin:`, `sscc:`.

### B.5 Robotics (`kndl://std/robotics`)

- Types: `Robot`, `Joint`, `EndEffector`, `Trajectory`, `Obstacle`.
- All spatial fields require `~frame`. TF tree mandatory.
- `Pose<Frame>` as primary spatial type.

### B.6 Smart Factory (`kndl://std/isa95`)

- ISA-95 hierarchy: `Enterprise`, `Site`, `Area`, `WorkCenter`, `WorkUnit`.
- Types: `Product`, `BOM`, `Operation`, `DowntimeEvent`, `QualityDefect`.
- `BOM` uses reification (§ Appendix C) for n-ary composition.

### B.7 Networking / Security (`kndl://std/net`)

- Types: `Host`, `Interface`, `Link`, `Flow`, `Vulnerability`, `Indicator`.
- Primitives: `IPv4`, `IPv6`, `MAC`, `CIDR`, `Port`.
- STIX bridge under namespace `stix:`.

### B.8 eCommerce (`kndl://std/ecom`)

- Types: `Product`, `Variant`, `Price`, `Inventory`, `Cart`, `Order`.
- `Inventory.quantity` pairs with `~decay` to model staleness.
- Product names: `Localized<String>`.

---

## Appendix C: Reification Pattern for N-ary Relations

Edges are binary. When a relation has more than two participants (e.g.
"Patient received Drug at Dose via Route at Time"), reify the relation
as a node:

```kndl
node @admin_4821 :: MedicationAdministration {
  patient  -> @pat_001
  drug     -> @rx_warfarin
  dose     = 5 mg
  route    = "oral"
  at       = 2026-04-10T08:00Z
  ~source  "fhir://hospital/MedicationAdministration/4821"
}
```

This idiom keeps the graph binary-edged while supporting arbitrary arity
and giving the relation its own identity, provenance, and temporal scope.

---

## Appendix D: MIME Type

```
text/kndl           — KNDL text format
application/kndl+b  — KNDL binary format
```

File extensions: `.kndl` (text), `.kndlb` (binary).
