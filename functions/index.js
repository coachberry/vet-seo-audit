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

// Start a job and return a job ID immediately
exports.startAudit = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const { url, pageLimit = 50, crawlSubpages = true, type = 'audit' } = req.body;
    if (!url) { res.status(400).json({ error: 'URL required' }); return; }
    const jobRef = await db.collection('jobs').add({
      url, pageLimit, crawlSubpages, type,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    res.status(200).json({ jobId: jobRef.id });
  });

// Poll job status
exports.getJob = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const jobId = req.query.jobId || req.body.jobId;
    if (!jobId) { res.status(400).json({ error: 'jobId required' }); return; }
    const snap = await db.collection('jobs').doc(jobId).get();
    if (!snap.exists) { res.status(404).json({ error: 'Job not found' }); return; }
    res.status(200).json({ jobId, ...snap.data() });
  });

// Process audit job (called by Firestore trigger)
exports.processAudit = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB', secrets: ['ANTHROPIC_API_KEY'] })
  .firestore.document('jobs/{jobId}')
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const job = snap.data();
    try {
      await snap.ref.update({ status: 'running', startedAt: new Date().toISOString() });
      const client = getAnthropicClient();
      let result;
      if (job.type === 'sitemap') {
        const crawlData = await crawlSite(job.url, { pageLimit: 200, crawlSubpages: true });
        const sitemapTree = buildHierarchy(crawlData.pages, job.url);
        const maxDepth = Math.max(0, ...crawlData.pages.map(p => {
          try { return new URL(p.url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
        }));
        const sitemapAnalysis = await (require("./analyzer").analyzeSitemapWithContext || analyzeSitemap)(crawlData, client);
        const issueMap = {};
        (sitemapAnalysis.pageIssues || []).forEach(i => { issueMap[i.url] = i; });
        result = {
          domain: crawlData.domain,
          totalPages: crawlData.pages.length,
          maxDepth,
          hasRobotsTxt: crawlData.hasRobotsTxt,
          hasXMLSitemap: crawlData.xmlSitemap?.found,
          xmlSitemapUrl: crawlData.xmlSitemap?.url,
          xmlSitemapUrlCount: crawlData.xmlSitemap?.urls?.length || 0,
          sitemapTree,
          pages: crawlData.pages.map(p => ({
            url: p.url, pageTitle: p.pageTitle,
            status: p.isNoindex ? 'noindex' : p.isOrphan ? 'orphan' : p.status >= 400 ? 'error' : p.status >= 300 ? 'redirect' : 'ok',
            issue: issueMap[p.url]?.issue || null,
            recommendation: issueMap[p.url]?.recommendation || null,
            wordCount: p.wordCount, hasSchema: p.schemas.length > 0
          })),
          crawlability: sitemapAnalysis.crawlability || { score: 0 },
          urlAnalysis: sitemapAnalysis.urlAnalysis || { strengths: [], issues: [], recommendations: [] },
          overallReport: sitemapAnalysis.overallReport || ''
        };
      } else if (job.type === 'compare') {
        const [crawl1, crawl2] = await Promise.all([
          crawlSite(job.url1, { pageLimit: 25 }),
          crawlSite(job.url2, { pageLimit: 25 })
        ]);
        const [audit1, audit2] = await Promise.all([
          analyzeSite(crawl1, client),
          analyzeSite(crawl2, client)
        ]);
        const comparison = await compareAnalysis(audit1, audit2, client);
        result = { site1: audit1, site2: audit2, comparison };
      } else {
        const crawlData = await crawlSite(job.url, { pageLimit: job.pageLimit, crawlSubpages: job.crawlSubpages });
        result = await analyzeSite(crawlData, client);
      }
      await snap.ref.update({ status: 'complete', result, completedAt: new Date().toISOString() });
      await db.collection('audits').add({
        type: job.type, domain: result.domain || job.url,
        createdAt: new Date().toISOString(), data: result
      });
    } catch (e) {
      console.error('Job failed:', e);
      await snap.ref.update({ status: 'error', error: e.message, failedAt: new Date().toISOString() });
    }
  });
