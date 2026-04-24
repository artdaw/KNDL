# KNDL Examples

Curated `.kndl` snippets. Each file is self-contained and parses against the
v1.0 grammar (`/spec/kndl.ebnf`). Use them as starting points, test fixtures,
or tutorial material.

| File | Demonstrates |
|------|--------------|
| [`basic-building.kndl`](basic-building.kndl) | Node declaration, typed edges, `~confidence`, `~source`, `~valid`, `~decay`. |
| [`intent-overheat.kndl`](intent-overheat.kndl) | Reactive intent with a query trigger and multiple `emit` actions. |
| [`process-shipment.kndl`](process-shipment.kndl) | Stateful process with five states, transitions, and a `compensate` block. |
| [`query-aggregation.kndl`](query-aggregation.kndl) | Multi-hop path pattern, `group by`, aggregation functions. |
| [`healthcare-observation.kndl`](healthcare-observation.kndl) | `Code<System>` for SNOMED/LOINC, bitemporal annotations, `~negated`, `~classification`. |
| [`fintech-transaction.kndl`](fintech-transaction.kndl) | `Money` literals, double-entry via balanced edges, `~signature`. |
| [`robotics-pose.kndl`](robotics-pose.kndl) | `Frame`, `Pose<Frame>`, Gaussian `~uncertainty`. |
| [`logistics-trace.kndl`](logistics-trace.kndl) | GTIN identifiers, multi-hop `ships_to*` path, chain-of-custody signatures. |

Everything here is MIT-licensed, same as the rest of the KNDL project.
