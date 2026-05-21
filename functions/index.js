const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap, compareAnalysis } = require('./analyzer');

admin.initializeApp();

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey });
}

function setCORS(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

exports.auditSite = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB', secrets: ['ANTHROPIC_API_KEY'] })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const { url, pageLimit = 50, crawlSubpages = true } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }
    try {
      const client = getAnthropicClient();
      const crawlData = await crawlSite(url, { pageLimit, crawlSubpages });
      const auditData = await analyzeSite(crawlData, client);
      res.status(200).json(auditData);
    } catch (e) {
      console.error('[auditSite] Error:', e);
      res.status(500).json({ error: e.message || 'Audit failed' });
    }
  });

exports.buildSitemap = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB', secrets: ['ANTHROPIC_API_KEY'] })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }
    try {
      const client = getAnthropicClient();
      const crawlData = await crawlSite(url, { pageLimit: 200, crawlSubpages: true });
      const sitemapTree = buildHierarchy(crawlData.pages, url);
      const maxDepth = Math.max(...crawlData.pages.map(p => {
        try { return new URL(p.url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
      }));
      const sitemapAnalysis = await analyzeSitemap(crawlData, client);
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

exports.compareSites = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB', secrets: ['ANTHROPIC_API_KEY'] })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const { url1, url2 } = req.body;
    if (!url1 || !url2) { res.status(400).json({ error: 'Two URLs required' }); return; }
    try {
      const client = getAnthropicClient();
      const [crawl1, crawl2] = await Promise.all([
        crawlSite(url1, { pageLimit: 25 }),
        crawlSite(url2, { pageLimit: 25 })
      ]);
      const [audit1, audit2] = await Promise.all([
        analyzeSite(crawl1, client),
        analyzeSite(crawl2, client)
      ]);
      const comparison = await compareAnalysis(audit1, audit2, client);
      res.status(200).json({ site1: audit1, site2: audit2, comparison });
    } catch (e) {
      console.error('[compareSites] Error:', e);
      res.status(500).json({ error: e.message || 'Comparison failed' });
    }
  });
