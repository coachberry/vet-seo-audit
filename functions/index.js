// ═══════════════════════════════════════════════════
//  index.js — Firebase Cloud Functions
//  Three endpoints: auditSite, buildSitemap, compareSites
// ═══════════════════════════════════════════════════
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap, compareAnalysis } = require('./analyzer');

admin.initializeApp();

// ── Init Anthropic client ─────────────────────────
// Set your key: firebase functions:secrets:set ANTHROPIC_API_KEY
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY || functions.config().anthropic?.api_key;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey });
}

// ── CORS helper ───────────────────────────────────
function setCORS(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// ══════════════════════════════════════════════════
//  ENDPOINT 1: Full SEO Audit
// ══════════════════════════════════════════════════
exports.auditSite = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { url, pageLimit = 50, crawlSubpages = true } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }

    try {
      const client = getAnthropicClient();

      // Step 1: Crawl the site
      console.log(`[auditSite] Starting crawl: ${url}`);
      const crawlData = await crawlSite(url, { pageLimit, crawlSubpages });
      console.log(`[auditSite] Crawled ${crawlData.pages.length} pages`);

      // Step 2: Analyze with Claude
      console.log(`[auditSite] Starting analysis...`);
      const auditData = await analyzeSite(crawlData, client);
      console.log(`[auditSite] Analysis complete`);

      res.status(200).json(auditData);
    } catch (e) {
      console.error('[auditSite] Error:', e);
      res.status(500).json({ error: e.message || 'Audit failed' });
    }
  });

// ══════════════════════════════════════════════════
//  ENDPOINT 2: Build Sitemap
// ══════════════════════════════════════════════════
exports.buildSitemap = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }

    try {
      const client = getAnthropicClient();

      // Step 1: Crawl
      console.log(`[buildSitemap] Starting crawl: ${url}`);
      const crawlData = await crawlSite(url, { pageLimit: 200, crawlSubpages: true });
      console.log(`[buildSitemap] Crawled ${crawlData.pages.length} pages`);

      // Step 2: Build hierarchy
      const sitemapTree = buildHierarchy(crawlData.pages, url);
      const maxDepth = Math.max(...crawlData.pages.map(p => {
        try { return new URL(p.url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
      }));

      // Step 3: Analyze with Claude
      const sitemapAnalysis = await analyzeSitemap(crawlData, client);

      // Step 4: Annotate pages with issues
      const issueMap = {};
      (sitemapAnalysis.pageIssues || []).forEach(issue => { issueMap[issue.url] = issue; });

      const annotatedPages = crawlData.pages.map(p => ({
        url: p.url,
        pageTitle: p.pageTitle,
        status: p.isNoindex ? 'noindex' : p.isOrphan ? 'orphan' : p.status >= 400 ? 'error' : p.status >= 300 ? 'redirect' : 'ok',
        issue: issueMap[p.url]?.issue || null,
        recommendation: issueMap[p.url]?.recommendation || null,
        wordCount: p.wordCount,
        hasSchema: p.schemas.length > 0
      }));

      res.status(200).json({
        domain: crawlData.domain,
        totalPages: crawlData.pages.length,
        maxDepth,
        hasRobotsTxt: crawlData.hasRobotsTxt,
        hasXMLSitemap: crawlData.xmlSitemap?.found,
        xmlSitemapUrl: crawlData.xmlSitemap?.url,
        xmlSitemapUrlCount: crawlData.xmlSitemap?.urls?.length || 0,
        sitemapTree,
        pages: annotatedPages,
        crawlability: sitemapAnalysis.crawlability || { score: 0 },
        urlAnalysis: sitemapAnalysis.urlAnalysis || { strengths: [], issues: [], recommendations: [] },
        overallReport: sitemapAnalysis.overallReport || ''
      });
    } catch (e) {
      console.error('[buildSitemap] Error:', e);
      res.status(500).json({ error: e.message || 'Sitemap build failed' });
    }
  });

// ══════════════════════════════════════════════════
//  ENDPOINT 3: Compare Two Sites
// ══════════════════════════════════════════════════
exports.compareSites = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { url1, url2 } = req.body;
    if (!url1 || !url2) { res.status(400).json({ error: 'Two URLs required' }); return; }

    try {
      const client = getAnthropicClient();

      // Crawl both sites in parallel (limit pages for speed)
      console.log(`[compareSites] Crawling both sites...`);
      const [crawl1, crawl2] = await Promise.all([
        crawlSite(url1, { pageLimit: 25 }),
        crawlSite(url2, { pageLimit: 25 })
      ]);

      // Analyze both in parallel
      console.log(`[compareSites] Analyzing both sites...`);
      const [audit1, audit2] = await Promise.all([
        analyzeSite(crawl1, client),
        analyzeSite(crawl2, client)
      ]);

      // Comparative analysis
      console.log(`[compareSites] Building comparison...`);
      const comparison = await compareAnalysis(audit1, audit2, client);

      res.status(200).json({ site1: audit1, site2: audit2, comparison });
    } catch (e) {
      console.error('[compareSites] Error:', e);
      res.status(500).json({ error: e.message || 'Comparison failed' });
    }
  });
