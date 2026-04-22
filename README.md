# KNDL — Knowledge Node Description Language

Give your AI agent a memory it can reason over.

KNDL is a small language for describing knowledge as a graph. Each fact is a **node** with typed fields. Relationships between facts are **edges**. Every piece of data carries a **confidence score** and can expire or decay over time — so your agent always knows how much to trust what it knows:

- `~confidence` — every fact carries a 0.0–1.0 certainty score. Agents reason probabilistically instead of treating everything as equally true.
- `~decay` — confidence degrades over time automatically. A sensor reading from 5 minutes ago is more trustworthy than one from 5 hours ago. This is huge for your IoT/building automation domain.
- `~source` + `~derived` — provenance is baked in, not bolted on. You can trace any assertion back to its origin and compute trust transitively across the graph.
- `intent blocks` — no other data format tells agents what to do. KNDL includes trigger-action patterns natively, so knowledge and behavior live together.
- Graph-native edges — relationships are first-class with types and weights, not nested object references that lose meaning.

## What's in v0.2 (April 2026)

- **Dimensionally safe values**: `Quantity<D>` with first-class unit literals (`22.5 °C`, `5 m/s`, `100 kWh`). No more `"°F"` vs `"F"` silent bugs.
- **Money type**: `Decimal` + ISO 4217 currency (`19.99d USD`). No floats for money.
- **Bitemporal facts**: `~valid` (true-in-the-world) is separate from `~recorded` (learned-by-system) and `~observed` (directly seen).
- **Strong negation**: explicit open-world assumption with `~negated true` for "known false" (critical for medicine, security).
- **Structured uncertainty**: `~uncertainty` carries Gaussians, intervals, categorical distributions, histograms — not just a scalar.
- **Coordinate frames**: `Frame` / `Pose<Frame>` for robotics and indoor spatial reasoning.
- **Vectors**: `Vector<N>` primitive for embeddings and similarity search.
- **Processes**: stateful workflows with states, transitions, and compensation — sibling to reactive intents.
- **Path queries**: multi-hop patterns with repetition (`-[contains*1..5]->`).
- **Cryptographic provenance**: `~signature`, `~attestation` annotations and a signature block in the binary format.
- **Structured access policy**: `~access { read, write, purpose, classify }` replaces the free-form string.
- **Domain profiles**: importable std libraries for IoT/PropTech, FinTech, Healthcare (FHIR), Logistics, Robotics, Smart Factory (ISA-95), Networking/Security, eCommerce.

See `spec/SPECIFICATION.md` for the full language reference and `spec/grammar/kndl.ebnf` for the authoritative grammar. Appendix E of the spec lists every breaking change since v0.1.
