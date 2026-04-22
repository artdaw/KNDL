# KNDL — Knowledge Node Description Language

Give your AI agent a memory it can reason over.

KNDL is a small language for describing knowledge as a graph. Each fact is a **node** with typed fields. Relationships between facts are **edges**. Every piece of data carries a **confidence score** and can expire or decay over time — so your agent always knows how much to trust what it knows:

- `~confidence` — every fact carries a 0.0–1.0 certainty score. Agents reason probabilistically instead of treating everything as equally true.
- `~decay` — confidence degrades over time automatically. A sensor reading from 5 minutes ago is more trustworthy than one from 5 hours ago. This is huge for your IoT/building automation domain.
- `~source` + `~derived` — provenance is baked in, not bolted on. You can trace any assertion back to its origin and compute trust transitively across the graph.
- `intent blocks` — no other data format tells agents what to do. KNDL includes trigger-action patterns natively, so knowledge and behavior live together.
- Graph-native edges — relationships are first-class with types and weights, not nested object references that lose meaning.