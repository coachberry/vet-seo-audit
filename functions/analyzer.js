// ═══════════════════════════════════════════════════
//  analyzer.js — Claude-powered SEO analysis engine
//  Sends REAL parsed HTML data to Claude for vet-specific scoring
// ═══════════════════════════════════════════════════
const Anthropic = require('@anthropic-ai/sdk');

// ── Vet-specific schema types Claude knows to check ──
const VET_REQUIRED_SCHEMA = [
  'LocalBusiness',
  'AnimalHospital',
  'VeterinaryCare',
  'Organization',
  'WebSite',
  'WebPage'
];

const VET_RECOMMENDED_SCHEMA = [
  'FAQPage',
  'Review',
  'AggregateRating',
  'Person',       // doctor bios
  'MedicalBusiness',
  'GeoCoordinates',
  'PostalAddress',
  'OpeningHoursSpecification',
  'BreadcrumbList',
  'Article',      // blog posts
  'Service',      // individual service pages
  'ImageObject',
  'Physician',
  'ContactPoint',
  'SiteLinksSearchBox'
];

// ── Score a single page ───────────────────────────
async function analyzePage(pageData, client) {
  const prompt = buildPagePrompt(pageData);
  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}

// ── Analyze entire site ───────────────────────────
async function analyzeSite(crawlData, client) {
  const { pages, domain, xmlSitemap, hasRobotsTxt } = crawlData;

  // Analyze pages with concurrency limit
  const CONCURRENCY = 2;
  const analyzedPages = [];

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => analyzePage(p, client)));
    batch.forEach((page, idx) => {
      analyzedPages.push({
        url: page.url,
        pageTitle: page.pageTitle,
        scores: results[idx]?.scores || defaultScores(),
        audit: results[idx]?.audit || {},
        flags: buildFlags(page, results[idx]),
        schemaTypes: page.schemaTypes || [],
        missingSchema: getMissingSchema(page, results[idx])
      });
    });
  }

  // Site-wide analysis
  const siteAnalysis = await analyzeSiteWide(crawlData, analyzedPages, client);

  // Compute averages
  const siteAverages = computeAverages(analyzedPages);

  return {
    domain,
    auditDate: new Date().toISOString(),
    totalPagesCrawled: pages.length,
    hasRobotsTxt,
    hasXMLSitemap: xmlSitemap?.found || false,
    xmlSitemapUrl: xmlSitemap?.url || null,
    siteAverages,
    siteWideAnalysis: siteAnalysis,
    pages: analyzedPages
  };
}

// ── Site-wide analysis prompt ─────────────────────
async function analyzeSiteWide(crawlData, analyzedPages, client) {
  const summary = {
    domain: crawlData.domain,
    totalPages: crawlData.totalPagesCrawled,
    hasRobotsTxt: crawlData.hasRobotsTxt,
    hasXMLSitemap: crawlData.xmlSitemap?.found,
    pagesWithSchema: crawlData.pages.filter(p => p.schemas.length > 0).length,
    pagesWithH1: crawlData.pages.filter(p => p.h1s.length > 0).length,
    pagesWithNoindex: crawlData.pages.filter(p => p.isNoindex).length,
    pagesWithDuplicateTitles: findDuplicates(crawlData.pages.map(p => p.pageTitle)).length,
    pagesWithDuplicateDescriptions: findDuplicates(crawlData.pages.map(p => p.metaDescription)).length,
    pagesWithMissingAlt: crawlData.pages.filter(p => p.imagesWithoutAlt > 0).length,
    averageWordCount: Math.round(crawlData.pages.reduce((s, p) => s + p.wordCount, 0) / crawlData.pages.length),
    avgScores: computeAverages(analyzedPages)
  };

  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    system: buildSystemPrompt(),
    messages: [{
      role: 'user',
      content: `You are auditing ${crawlData.domain}, a veterinary website. Based on this site-wide summary, provide a JSON response with:
{
  "overallFindings": "3-4 paragraph professional assessment of the site's SEO health",
  "topPriorities": [
    { "action": "string", "impact": "HIGH|MEDIUM|LOW", "effort": "HIGH|MEDIUM|LOW", "category": "string" }
  ],
  "quickWins": ["string"],
  "localSEOFindings": "paragraph",
  "contentStrategy": "paragraph",
  "schemaStrategy": "paragraph",
  "geoAIStrategy": "paragraph"
}

Site data: ${JSON.stringify(summary)}`
    }]
  });

  try {
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}

// ── Sitemap analysis ──────────────────────────────
async function analyzeSitemap(crawlData, client) {
  const { pages, domain, hasRobotsTxt, xmlSitemap } = crawlData;
  const { buildHierarchy, classifyPage } = require('./crawler');

  const pageSummaries = pages.map(p => ({
    url: p.url,
    status: p.status,
    isNoindex: p.isNoindex,
    isOrphan: p.isOrphan,
    pageTitle: p.pageTitle,
    wordCount: p.wordCount,
    type: classifyPage(p.url, p.pageTitle || '')
  }));

  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    system: buildSystemPrompt(),
    messages: [{
      role: 'user',
      content: `You are a veterinary SEO expert auditing the sitemap of ${domain}. Analyze these ${pages.length} crawled pages.

Respond with JSON ONLY:
{
  "domain": "${domain}",
  "crawlability": {
    "score": number,
    "issues": ["string"]
  },
  "urlAnalysis": {
    "strengths": ["string"],
    "issues": ["string"],
    "recommendations": ["string"]
  },
  "pageIssues": [
    {
      "url": "string",
      "status": "noindex|orphan|redirect|error|thin",
      "issue": "string",
      "recommendation": "string — be specific about whether to keep, remove, noindex, or improve"
    }
  ],
  "overallReport": "3 paragraph expert analysis of the site structure for veterinary SEO"
}

Pages: ${JSON.stringify(pageSummaries)}
Has robots.txt: ${hasRobotsTxt}
Has XML sitemap: ${xmlSitemap?.found}
XML sitemap URL count: ${xmlSitemap?.urls?.length || 0}`
    }]
  });

  try {
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { urlAnalysis: { strengths: [], issues: [], recommendations: [] }, crawlability: { score: 0 } };
  }
}

// ── Competitor comparison ─────────────────────────
async function compareAnalysis(site1Data, site2Data, client) {
  const summary = {
    site1: { domain: site1Data.domain, averages: site1Data.siteAverages, totalPages: site1Data.totalPagesCrawled },
    site2: { domain: site2Data.domain, averages: site2Data.siteAverages, totalPages: site2Data.totalPagesCrawled }
  };

  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2500,
    system: buildSystemPrompt(),
    messages: [{
      role: 'user',
      content: `You are a veterinary SEO expert doing a competitive analysis. Compare these two vet websites.

Respond with JSON ONLY:
{
  "overallWinner": "site1|site2",
  "categoryWinners": {
    "overallSEO": "site1|site2",
    "localSEO": "site1|site2",
    "schemaStructuredData": "site1|site2",
    "geoAIReadiness": "site1|site2",
    "contentQuality": "site1|site2",
    "technicalSEO": "site1|site2",
    "eeAt": "site1|site2"
  },
  "site1Advantages": ["string"],
  "site2Advantages": ["string"],
  "summary": "3 paragraphs of expert competitive analysis from a veterinary SEO perspective",
  "recommendations": ["Specific actionable recommendations for the losing site to close the gap"]
}

Data: ${JSON.stringify(summary)}`
    }]
  });

  try {
    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}

// ── Build page analysis prompt ────────────────────
function buildPagePrompt(page) {
  return `Analyze this veterinary website page as a professional veterinary SEO and GEO expert.

URL: ${page.url}
Page Title: ${page.pageTitle} (${page.titleLength} chars)
Meta Description: ${page.metaDescription} (${page.metaDescLength} chars)
Canonical: ${page.canonical || 'none'}
Robots Meta: ${page.robotsMeta || 'none'}
Is Noindex: ${page.isNoindex}
Is Orphan: ${page.isOrphan || false}
HTTP Status: ${page.status}
Has HTTPS: ${page.hasHttps}
Word Count: ${page.wordCount}

H1s: ${JSON.stringify(page.h1s)}
H2s: ${JSON.stringify(page.h2s.slice(0, 8))}

Open Graph:
  Title: ${page.og.title}
  Description: ${page.og.description}
  Image: ${page.og.image ? 'Present' : 'MISSING'}
  Type: ${page.og.type}
  URL: ${page.og.url}

Twitter Card: ${page.twitter.card || 'MISSING'}

Schema Types Found: ${JSON.stringify(page.schemaTypes)}
Schema Data: ${JSON.stringify(page.schemas.map(s => ({ type: s['@type'], keys: Object.keys(s) })))}

NAP Data:
  Phones found: ${JSON.stringify(page.phones)}
  Address detected: ${page.hasAddress}
  Hours detected: ${page.hasHours}

Images: ${page.images.length} total, ${page.imagesWithoutAlt} missing alt text
Internal Links: ${page.internalLinks.length}
Has FAQ content: ${page.hasFAQContent}
Has Viewport Meta: ${page.hasViewport}
Scripts: ${page.scriptCount}, Stylesheets: ${page.styleCount}

REQUIRED SCHEMA for vet sites: ${VET_REQUIRED_SCHEMA.join(', ')}
RECOMMENDED SCHEMA for vet sites: ${VET_RECOMMENDED_SCHEMA.join(', ')}

Respond with JSON ONLY:
{
  "scores": {
    "overallSEO": <0-100>,
    "localSEO": <0-100>,
    "schemaStructuredData": <0-100>,
    "geoAIReadiness": <0-100>,
    "contentQuality": <0-100>,
    "technicalSEO": <0-100>,
    "eeAt": <0-100>
  },
  "audit": {
    "urlStructure": "Expert analysis of URL structure, slug quality, depth, keyword use",
    "metadata": "Title tag analysis (length, keyword presence, click-worthiness), meta description analysis",
    "openGraph": "OG tag completeness, image quality, social sharing readiness",
    "schema": "Which schema types are present, which are missing, quality of implementation for a vet site",
    "faqSchema": "Whether FAQ schema is present/recommended for this page type, implementation quality",
    "localSEO": "NAP consistency, local keyword use, geo-targeting, Google Business Profile signals",
    "contentEEAT": "Experience, Expertise, Authoritativeness, Trustworthiness signals — credentials, author info, citations",
    "geoAI": "How well structured for AI search (Perplexity, ChatGPT, Gemini, Google SGE) — answer-ready content, entity clarity, Q&A format",
    "technicalSEO": "HTTPS, viewport, canonical, robots meta, internal linking, image alt text, page load signals",
    "internalLinking": "Internal link analysis, anchor text quality, orphan risk",
    "priorityActions": [
      { "action": "Specific actionable recommendation", "impact": "HIGH|MEDIUM|LOW" },
      { "action": "Specific actionable recommendation", "impact": "HIGH|MEDIUM|LOW" },
      { "action": "Specific actionable recommendation", "impact": "HIGH|MEDIUM|LOW" }
    ]
  },
  "missingCriticalSchema": ["list of critical missing schema types for this page"],
  "recommendedSchema": ["list of recommended schema types for this page type"]
}`;
}

// ── System prompt ─────────────────────────────────
function buildSystemPrompt() {
  return `You are a world-class SEO expert who specializes exclusively in veterinary website SEO, Local SEO, and GEO (Generative Engine Optimization). You have 15+ years of experience auditing veterinary practice websites.

Your expertise covers:
- Schema.org markup for veterinary practices (AnimalHospital, VeterinaryCare, LocalBusiness, FAQPage, Review, AggregateRating, Person/Physician, Service, OpeningHoursSpecification, GeoCoordinates, PostalAddress, BreadcrumbList, ImageObject, Article, WebSite, WebPage, SiteLinksSearchBox, ContactPoint)
- Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) for medical/veterinary content
- Local SEO for veterinary practices (NAP consistency, Google Business Profile, local citations, proximity signals)
- GEO/AI readiness: optimizing content for AI search engines (Perplexity, ChatGPT search, Google SGE/AI Overviews, Gemini)
- Veterinary-specific content strategy: service pages, species pages, doctor bios, FAQs, emergency care, wellness plans
- Technical SEO: Core Web Vitals signals, HTTPS, canonical tags, robots.txt, XML sitemaps, internal linking
- Content marketing for vet practices: blog strategy, educational content, pet owner resources

Always respond with ONLY valid JSON. No preamble, no explanation, no markdown fences.
Be specific, actionable, and use veterinary industry knowledge in all recommendations.
Scores must reflect real-world veterinary SEO benchmarks — most vet sites score 40-65 without professional SEO help.`;
}

// ── Helpers ───────────────────────────────────────
function defaultScores() {
  return { overallSEO: 0, localSEO: 0, schemaStructuredData: 0, geoAIReadiness: 0, contentQuality: 0, technicalSEO: 0, eeAt: 0 };
}

function computeAverages(pages) {
  const keys = ['overallSEO', 'localSEO', 'schemaStructuredData', 'geoAIReadiness', 'contentQuality', 'technicalSEO', 'eeAt'];
  const avg = {};
  keys.forEach(k => {
    const vals = pages.map(p => p.scores?.[k] || 0).filter(v => v > 0);
    avg[k] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });
  return avg;
}

function buildFlags(page, analysis) {
  const flags = [];
  if (page.isNoindex) flags.push({ type: 'warn', label: 'NOINDEX' });
  if (page.isOrphan) flags.push({ type: 'info', label: 'ORPHAN' });
  if (page.status >= 400) flags.push({ type: 'error', label: `${page.status} ERROR` });
  if (page.wordCount < 300) flags.push({ type: 'warn', label: 'THIN CONTENT' });
  if (!page.pageTitle) flags.push({ type: 'error', label: 'NO TITLE' });
  if (!page.metaDescription) flags.push({ type: 'warn', label: 'NO META DESC' });
  if (page.h1s.length === 0) flags.push({ type: 'warn', label: 'NO H1' });
  if (page.h1s.length > 1) flags.push({ type: 'warn', label: 'MULTIPLE H1' });
  if (!page.og.image) flags.push({ type: 'info', label: 'NO OG IMAGE' });
  if (page.schemas.length === 0) flags.push({ type: 'warn', label: 'NO SCHEMA' });
  if (!page.canonical) flags.push({ type: 'info', label: 'NO CANONICAL' });
  if (page.imagesWithoutAlt > 0) flags.push({ type: 'warn', label: `${page.imagesWithoutAlt} IMGS NO ALT` });
  return flags;
}

function getMissingSchema(page, analysis) {
  const found = new Set(page.schemaTypes.map(t => t.toLowerCase()));
  const missing = [];
  for (const schema of VET_REQUIRED_SCHEMA) {
    if (!found.has(schema.toLowerCase())) missing.push(schema);
  }
  return missing.slice(0, 6);
}

function findDuplicates(arr) {
  const seen = {}, dupes = [];
  arr.forEach(v => { if (v && seen[v]) dupes.push(v); seen[v] = true; });
  return dupes;
}

module.exports = { analyzeSite, analyzeSitemap, compareAnalysis };

// Override the analyzeSitemap to add richer issue descriptions
const _origAnalyzeSitemap = module.exports.analyzeSitemap;
module.exports.analyzeSitemapWithContext = async function(crawlData, client) {
  var result = await _origAnalyzeSitemap(crawlData, client);

  // Enrich page issues with context from crawl data
  var issueMap = {};
  (result.pageIssues || []).forEach(function(i) { issueMap[i.url] = i; });

  crawlData.pages.forEach(function(page) {
    if (!issueMap[page.url]) {
      var issue = null;
      var recommendation = null;
      if (page.isOrphan) {
        issue = 'ORPHAN PAGE — No internal links from any other page on the site point to this URL. ' +
          'Google and visitors can only reach it via the XML sitemap or direct URL. ' +
          'Word count: ' + page.wordCount + ' words. Schema present: ' + (page.schemas.length > 0 ? 'Yes' : 'No') + '.';
        recommendation = 'Add internal links to this page from relevant service pages, the blog index, or the navigation menu. ' +
          'If this content is outdated or low value, consider unpublishing it or redirecting to a stronger page.';
      } else if (page.isNoindex) {
        issue = 'NOINDEX — This page has a robots meta tag telling search engines not to index it. ' +
          'It will not appear in Google search results.';
        recommendation = 'Verify this noindex tag is intentional. If this page should rank in search results, remove the noindex directive.';
      } else if (page.status >= 400) {
        issue = 'HTTP ' + page.status + ' ERROR — This page returned an error status code. ' +
          'Search engines cannot index broken pages.';
        recommendation = 'Fix or redirect this URL. If the page no longer exists, set up a 301 redirect to the most relevant live page.';
      }
      if (issue) {
        if (!result.pageIssues) result.pageIssues = [];
        result.pageIssues.push({ url: page.url, issue: issue, recommendation: recommendation });
      }
    }
  });

  return result;
};
