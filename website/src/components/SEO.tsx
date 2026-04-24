import { useEffect } from "react";

const ORIGIN = "https://kndl.artdaw.com";
const DEFAULT_IMAGE = `${ORIGIN}/kndl.png`;

export interface SEOProps {
  title: string;
  description: string;
  /** Path including leading slash, e.g. "/spec". Used for canonical + OG URLs. */
  path: string;
  /** Absolute image URL; defaults to site-wide OG image. */
  image?: string;
  /** Open Graph type — "website" for index pages, "article" for spec/docs. */
  type?: "website" | "article";
  /** Optional JSON-LD object (schema.org). Gets serialised into a script tag. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** ISO 8601 date for schema.org dateModified. */
  dateModified?: string;
  /** Optional comma-separated keywords. */
  keywords?: string;
}

export function SEO({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  type = "website",
  jsonLd,
  dateModified,
  keywords,
}: SEOProps) {
  useEffect(() => {
    const url = ORIGIN + path;

    document.title = title;
    document.documentElement.setAttribute("lang", "en");

    setMeta("description", description, "name");
    if (keywords) setMeta("keywords", keywords, "name");
    setMeta("robots", "index,follow,max-image-preview:large", "name");

    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:url", url, "property");
    setMeta("og:type", type, "property");
    setMeta("og:image", image, "property");
    setMeta("og:site_name", "KNDL", "property");

    setMeta("twitter:card", "summary_large_image", "name");
    setMeta("twitter:title", title, "name");
    setMeta("twitter:description", description, "name");
    setMeta("twitter:url", url, "name");
    setMeta("twitter:image", image, "name");

    if (dateModified) {
      setMeta("article:modified_time", dateModified, "property");
    }

    setLink("canonical", url);
    setLink("alternate", "/llms.txt", "llm");

    if (jsonLd) {
      setJsonLd(jsonLd);
    } else {
      clearJsonLd();
    }
  }, [title, description, path, image, type, dateModified, keywords, JSON.stringify(jsonLd)]);

  return null;
}

function setMeta(key: string, content: string, attr: "name" | "property") {
  const selector = `meta[${attr}="${key}"]`;
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setLink(rel: string, href: string, id?: string) {
  const selector = id
    ? `link[rel="${rel}"][data-id="${id}"]`
    : `link[rel="${rel}"]:not([data-id])`;
  let tag = document.head.querySelector<HTMLLinkElement>(selector);
  if (!tag) {
    tag = document.createElement("link");
    tag.rel = rel;
    if (id) tag.setAttribute("data-id", id);
    document.head.appendChild(tag);
  }
  tag.href = href;
}

function setJsonLd(data: Record<string, unknown> | Record<string, unknown>[]) {
  let tag = document.head.querySelector<HTMLScriptElement>(
    'script[type="application/ld+json"][data-seo="page"]',
  );
  if (!tag) {
    tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.setAttribute("data-seo", "page");
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(data);
}

function clearJsonLd() {
  const tag = document.head.querySelector(
    'script[type="application/ld+json"][data-seo="page"]',
  );
  if (tag) tag.remove();
}

// ── Schema.org helpers ─────────────────────────────────────────────────────

export const ORG_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "KNDL",
  url: ORIGIN,
  logo: DEFAULT_IMAGE,
  sameAs: [
    "https://github.com/artdaw/KNDL",
  ],
};

export function techArticleSchema(params: {
  headline: string;
  description: string;
  path: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: params.headline,
    description: params.description,
    url: ORIGIN + params.path,
    mainEntityOfPage: ORIGIN + params.path,
    dateModified: params.dateModified ?? new Date().toISOString().slice(0, 10),
    inLanguage: "en",
    publisher: {
      "@type": "Organization",
      name: "KNDL",
      url: ORIGIN,
    },
    image: DEFAULT_IMAGE,
  };
}

export function softwareSourceCodeSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: "KNDL — Knowledge Node Description Language",
    codeRepository: "https://github.com/artdaw/KNDL",
    programmingLanguage: "KNDL",
    url: ORIGIN,
    description:
      "A graph-based knowledge representation language for AI agents — typed nodes, confidence scores, temporal decay, cryptographic provenance, and native intent/process blocks.",
    license: "https://opensource.org/licenses/MIT",
  };
}
