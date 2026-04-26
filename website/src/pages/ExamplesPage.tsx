import { Link } from "react-router";
import { SEO, techArticleSchema } from "../components/SEO";
import { DOMAINS, type DomainBundle } from "../data/examples";
import styles from "./ExamplesPage.module.css";

const DOMAIN_ICONS: Record<string, string> = {
  "loan-decision":   "bank",
  "iot-sensor":      "cpu",
  "personal-memory": "person",
  "threat-intel":    "shield",
  "clinical":        "health",
  "legal-ediscovery":"legal",
  "scientific-lab":  "flask",
  "ai-evals":        "chart",
};

const ICON_SVG: Record<string, string> = {
  bank:   "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11",
  cpu:    "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18",
  person: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  health: "M22 12h-4l-3 9L9 3l-3 9H2",
  legal:  "M3 6h18M3 12h18M3 18h18",
  flask:  "M8 2v4l-5 10a2 2 0 001.8 2.9h14.4A2 2 0 0021 16L16 6V2M8 2h8",
  chart:  "M18 20V10M12 20V4M6 20v-6",
};

function DomainIcon({ id }: { id: string }) {
  const key = DOMAIN_ICONS[id] ?? "chart";
  const path = ICON_SVG[key] ?? ICON_SVG.chart;
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function domainStats(d: DomainBundle) {
  const confidences = d.facts.map(f => f.confidence);
  const minConf = Math.min(...confidences);
  const maxConf = Math.max(...confidences);
  const hasPHI = d.facts.some(f => f.classification === "PHI");
  const hasPII = d.facts.some(f => f.classification === "PII");
  const hasSupersession = d.facts.some(f => f.supersedes);
  const hasDerivedFrom = d.facts.some(f => f.derivedFrom && f.derivedFrom.length > 0);

  return { minConf, maxConf, hasPHI, hasPII, hasSupersession, hasDerivedFrom };
}

function DomainCard({ domain }: { domain: DomainBundle }) {
  const { minConf, maxConf, hasPHI, hasPII, hasSupersession, hasDerivedFrom } = domainStats(domain);

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <DomainIcon id={domain.id} />
        <div className={styles.cardMeta}>
          <div className={styles.cardName}>{domain.name}</div>
          <div className={styles.factBadge}>{domain.facts.length} facts</div>
        </div>
      </div>
      <p className={styles.cardDesc}>{domain.description}</p>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>confidence range</span>
          <span className={styles.statValue}>{minConf.toFixed(2)} – {maxConf.toFixed(2)}</span>
        </div>
        <div className={styles.badges}>
          {hasPHI && <span className={styles.badge} data-type="phi">PHI</span>}
          {hasPII && <span className={styles.badge} data-type="pii">PII</span>}
          {hasSupersession && <span className={styles.badge} data-type="supersedes">supersession</span>}
          {hasDerivedFrom && <span className={styles.badge} data-type="derived">derivedFrom</span>}
        </div>
      </div>
      <Link to={`/explorer?domain=${domain.id}`} className={styles.exploreLink}>
        Explore <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export default function ExamplesPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Examples — 8 Domain Bundles"
        description="Eight real-world KNDL fact bundles: loan decision, IoT sensors, personal memory, threat intelligence, clinical records, legal eDiscovery, scientific lab, and AI evals."
        path="/examples"
        type="article"
        keywords="KNDL examples, fact bundles, loan decision, IoT sensor, clinical records, threat intel, AI evals"
        jsonLd={techArticleSchema({
          headline: "KNDL Examples — 8 Domain Bundles",
          description: "Eight real-world KNDL fact bundles across different domains.",
          path: "/examples",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.tag}>Examples</div>
          <h1 className={styles.title}>Domain Fact Bundles</h1>
          <p className={styles.desc}>
            Eight domains showing KNDL in the real world. Each bundle includes facts
            with confidence, decay, supersession, provenance, and classification
            appropriate to the domain.
          </p>
        </div>

        <div className={styles.grid}>
          {DOMAINS.map((d) => (
            <DomainCard key={d.id} domain={d} />
          ))}
        </div>

        <div className={styles.footer}>
          <p className={styles.footerText}>
            Facts are stored as <code className={styles.ic}>.fact.json</code> files in the{" "}
            <code className={styles.ic}>skills/kndl-memory/examples/</code> directory.
            Click any card to explore its facts in the interactive explorer.
          </p>
        </div>

      </div>
    </div>
  );
}
