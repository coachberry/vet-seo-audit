const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap, compareAnalysis } = require('./analyzer');

admin.initializeApp();
const db = admin.firestore();

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

// Start a job and return job ID immediately
exports.startAudit = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const { url, url1, url2, pageLimit, crawlSubpages, type } = req.body;
    if (!url && !url1) { res.status(400).json({ error: 'URL required' }); return; }
    try {
      const jobRef = await db.collection('jobs').add({
        url: url || url1, url1, url2,
        pageLimit: pageLimit || 100,
        crawlSubpages: crawlSubpages !== false,
        type: type || 'audit',
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      res.status(200).json({ jobId: jobRef.id });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

// Poll job status
exports.getJob = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const jobId = req.query.jobId || req.body.jobId;
    if (!jobId) { res.status(400).json({ error: 'jobId required' }); return; }
    try {
      const snap = await db.collection('jobs').doc(jobId).get();
      if (!snap.exists) { res.status(404).json({ error: 'Job not found' }); return; }
      res.status(200).json({ jobId, ...snap.data() });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

// Process jobs triggered by Firestore
exports.processAudit = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB', secrets: ['ANTHROPIC_API_KEY'] })
  .firestore.document('jobs/{jobId}')
  .onCreate(async (snap, context) => {
    const job = snap.data();
    try {
      await snap.ref.update({ status: 'running', startedAt: new Date().toISOString() });
      const client = getAnthropicClient();
      let result;

      if (job.type === 'sitemap') {
        // Use pageLimit from job, default 500, max 9999
        const pageLimit = Math.min(job.pageLimit || 500, 9999);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: true,
          filterBlogs: false // include everything for sitemap
        });
        const sitemapTree = buildHierarchy(crawlData.pages, job.url);
        const maxDepth = crawlData.pages.reduce(function(max, p) {
          try {
            var d = new URL(p.url).pathname.split('/').filter(Boolean).length;
            return d > max ? d : max;
          } catch(e) { return max; }
        }, 0);
        const sitemapAnalysis = await analyzeSitemap(crawlData, client);
        const issueMap = {};
        (sitemapAnalysis.pageIssues || []).forEach(function(i) { if(i && i.url) issueMap[i.url] = i; });
        result = {
          domain: crawlData.domain,
          totalPages: crawlData.pages.length,
          maxDepth,
          hasRobotsTxt: crawlData.hasRobotsTxt,
          hasXMLSitemap: crawlData.xmlSitemap && crawlData.xmlSitemap.found,
          xmlSitemapUrl: crawlData.xmlSitemap && crawlData.xmlSitemap.url,
          xmlSitemapUrlCount: crawlData.xmlSitemap && crawlData.xmlSitemap.urls && crawlData.xmlSitemap.urls.length || 0,
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
              hasSchema: p.schemas && p.schemas.length > 0
            };
          }),
          crawlability: sitemapAnalysis.crawlability || { score: 0 },
          urlAnalysis: sitemapAnalysis.urlAnalysis || { strengths: [], issues: [], recommendations: [] },
          overallReport: sitemapAnalysis.overallReport || ''
        };

      } else if (job.type === 'blog') {
        // Blog audit — only crawl /blog/ URLs
        const pageLimit = Math.min(job.pageLimit || 500, 9999);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: true,
          blogOnly: true // only collect /blog/ pages
        });
        result = await analyzeSite(crawlData, client, 'blog');

      } else if (job.type === 'compare') {
        const [crawl1, crawl2] = await Promise.all([
          crawlSite(job.url1, { pageLimit: 25, filterBlogs: true }),
          crawlSite(job.url2, { pageLimit: 25, filterBlogs: true })
        ]);
        const [audit1, audit2] = await Promise.all([
          analyzeSite(crawl1, client),
          analyzeSite(crawl2, client)
        ]);
        const comparison = await compareAnalysis(audit1, audit2, client);
        result = { site1: audit1, site2: audit2, comparison };

      } else {
        // Standard SEO audit — filter out blog pages
        const pageLimit = Math.min(job.pageLimit || 100, 500);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: job.crawlSubpages !== false,
          filterBlogs: true // exclude /blog/ URLs
        });
        result = await analyzeSite(crawlData, client);
      }

      await snap.ref.update({ status: 'complete', result, completedAt: new Date().toISOString() });
      // Save to audits collection
      await db.collection('audits').add({
        type: job.type,
        domain: result.domain || result.site1 && result.site1.domain || job.url,
        createdAt: new Date().toISOString(),
        data: result
      });

    } catch(e) {
      console.error('Job failed:', e);
      await snap.ref.update({ status: 'error', error: e.message, failedAt: new Date().toISOString() });
    }
  });
