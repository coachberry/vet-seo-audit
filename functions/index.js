const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { crawlSite, buildHierarchy } = require('./crawler');
const { analyzeSite, analyzeSitemap, compareAnalysis } = require('./analyzer');

admin.initializeApp();

function getDB() {
  return admin.firestore();
}

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
        url: url || url1,
        url1: url1 || url,
        url2: url2 || null,
        pageLimit: parseInt(pageLimit) || 100,
        crawlSubpages: crawlSubpages !== false,
        type: type || 'audit',
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

      if (job.type === 'sitemap') {
        const pageLimit = Math.min(parseInt(job.pageLimit) || 500, 9999);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: true,
          filterBlogs: false
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
        (sitemapAnalysis.pageIssues || []).forEach(function(i) {
          if (i && i.url) issueMap[i.url] = i;
        });
        result = {
          domain: crawlData.domain,
          totalPages: crawlData.pages.length,
          maxDepth,
          hasRobotsTxt: crawlData.hasRobotsTxt,
          hasXMLSitemap: !!(crawlData.xmlSitemap && crawlData.xmlSitemap.found),
          xmlSitemapUrl: crawlData.xmlSitemap && crawlData.xmlSitemap.url || null,
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

      } else if (job.type === 'blog') {
        const pageLimit = Math.min(parseInt(job.pageLimit) || 500, 9999);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: true,
          blogOnly: true
        });
        result = await analyzeSite(crawlData, client, 'blog');

      } else if (job.type === 'compare') {
        const [crawl1, crawl2] = await Promise.all([
          crawlSite(job.url1 || job.url, { pageLimit: 25, filterBlogs: true }),
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
        const pageLimit = Math.min(parseInt(job.pageLimit) || 100, 500);
        const crawlData = await crawlSite(job.url, {
          pageLimit,
          crawlSubpages: job.crawlSubpages !== false,
          filterBlogs: true
        });
        result = await analyzeSite(crawlData, client);
      }

      await snap.ref.update({
        status: 'complete',
        result,
        completedAt: new Date().toISOString()
      });

      await db.collection('audits').add({
        type: job.type,
        domain: result.domain || (result.site1 && result.site1.domain) || job.url,
        createdAt: new Date().toISOString(),
        data: result
      });

    } catch(e) {
      console.error('processAudit error:', e);
      await snap.ref.update({
        status: 'error',
        error: e.message,
        failedAt: new Date().toISOString()
      });
    }
  });
