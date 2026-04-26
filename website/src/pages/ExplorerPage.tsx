import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { SEO, techArticleSchema } from "../components/SEO";
import { DOMAINS, type DomainBundle, type Fact } from "../data/examples";
import styles from "./ExplorerPage.module.css";

// ── Decay helpers ─────────────────────────────────────────────────────────────

function parseDecay(decay: string): { rate: number; windowSec: number } | null {
  const m = decay.match(/^([0-9.]+)\/(\d+)(s|m|h|d)$/);
  if (!m) return null;
  const rate = parseFloat(m[1]);
  const n = parseInt(m[2], 10);
  const unit = m[3];
  const unitSec: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return { rate, windowSec: n * (unitSec[unit] ?? 86400) };
}

function effectiveConfidence(fact: Fact): number {
  if (!fact.decay) return fact.confidence;
  const parsed = parseDecay(fact.decay);
  if (!parsed) return fact.confidence;
  const { rate, windowSec } = parsed;
  const validFrom = new Date(fact.validFrom).getTime();
  const now = Date.now();
  const elapsedSec = (now - validFrom) / 1000;
  if (elapsedSec <= 0) return fact.confidence;
  return fact.confidence * Math.pow(rate, elapsedSec / windowSec);
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ base, effective }: { base: number; effective: number }) {
  const basePct = Math.round(base * 100);
  const effPct = Math.round(effective * 100);
  const color = effPct > 70 ? "var(--accent)" : effPct > 40 ? "var(--accent4)" : "var(--accent3)";
  return (
    <div className={styles.confBar}>
      <div className={styles.confTrack}>
        <div
          className={styles.confFillBase}
          style={{ width: `${basePct}%` }}
          title={`Base: ${basePct}%`}
        />
        <div
          className={styles.confFillEff}
          style={{ width: `${effPct}%`, background: color }}
          title={`Effective: ${effPct}%`}
        />
      </div>
      <div className={styles.confLabels}>
        <span className={styles.confBase}>{base.toFixed(2)}</span>
        {effective !== base && (
          <>
            <span className={styles.confArrow}>→</span>
            <span className={styles.confEff} style={{ color }}>{effective.toFixed(2)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Classification badge ──────────────────────────────────────────────────────

function ClassBadge({ cls }: { cls: string }) {
  const colorMap: Record<string, string> = {
    PHI:          "var(--accent3)",
    PII:          "var(--accent3)",
    CONFIDENTIAL: "var(--accent4)",
    INTERNAL:     "var(--accent2)",
    PUBLIC:       "var(--accent)",
  };
  return (
    <span className={styles.classBadge} style={{ color: colorMap[cls] ?? "var(--text-dim)", borderColor: colorMap[cls] ?? "var(--border)" }}>
      {cls}
    </span>
  );
}

// ── Fact card ─────────────────────────────────────────────────────────────────

function FactCard({
  fact,
  isSuperseded,
}: {
  fact: Fact;
  isSuperseded: boolean;
}) {
  const eff = effectiveConfidence(fact);
  const shortId = fact["@id"].replace(/^fact:/, "").slice(-20);
  const shortSource = fact.source.replace(/^https?:\/\//, "").slice(0, 48);

  return (
    <div className={`${styles.factCard} ${isSuperseded ? styles.superseded : ""}`}>
      {isSuperseded && (
        <div className={styles.supersededBanner}>superseded</div>
      )}
      {fact.negated && (
        <div className={styles.negatedBanner}>negated</div>
      )}

      <p className={styles.statement}>{fact.statement}</p>

      {(fact.subject || fact.predicate || fact.object !== undefined) && (
        <div className={styles.spo}>
          {fact.subject && <span className={styles.spoSubject}>{fact.subject}</span>}
          {fact.predicate && <span className={styles.spoPredicate}>{fact.predicate}</span>}
          {fact.object !== undefined && (
            <span className={styles.spoObject}>{String(fact.object)}</span>
          )}
        </div>
      )}

      <ConfBar base={fact.confidence} effective={eff} />

      <div className={styles.meta}>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>source</span>
          <span className={styles.metaValue} title={fact.source}>{shortSource}</span>
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
          {fact.supersedes && (
            <span className={styles.linkBadge} title={fact.supersedes}>supersedes ↑</span>
          )}
          {fact.derivedFrom && fact.derivedFrom.length > 0 && (
            <span className={styles.linkBadge} title={fact.derivedFrom.join(", ")}>
              derived from {fact.derivedFrom.length}
            </span>
          )}
        </div>
        {fact.tags && fact.tags.length > 0 && (
          <div className={styles.tags}>
            {fact.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
          </div>
        )}
      </div>

      <div className={styles.factId} title={fact["@id"]}>…{shortId}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domainParam = searchParams.get("domain") ?? "loan-decision";

  const [selectedDomainId, setSelectedDomainId] = useState(domainParam);

  const domain: DomainBundle =
    DOMAINS.find(d => d.id === selectedDomainId) ?? DOMAINS[0];

  // Build superseded fact ID set
  const supersededIds = useCallback(() => {
    const ids = new Set<string>();
    for (const f of domain.facts) {
      if (f.supersedes) ids.add(f.supersedes);
    }
    return ids;
  }, [domain]);

  const superseded = supersededIds();

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("domain", selectedDomainId);
      return next;
    }, { replace: true });
  }, [selectedDomainId, setSearchParams]);

  // Sync URL → state if user pastes link
  useEffect(() => {
    const d = searchParams.get("domain");
    if (d && d !== selectedDomainId && DOMAINS.some(x => x.id === d)) {
      setSelectedDomainId(d);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Explorer — Browse Fact Bundles"
        description="Explore KNDL fact bundles across 8 domains. Visualise confidence, effective decay, supersession chains, provenance, and classification badges in an interactive card view."
        path="/explorer"
        type="website"
        keywords="KNDL explorer, fact browser, confidence decay, supersession, provenance, JSON-LD facts"
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
            <span className={styles.statItem}>
              <span className={styles.statVal}>{domain.facts.length}</span>
              <span className={styles.statLbl}>facts</span>
            </span>
            <span className={styles.statItem}>
              <span className={styles.statVal}>{superseded.size}</span>
              <span className={styles.statLbl}>superseded</span>
            </span>
            <span className={styles.statItem}>
              <span className={styles.statVal}>
                {(domain.facts.reduce((s, f) => s + effectiveConfidence(f), 0) / domain.facts.length).toFixed(2)}
              </span>
              <span className={styles.statLbl}>avg eff. conf</span>
            </span>
          </div>
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

      <div className={styles.domainDesc}>
        {domain.description}
      </div>

      <div className={styles.grid}>
        {domain.facts.map(fact => (
          <FactCard
            key={fact["@id"]}
            fact={fact}
            isSuperseded={superseded.has(fact["@id"])}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <span>Confidence bar: dim = base &nbsp;|&nbsp; bright = effective (post-decay)</span>
        <span>Grey cards are superseded by a newer fact in this bundle</span>
      </div>
    </div>
  );
}
