import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./ProtocolPage.module.css";

const FACT_EXAMPLE = `{
  "@id":        "fact:customer-9281-creditscore-20260425T235249Z-b6c88774",
  "@type":      "Fact",
  "statement":  "Customer 9281 credit score is 740",

  "subject":    "customer:9281",
  "predicate":  "creditScore",
  "object":     740,

  "confidence": 0.96,
  "decay":      "0.5/30d",

  "source":     "https://api.experian.com/9281",
  "validFrom":  "2026-04-26T00:00:00Z",
  "recordedAt": "2026-04-25T23:52:49Z",

  "supersedes": "fact:customer-9281-creditscore-20260425T235231Z-cd2efb00",
  "tags":       ["credit", "bureau-experian"]
}`;

const FIELDS = [
  { name: "@id",         type: "string",   required: true,  desc: "Unique fact URI. Convention: fact:{subject}-{predicate}-{timestamp}-{hash8}." },
  { name: "@type",       type: "string",   required: true,  desc: 'Always "Fact". Reserved for schema versioning.' },
  { name: "statement",   type: "string",   required: true,  desc: "Human-readable sentence asserting the fact. Used by agents as the primary text." },
  { name: "subject",     type: "string",   required: false, desc: "Entity the fact is about. Namespace:localId format (e.g. customer:9281, patient:001)." },
  { name: "predicate",   type: "string",   required: false, desc: "Relationship or property being asserted (e.g. creditScore, diagnosis, temperature_celsius)." },
  { name: "object",      type: "any",      required: false, desc: "Value of the predicate. Can be string, number, boolean, or object." },
  { name: "confidence",  type: "number",   required: true,  desc: "Base certainty of the fact. Range 0.0–1.0. Agents use effective confidence after decay." },
  { name: "decay",       type: "string",   required: false, desc: 'Confidence decay spec: "rate/window". Examples: "0.5/30d", "0.5/1h", "0.5/90d". See formula below.' },
  { name: "source",      type: "string",   required: true,  desc: "Provenance URI. Scheme indicates authority: https://, human://, agent://, sensor://, lab://, clinician://." },
  { name: "validFrom",   type: "ISO 8601", required: true,  desc: "When the fact became true in the world (transaction time)." },
  { name: "validUntil",  type: "ISO 8601", required: false, desc: "When the fact stopped being true. Omit if still valid." },
  { name: "observedAt",  type: "ISO 8601", required: false, desc: "When the event was observed. Use when different from validFrom (e.g. sensor lag)." },
  { name: "recordedAt",  type: "ISO 8601", required: true,  desc: "When the fact was written to memory (system time)." },
  { name: "supersedes",  type: "string",   required: false, desc: "Fact @id that this fact replaces. The superseded fact is retained but agents prefer the newer one." },
  { name: "derivedFrom", type: "string[]", required: false, desc: "Fact @ids that were used to derive this fact. Enables provenance chain traversal." },
  { name: "negated",     type: "boolean",  required: false, desc: 'If true, asserts that the object does NOT apply. E.g. "patient has NO penicillin allergy".' },
  { name: "classification", type: "string", required: false, desc: "Data sensitivity label. Common values: PHI, PII, CONFIDENTIAL, INTERNAL, PUBLIC." },
  { name: "consent",     type: "string",   required: false, desc: "Consent record URI governing access to this fact (clinical/legal contexts)." },
  { name: "retention",   type: "string",   required: false, desc: "ISO 8601 duration specifying how long the fact must be retained (e.g. P7Y = 7 years)." },
  { name: "tenant",      type: "string",   required: false, desc: "Tenant or workspace identifier for multi-tenant deployments." },
  { name: "tags",        type: "string[]", required: false, desc: "Free-form labels for filtering, categorisation, and search." },
];

const DECAY_EXAMPLES = [
  { decay: "0.5/24h", elapsed: "1h",  base: 0.9, effective: (0.9 * Math.pow(0.5, 1/24)).toFixed(3) },
  { decay: "0.5/24h", elapsed: "6h",  base: 0.9, effective: (0.9 * Math.pow(0.5, 6/24)).toFixed(3) },
  { decay: "0.5/24h", elapsed: "24h", base: 0.9, effective: (0.9 * Math.pow(0.5, 24/24)).toFixed(3) },
  { decay: "0.5/30d", elapsed: "7d",  base: 0.95, effective: (0.95 * Math.pow(0.5, 7/30)).toFixed(3) },
  { decay: "0.5/30d", elapsed: "30d", base: 0.95, effective: (0.95 * Math.pow(0.5, 30/30)).toFixed(3) },
  { decay: "0.5/1h",  elapsed: "30m", base: 0.99, effective: (0.99 * Math.pow(0.5, 0.5/1)).toFixed(3) },
];

export default function ProtocolPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Protocol — Fact Schema Reference"
        description="Field-by-field reference for the KNDL Fact JSON-LD shape. All fields, types, constraints, the decay formula, and JSON Schema link."
        path="/protocol"
        type="article"
        keywords="KNDL fact schema, JSON-LD fact, confidence decay, bitemporal facts, provenance, fact format"
        jsonLd={techArticleSchema({
          headline: "KNDL Protocol — Fact Schema Reference",
          description: "Field-by-field reference for the KNDL Fact JSON-LD shape.",
          path: "/protocol",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.tag}>Protocol</div>
          <h1 className={styles.title}>The Fact Schema</h1>
          <p className={styles.desc}>
            Every KNDL memory entry is a <strong>Fact</strong> — a JSON-LD document asserting
            one claim about the world, with confidence, provenance, and temporal bounds baked in.
            No fact is bare data: every assertion knows when it was true, who said so, and how
            much to trust it.
          </p>
        </div>

        {/* Section 1: Annotated example */}
        <section className={styles.section}>
          <h2 className={styles.h2}>The Fact Shape</h2>
          <p className={styles.p}>
            A credit-score fact from the loan-decision domain, showing the
            full field set including supersession:
          </p>
          <div className={styles.codeWrap}>
            <div className={styles.codeLabel}>fact-customer-9281-creditscore.fact.json</div>
            <pre className={styles.pre}>{FACT_EXAMPLE}</pre>
          </div>
        </section>

        {/* Section 2: Field reference table */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Field Reference</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.name}>
                    <td><code className={styles.fieldName}>{f.name}</code></td>
                    <td><span className={styles.fieldType}>{f.type}</span></td>
                    <td>
                      <span className={f.required ? styles.required : styles.optional}>
                        {f.required ? "yes" : "no"}
                      </span>
                    </td>
                    <td className={styles.fieldDesc}>{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Decay formula */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Decay Formula</h2>
          <p className={styles.p}>
            Effective confidence degrades over time. Given a decay spec <code className={styles.ic}>rate/window</code>,
            the formula is:
          </p>
          <div className={styles.formulaBlock}>
            <span className={styles.formulaMath}>
              effective = confidence × rate<sup>(elapsed / window)</sup>
            </span>
          </div>
          <p className={styles.p} style={{ marginTop: "16px" }}>
            Where <code className={styles.ic}>elapsed</code> is the time since <code className={styles.ic}>validFrom</code> in
            the same unit as <code className={styles.ic}>window</code>. When <code className={styles.ic}>elapsed = window</code>,
            effective confidence equals <code className={styles.ic}>confidence × rate</code> — a 50% half-life for the common <code className={styles.ic}>0.5/T</code> spec.
          </p>

          <div className={styles.tableWrap} style={{ marginTop: "24px" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Decay spec</th>
                  <th>Base confidence</th>
                  <th>Elapsed</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {DECAY_EXAMPLES.map((d, i) => (
                  <tr key={i}>
                    <td><code className={styles.fieldName}>{d.decay}</code></td>
                    <td className={styles.numCell}>{d.base}</td>
                    <td className={styles.numCell}>{d.elapsed}</td>
                    <td>
                      <span className={styles.effectiveConf} style={{
                        color: parseFloat(d.effective) > 0.7 ? "var(--accent)" :
                               parseFloat(d.effective) > 0.4 ? "var(--accent4)" : "var(--accent3)"
                      }}>
                        {d.effective}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: JSON Schema badge */}
        <section className={styles.section}>
          <h2 className={styles.h2}>JSON Schema</h2>
          <p className={styles.p}>
            A machine-readable JSON Schema for validating fact files.
            Use it with <code className={styles.ic}>ajv</code>, <code className={styles.ic}>jsonschema</code>,
            or any JSON Schema v7 validator.
          </p>
          <a
            href="https://kndl.artdaw.com/schema/kndl-memory.schema.json"
            target="_blank"
            rel="noreferrer"
            className={styles.schemaLink}
          >
            <span className={styles.schemaIcon}>{ }</span>
            <span className={styles.schemaText}>kndl-memory.schema.json</span>
            <span className={styles.schemaArrow}>↗</span>
          </a>
          <p className={styles.p} style={{ marginTop: "16px" }}>
            File naming convention:{" "}
            <code className={styles.ic}>fact-{"{subject}"}-{"{predicate}"}-{"{timestamp}"}-{"{hash8}"}.fact.json</code>
          </p>
        </section>

      </div>
    </div>
  );
}
