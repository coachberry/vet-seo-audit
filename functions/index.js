const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap } = require('./analyzer');
const { analyzeContentMap } = require('./contentmap');

admin.initializeApp();

function getDB() { return admin.firestore(); }
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

exports.startAudit = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const { url, url1, url2, pageLimit, crawlSubpages, type } = req.body;
    if (!url && !url1) { res.status(400).json({ error: 'URL required' }); return; }
    try {
      const db = getDB();
      const jobRef = await db.collection('jobs').add({
        url: url || url1, url1: url1 || url, url2: url2 || null,
        pageLimit: parseInt(pageLimit) || 500,
        crawlSubpages: crawlSubpages !== false,
        type: type || 'overview',
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      res.status(200).json({ jobId: jobRef.id });
    } catch(e) {
      console.error('startAudit error:', e);
      res.status(500).json({ error: e.message });
    }
  });

exports.getJob = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const jobId = req.query.jobId || (req.body && req.body.jobId);
    if (!jobId) { res.status(400).json({ error: 'jobId required' }); return; }
    try {
      const db = getDB();
      const snap = await db.collection('jobs').doc(jobId).get();
      if (!snap.exists) { res.status(404).json({ error: 'Job not found' }); return; }
      res.status(200).json({ jobId, ...snap.data() });
    } catch(e) {
      console.error('getJob error:', e);
      res.status(500).json({ error: e.message });
    }
  });

exports.processAudit = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB', secrets: ['ANTHROPIC_API_KEY'] })
  .firestore.document('jobs/{jobId}')
  .onCreate(async (snap, context) => {
    const db = getDB();
    const job = snap.data();
    try {
      await snap.ref.update({ status: 'running', startedAt: new Date().toISOString() });
      const client = getAnthropicClient();
      let result;
      const pageLimit = Math.min(parseInt(job.pageLimit) || 500, 9999);

      if (job.type === 'overview') {
        // Crawl entire site — no page limit for overview
        const crawlData = await crawlSite(job.url, {
          pageLimit: 9999,
          crawlSubpages: true,
          filterBlogs: false,
          blogOnly: false
        });
        result = await analyzeOverview(crawlData, client);

      } else if (job.type === 'services') {
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, servicesOnly: true });
        // Cap pages sent to Claude at 25 to prevent timeout
        if (crawlData.pages.length > 25) crawlData.pages = crawlData.pages.slice(0, 25);
        result = await analyzeSite(crawlData, client, 'services');

      } else if (job.type === 'blog') {
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, blogOnly: true });
        if (crawlData.pages.length > 25) crawlData.pages = crawlData.pages.slice(0, 25);
        result = await analyzeSite(crawlData, client, 'blog');

      } else if (job.type === 'sitepages') {
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, coreOnly: true });
        if (crawlData.pages.length > 25) crawlData.pages = crawlData.pages.slice(0, 25);
        result = await analyzeSite(crawlData, client, 'sitepages');

      } else if (job.type === 'singlepage') {
        // Single page audit — fetch exactly one specific URL
        const axios = require('axios');
        const cheerio = require('cheerio');
        const { parsePage } = require('./crawler');

        // Directly fetch the specific page
        let pageHtml = '';
        let pageStatus = 0;
        try {
          const res = await axios.get(job.url, {
            timeout: 15000,
            headers: {
              'User-Agent': 'VetSEOAuditor/1.0 (compatible; Googlebot/2.1)',
              'Accept': 'text/html,application/xhtml+xml',
              'Cache-Control': 'no-cache'
            },
            maxRedirects: 5,
            validateStatus: function() { return true; }
          });
          pageHtml = res.data || '';
          pageStatus = res.status;
        } catch(e) {
          throw new Error('Could not fetch page: ' + e.message);
        }

        if (!pageHtml) throw new Error('Page returned empty response');

        // Parse the page
        const parsedPage = parsePage(pageHtml, job.url, pageStatus);
        parsedPage.isOrphan = false;
        parsedPage.inboundCount = 0;

        // Build mock crawlData for analyzer
        const mockCrawlData = {
          domain: new URL(job.url).hostname.replace(/^www\./, ''),
          rootUrl: job.url,
          totalPagesCrawled: 1,
          hasRobotsTxt: false,
          xmlSitemap: { found: false, urls: [] },
          inboundLinks: {},
          pages: [parsedPage]
        };

        const singleAnalysis = await analyzeSite(mockCrawlData, client);
        const analyzedPage = singleAnalysis.pages && singleAnalysis.pages[0];

        // Merge raw parsed data with Claude analysis
        if (analyzedPage) {
          analyzedPage.titleLength = parsedPage.titleLength;
          analyzedPage.metaDescLength = parsedPage.metaDescLength;
          analyzedPage.h1s = parsedPage.h1s;
          analyzedPage.h2s = parsedPage.h2s;
          analyzedPage.og = parsedPage.og;
          analyzedPage.twitter = parsedPage.twitter;
          analyzedPage.canonical = parsedPage.canonical;
          analyzedPage.robotsMeta = parsedPage.robotsMeta;
          analyzedPage.isNoindex = parsedPage.isNoindex;
          analyzedPage.hasHttps = parsedPage.hasHttps;
          analyzedPage.hasViewport = parsedPage.hasViewport;
          analyzedPage.wordCount = parsedPage.wordCount;
          analyzedPage.images = parsedPage.images;
          analyzedPage.imagesWithoutAlt = parsedPage.imagesWithoutAlt;
          analyzedPage.phones = parsedPage.phones;
          analyzedPage.hasAddress = parsedPage.hasAddress;
          analyzedPage.hasHours = parsedPage.hasHours;
          analyzedPage.hasFAQContent = parsedPage.hasFAQContent;
          analyzedPage.hasFAQSchema = parsedPage.hasFAQSchema;
          analyzedPage.schemas = parsedPage.schemas;
          analyzedPage.schemaTypes = parsedPage.schemaTypes;
        }

        result = {
          domain: new URL(job.url).hostname.replace(/^www\./, ''),
          url: job.url,
          page: analyzedPage || null
        };
        console.log('[singlepage] result.page exists:', !!analyzedPage, 'scores:', JSON.stringify(analyzedPage && analyzedPage.scores || {}));

      } else if (job.type === 'contentmap') {
        // For content mapping, crawl with higher concurrency but cap at 500
        // We only need titles and URLs so this is much faster than full analysis
        const crawlData = await crawlSite(job.url, {
          pageLimit: 500,
          crawlSubpages: true,
          filterBlogs: false
        });
        result = await analyzeContentMap(crawlData, client);

      } else if (job.type === 'sitemap') {
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true });
        const sitemapTree = buildHierarchy(crawlData.pages, job.url);
        const maxDepth = crawlData.pages.reduce(function(max, p) {
          try { const d = new URL(p.url).pathname.split('/').filter(Boolean).length; return d > max ? d : max; } catch(e) { return max; }
        }, 0);
        const sitemapAnalysis = await analyzeSitemap(crawlData, client);
        const issueMap = {};
        (sitemapAnalysis.pageIssues || []).forEach(function(i) { if(i && i.url) issueMap[i.url] = i; });
        result = {
          domain: crawlData.domain,
          totalPages: crawlData.pages.length,
          maxDepth,
          hasRobotsTxt: crawlData.hasRobotsTxt,
          hasXMLSitemap: !!(crawlData.xmlSitemap && crawlData.xmlSitemap.found),
          xmlSitemapUrl: (crawlData.xmlSitemap && crawlData.xmlSitemap.url) || null,
          xmlSitemapUrlCount: (crawlData.xmlSitemap && crawlData.xmlSitemap.urls && crawlData.xmlSitemap.urls.length) || 0,
          sitemapTree,
          pages: crawlData.pages.map(function(p) {
            const issue = issueMap[p.url];
            return {
              url: p.url,
              pageTitle: p.pageTitle || '',
              status: p.isNoindex ? 'noindex' : p.isOrphan ? 'orphan' : p.status >= 400 ? 'error' : p.status >= 300 ? 'redirect' : 'ok',
              isOrphan: p.isOrphan || false,
              issue: issue ? issue.issue : null,
              recommendation: issue ? issue.recommendation : null,
              wordCount: p.wordCount || 0,
              hasSchema: !!(p.schemas && p.schemas.length > 0)
            };
          }),
          crawlability: sitemapAnalysis.crawlability || { score: 0 },
          urlAnalysis: sitemapAnalysis.urlAnalysis || { strengths: [], issues: [], recommendations: [] },
          overallReport: sitemapAnalysis.overallReport || ''
        };
      }

      await snap.ref.update({ status: 'complete', result, completedAt: new Date().toISOString() });
      await db.collection('audits').add({
        type: job.type,
        domain: result.domain || job.url,
        createdAt: new Date().toISOString(),
        data: result
      });

    } catch(e) {
      console.error('processAudit error:', e);
      await snap.ref.update({ status: 'error', error: e.message, failedAt: new Date().toISOString() });
    }
  });

async function analyzeOverview(crawlData, client) {
  const { pages, domain, hasRobotsTxt, xmlSitemap } = crawlData;

  console.log('[analyzeOverview] pages received:', pages.length);

  // Build rich signal stats from every crawled page
  const totalPages = pages.length;
  const blogPages = pages.filter(p => /\/blog\//i.test(p.url || ''));
  const servicePages = pages.filter(p => /\/services\//i.test(p.url || ''));
  const corePages = pages.filter(p => !/\/blog\//i.test(p.url || '') && !/\/services\//i.test(p.url || ''));

  const pagesWithSchema = pages.filter(p => p.schemas && p.schemas.length > 0);
  const pagesNoH1 = pages.filter(p => !p.h1s || p.h1s.length === 0);
  const pagesNoMeta = pages.filter(p => !p.metaDescription);
  const pagesNoindex = pages.filter(p => p.isNoindex);
  const orphanPages = pages.filter(p => p.isOrphan);
  const pagesHttps = pages.filter(p => p.hasHttps);
  const pagesWithOGImage = pages.filter(p => p.og && p.og.image);
  const pagesWithCanonical = pages.filter(p => p.canonical);
  const thinPages = pages.filter(p => (p.wordCount || 0) < 300 && (p.wordCount || 0) > 0);

  const totalWords = pages.reduce((s, p) => s + (p.wordCount || 0), 0);
  const avgWordCount = totalPages ? Math.round(totalWords / totalPages) : 0;

  // Schema type coverage
  const allSchemaTypes = new Set();
  pages.forEach(p => (p.schemaTypes || []).forEach(t => allSchemaTypes.add(t)));

  // Sample pages for context (mix of types)
  const sampleCore = corePages.slice(0, 5).map(p => ({ url: p.url, title: p.pageTitle, wordCount: p.wordCount, hasSchema: !!(p.schemas && p.schemas.length), h1: p.h1s && p.h1s[0] || '' }));
  const sampleService = servicePages.slice(0, 5).map(p => ({ url: p.url, title: p.pageTitle, wordCount: p.wordCount, hasSchema: !!(p.schemas && p.schemas.length) }));

  const crawlStats = {
    totalPages,
    blogPageCount: blogPages.length,
    servicePageCount: servicePages.length,
    corePageCount: corePages.length,
    pagesWithSchema: pagesWithSchema.length,
    schemaTypesFound: Array.from(allSchemaTypes),
    pagesNoH1: pagesNoH1.length,
    pagesNoMeta: pagesNoMeta.length,
    pagesNoindex: pagesNoindex.length,
    orphanPages: orphanPages.length,
    thinContentPages: thinPages.length,
    pagesHttps: pagesHttps.length,
    pagesWithOGImage: pagesWithOGImage.length,
    pagesWithCanonical: pagesWithCanonical.length,
    avgWordCount,
    hasRobotsTxt,
    hasXMLSitemap: !!(xmlSitemap && xmlSitemap.found),
    xmlSitemapUrlCount: (xmlSitemap && xmlSitemap.urls && xmlSitemap.urls.length) || 0,
    sampleCorePages: sampleCore,
    sampleServicePages: sampleService
  };

  console.log('[analyzeOverview] crawlStats built:', JSON.stringify(crawlStats).slice(0, 200));

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 6000,
    system: `You are a world-class veterinary SEO and GEO expert with 15+ years experience. You specialize in helping veterinary practices get more traffic, more clients, and better visibility in both traditional search engines and AI tools like ChatGPT, Perplexity, and Google SGE.

Your job is to analyze crawl signal data from a vet website and provide:
1. Accurate scores (0-100) based on the actual data
2. Actionable priorities focused on changes that will show results in 1-2 months
3. A clear 30/60/90 day action plan

Always respond with ONLY valid JSON. No markdown, no explanation.`,
    messages: [{
      role: 'user',
      content: `Analyze this veterinary website and provide a complete SEO overview report.

Domain: ${domain}
Crawl Data: ${JSON.stringify(crawlStats)}

Score each category 0-100 based on the ACTUAL data above. Do NOT return 0 for everything — use the real numbers to calculate honest scores.

Scoring guide:
- schemaStructuredData: if pagesWithSchema is 0, score 0-10. If 50%+ have schema, score 50+. If they have AnimalHospital/VeterinaryCare schema, score 70+
- technicalSEO: if all pages are HTTPS, +20 pts. If hasRobotsTxt, +10. If hasXMLSitemap, +10. Deduct for orphans, noindex, missing canonicals
- contentQuality: base on avgWordCount and thinContentPages ratio
- localSEO: check for address/phone signals in sample pages, NAP presence
- overallSEO: weighted average of all categories

Respond with JSON ONLY:
{
  "scores": {
    "overallSEO": <honest 0-100 based on data>,
    "localSEO": <honest 0-100>,
    "schemaStructuredData": <honest 0-100>,
    "contentQuality": <honest 0-100>,
    "technicalSEO": <honest 0-100>,
    "geoAIReadiness": <honest 0-100>,
    "eeAt": <honest 0-100>
  },
  "overallFindings": "3-4 paragraph expert assessment of this specific site based on the data",
  "topPriorities": [
    {
      "action": "Very specific action for THIS site",
      "impact": "HIGH|MEDIUM|LOW",
      "effort": "HIGH|MEDIUM|LOW",
      "category": "Schema|Content|Technical|Local SEO|GEO",
      "timeToResults": "2-4 weeks|1-2 months|3-6 months"
    }
  ],
  "quickWins": ["Specific things fixable in under 1 hour that will show results within 30 days"],
  "thirtyDayPlan": ["Action 1 — complete in first 30 days", "Action 2", "Action 3"],
  "sixtyDayPlan": ["Action 1 — complete by day 60", "Action 2", "Action 3"],
  "ninetyDayPlan": ["Action 1 — complete by day 90", "Action 2", "Action 3"],
  "localSEOFindings": "Specific local SEO assessment for this vet practice",
  "contentStrategy": "Specific content recommendations for this site",
  "schemaStrategy": "Specific schema recommendations — which types are missing, which pages need them",
  "geoAIStrategy": "How to optimize this vet site for ChatGPT, Perplexity, Google SGE, and Gemini"
}`
    }]
  });

  const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
  console.log('[analyzeOverview] Claude raw response length:', raw.length);

  try {
    // Strip markdown fences and extract just the JSON object
    let jsonStr = raw.replace(/```json|```/g, '').trim();
    // Find the outermost { } to extract valid JSON even if truncated
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr);
    return {
      domain,
      totalPagesCrawled: totalPages,
      hasRobotsTxt,
      hasXMLSitemap: !!(xmlSitemap && xmlSitemap.found),
      crawlStats,
      scores: parsed.scores || {},
      overallFindings: parsed.overallFindings || '',
      topPriorities: parsed.topPriorities || [],
      quickWins: parsed.quickWins || [],
      thirtyDayPlan: parsed.thirtyDayPlan || [],
      sixtyDayPlan: parsed.sixtyDayPlan || [],
      ninetyDayPlan: parsed.ninetyDayPlan || [],
      localSEOFindings: parsed.localSEOFindings || '',
      contentStrategy: parsed.contentStrategy || '',
      schemaStrategy: parsed.schemaStrategy || '',
      geoAIStrategy: parsed.geoAIStrategy || ''
    };
  } catch(e) {
    console.error('[analyzeOverview] JSON parse error:', e.message, 'raw:', raw.slice(0, 500));
    return {
      domain, totalPagesCrawled: totalPages,
      hasRobotsTxt, hasXMLSitemap: !!(xmlSitemap && xmlSitemap.found),
      crawlStats, scores: {}, topPriorities: [], quickWins: []
    };
  }
}
