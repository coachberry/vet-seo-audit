const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap, compareAnalysis } = require('./analyzer');

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
        pageLimit: parseInt(pageLimit) || 50,
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
      const pageLimit = Math.min(parseInt(job.pageLimit) || 50, 9999);

      if (job.type === 'overview') {
        // Fast signal crawl — no deep page analysis
        const crawlData = await crawlSite(job.url, { pageLimit: 50, crawlSubpages: true, filterBlogs: false, blogOnly: false });
        result = await analyzeOverview(crawlData, client);

      } else if (job.type === 'services') {
        // Only /services/ pages, exclude /blog/
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, servicesOnly: true });
        result = await analyzeSite(crawlData, client, 'services');

      } else if (job.type === 'blog') {
        // Only /blog/ pages
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, blogOnly: true });
        result = await analyzeSite(crawlData, client, 'blog');

      } else if (job.type === 'sitepages') {
        // Everything EXCEPT /services/ and /blog/
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true, coreOnly: true });
        result = await analyzeSite(crawlData, client, 'sitepages');

      } else if (job.type === 'sitemap') {
        const crawlData = await crawlSite(job.url, { pageLimit, crawlSubpages: true });
        const sitemapTree = buildHierarchy(crawlData.pages, job.url);
        const maxDepth = crawlData.pages.reduce(function(max, p) {
          try { var d = new URL(p.url).pathname.split('/').filter(Boolean).length; return d > max ? d : max; } catch(e) { return max; }
        }, 0);
        const sitemapAnalysis = await analyzeSitemap(crawlData, client);
        const issueMap = {};
        (sitemapAnalysis.pageIssues || []).forEach(function(i) { if(i&&i.url) issueMap[i.url]=i; });
        result = {
          domain: crawlData.domain, totalPages: crawlData.pages.length, maxDepth,
          hasRobotsTxt: crawlData.hasRobotsTxt,
          hasXMLSitemap: !!(crawlData.xmlSitemap&&crawlData.xmlSitemap.found),
          xmlSitemapUrl: crawlData.xmlSitemap&&crawlData.xmlSitemap.url||null,
          xmlSitemapUrlCount: (crawlData.xmlSitemap&&crawlData.xmlSitemap.urls&&crawlData.xmlSitemap.urls.length)||0,
          sitemapTree,
          pages: crawlData.pages.map(function(p) {
            const issue = issueMap[p.url];
            return {
              url: p.url, pageTitle: p.pageTitle||'',
              status: p.isNoindex?'noindex':p.isOrphan?'orphan':p.status>=400?'error':p.status>=300?'redirect':'ok',
              isOrphan: p.isOrphan||false,
              issue: issue?issue.issue:null, recommendation: issue?issue.recommendation:null,
              wordCount: p.wordCount||0, hasSchema: !!(p.schemas&&p.schemas.length>0)
            };
          }),
          crawlability: sitemapAnalysis.crawlability||{score:0},
          urlAnalysis: sitemapAnalysis.urlAnalysis||{strengths:[],issues:[],recommendations:[]},
          overallReport: sitemapAnalysis.overallReport||''
        };
      }

      await snap.ref.update({ status: 'complete', result, completedAt: new Date().toISOString() });
      await db.collection('audits').add({
        type: job.type,
        domain: result.domain||(result.site1&&result.site1.domain)||job.url,
        createdAt: new Date().toISOString(),
        data: result
      });

    } catch(e) {
      console.error('processAudit error:', e);
      await snap.ref.update({ status: 'error', error: e.message, failedAt: new Date().toISOString() });
    }
  });

// Fast overview — no per-page Claude analysis
async function analyzeOverview(crawlData, client) {
  const { pages, domain, hasRobotsTxt, xmlSitemap } = crawlData;

  // Build signal stats from raw crawl data
  const crawlStats = {
    totalPages: pages.length,
    pagesWithSchema: pages.filter(p => p.schemas&&p.schemas.length>0).length,
    pagesNoH1: pages.filter(p => !p.h1s||p.h1s.length===0).length,
    pagesNoMeta: pages.filter(p => !p.metaDescription).length,
    pagesNoindex: pages.filter(p => p.isNoindex).length,
    orphanPages: pages.filter(p => p.isOrphan).length,
    pagesHttps: pages.filter(p => p.hasHttps).length,
    pagesWithOGImage: pages.filter(p => p.og&&p.og.image).length,
    pagesWithCanonical: pages.filter(p => p.canonical).length,
    avgWordCount: pages.length ? Math.round(pages.reduce((s,p)=>s+(p.wordCount||0),0)/pages.length) : 0,
    blogPages: pages.filter(p => /\/blog\//i.test(p.url)).length,
    servicePages: pages.filter(p => /\/services\//i.test(p.url)).length,
    hasRobotsTxt,
    hasXMLSitemap: xmlSitemap&&xmlSitemap.found,
    xmlSitemapUrlCount: xmlSitemap&&xmlSitemap.urls&&xmlSitemap.urls.length||0,
    // Sample page titles and URLs for context
    samplePages: pages.slice(0,15).map(p=>({ url:p.url, title:p.pageTitle, hasSchema:p.schemas&&p.schemas.length>0, wordCount:p.wordCount, h1:p.h1s&&p.h1s[0]||'' }))
  };

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: `You are a world-class veterinary SEO expert. Based on crawl signal data (no full HTML), score this vet website and provide actionable priorities. Respond ONLY with valid JSON.`,
    messages: [{
      role: 'user',
      content: `Score this veterinary website based on crawl signals. Domain: ${domain}

Crawl Stats: ${JSON.stringify(crawlStats)}

Respond with JSON ONLY:
{
  "scores": {
    "overallSEO": <0-100>,
    "localSEO": <0-100>,
    "schemaStructuredData": <0-100>,
    "contentQuality": <0-100>,
    "technicalSEO": <0-100>,
    "geoAIReadiness": <0-100>,
    "eeAt": <0-100>
  },
  "overallFindings": "3-4 paragraph expert assessment",
  "topPriorities": [
    { "action": "Specific actionable fix", "impact": "HIGH|MEDIUM|LOW", "effort": "HIGH|MEDIUM|LOW", "category": "Schema|Content|Technical|Local SEO|GEO" }
  ],
  "quickWins": ["string — things fixable in under 1 hour"],
  "localSEOFindings": "paragraph about local SEO signals",
  "contentStrategy": "paragraph about content recommendations",
  "schemaStrategy": "paragraph about schema recommendations",
  "geoAIStrategy": "paragraph about GEO and AI readiness"
}`
    }]
  });

  try {
    const raw = msg.content.find(b=>b.type==='text')?.text||'{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
    return {
      domain, totalPagesCrawled: pages.length,
      hasRobotsTxt, hasXMLSitemap: xmlSitemap&&xmlSitemap.found,
      crawlStats,
      scores: parsed.scores||{},
      overallFindings: parsed.overallFindings||'',
      topPriorities: parsed.topPriorities||[],
      quickWins: parsed.quickWins||[],
      localSEOFindings: parsed.localSEOFindings||'',
      contentStrategy: parsed.contentStrategy||'',
      schemaStrategy: parsed.schemaStrategy||'',
      geoAIStrategy: parsed.geoAIStrategy||''
    };
  } catch(e) {
    return { domain, totalPagesCrawled: pages.length, scores:{}, topPriorities:[], quickWins:[] };
  }
}
