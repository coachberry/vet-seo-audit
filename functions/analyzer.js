const Anthropic = require('@anthropic-ai/sdk');

const VET_REQUIRED_SCHEMA = [
  'LocalBusiness','AnimalHospital','VeterinaryCare','Organization','WebSite','WebPage'
];

const VET_RECOMMENDED_SCHEMA = [
  'FAQPage','Review','AggregateRating','Person','MedicalBusiness','GeoCoordinates',
  'PostalAddress','OpeningHoursSpecification','BreadcrumbList','Article','Service',
  'ImageObject','Physician','ContactPoint','SiteLinksSearchBox'
];

async function analyzePage(pageData, client) {
  const prompt = buildPagePrompt(pageData);
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: prompt }]
  });
  const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return {}; }
}

async function analyzeSite(crawlData, client, mode) {
  const { pages, domain, xmlSitemap, hasRobotsTxt } = crawlData;
  const CONCURRENCY = 2;
  const analyzedPages = [];
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => analyzePage(p, client)));
    batch.forEach((page, idx) => {
      const r = results[idx] || {};
      const pageScores = (r && r.scores) ? r.scores : defaultScores();
      console.log('[analyzer] page scores for', page.url, ':', JSON.stringify(pageScores));
      analyzedPages.push({
        url: page.url || '',
        pageTitle: page.pageTitle || '',
        scores: pageScores,
        audit: (r && r.audit) || {},
        flags: buildFlags(page),
        schemaTypes: page.schemaTypes || [],
        missingSchema: getMissingSchema(page),
        wordCount: page.wordCount || 0,
        isOrphan: page.isOrphan || false,
        inboundCount: page.inboundCount || 0,
        publishDate: page.publishDate || '',
        author: page.author || '',
        metaDescription: page.metaDescription || '',
        h1s: page.h1s || [],
        h2s: page.h2s || [],
        og: page.og || {},
        twitter: page.twitter || {},
        canonical: page.canonical || '',
        robotsMeta: page.robotsMeta || '',
        isNoindex: page.isNoindex || false,
        hasHttps: page.hasHttps || false,
        hasViewport: page.hasViewport || false,
        images: page.images || [],
        imagesWithoutAlt: page.imagesWithoutAlt || 0,
        phones: page.phones || [],
        hasAddress: page.hasAddress || false,
        hasHours: page.hasHours || false,
        hasFAQContent: page.hasFAQContent || false,
        hasFAQSchema: page.hasFAQSchema || false,
        titleLength: page.titleLength || 0,
        metaDescLength: page.metaDescLength || 0
      });
    });
  }
  const siteAnalysis = await analyzeSiteWide(crawlData, analyzedPages, client);
  return {
    domain, auditDate: new Date().toISOString(),
    totalPagesCrawled: pages.length,
    hasRobotsTxt, hasXMLSitemap: xmlSitemap?.found || false,
    siteAverages: computeAverages(analyzedPages),
    siteWideAnalysis: siteAnalysis,
    pages: analyzedPages
  };
}

async function analyzeSiteWide(crawlData, analyzedPages, client) {
  const { pages, domain } = crawlData;
  const summary = {
    domain, totalPages: crawlData.totalPagesCrawled,
    hasRobotsTxt: crawlData.hasRobotsTxt,
    hasXMLSitemap: crawlData.xmlSitemap?.found,
    pagesWithSchema: pages.filter(p => p.schemas && p.schemas.length > 0).length,
    pagesWithH1: pages.filter(p => p.h1s && p.h1s.length > 0).length,
    pagesWithNoindex: pages.filter(p => p.isNoindex).length,
    averageWordCount: pages.length ? Math.round(pages.reduce((s,p) => s+(p.wordCount||0), 0)/pages.length) : 0,
    avgScores: computeAverages(analyzedPages)
  };
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system: buildSystemPrompt(),
    messages: [{ role: 'user', content: `Audit ${domain} veterinary website. Respond JSON only:
{"overallFindings":"string","topPriorities":[{"action":"string","impact":"HIGH|MEDIUM|LOW","effort":"HIGH|MEDIUM|LOW","category":"string"}],"quickWins":["string"],"localSEOFindings":"string","contentStrategy":"string","schemaStrategy":"string","geoAIStrategy":"string"}
Data: ${JSON.stringify(summary)}` }]
  });
  try { const raw = msg.content.find(b=>b.type==='text')?.text||'{}'; return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { return {}; }
}

async function analyzeSitemap(crawlData, client) {
  const { pages, domain, hasRobotsTxt, xmlSitemap } = crawlData;
  const pageSummaries = pages.map(p => ({
    url: p.url||'', status: p.status||0,
    isNoindex: p.isNoindex||false, isOrphan: p.isOrphan||false,
    pageTitle: p.pageTitle||'', wordCount: p.wordCount||0
  }));
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 3000, system: buildSystemPrompt(),
    messages: [{ role: 'user', content: `Veterinary SEO expert auditing sitemap of ${domain}. ${pages.length} non-blog pages crawled.

Respond JSON only:
{"domain":"${domain}","crawlability":{"score":number,"issues":["string"]},"urlAnalysis":{"strengths":["string"],"issues":["string"],"recommendations":["string"]},"pageIssues":[{"url":"string","status":"string","issue":"string","recommendation":"string"}],"overallReport":"3 paragraphs"}

Pages: ${JSON.stringify(pageSummaries)}
Has robots.txt: ${hasRobotsTxt}, Has XML sitemap: ${xmlSitemap?.found}, XML URL count: ${xmlSitemap?.urls?.length||0}` }]
  });
  try { const raw = msg.content.find(b=>b.type==='text')?.text||'{}'; return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { return { urlAnalysis:{strengths:[],issues:[],recommendations:[]}, crawlability:{score:0} }; }
}

async function compareAnalysis(site1Data, site2Data, client) {
  const summary = {
    site1: { domain: site1Data.domain, averages: site1Data.siteAverages, totalPages: site1Data.totalPagesCrawled },
    site2: { domain: site2Data.domain, averages: site2Data.siteAverages, totalPages: site2Data.totalPagesCrawled }
  };
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2500, system: buildSystemPrompt(),
    messages: [{ role: 'user', content: `Veterinary SEO competitive analysis. Respond JSON only:
{"overallWinner":"site1|site2","categoryWinners":{"overallSEO":"site1|site2","localSEO":"site1|site2","schemaStructuredData":"site1|site2","geoAIReadiness":"site1|site2","contentQuality":"site1|site2","technicalSEO":"site1|site2","eeAt":"site1|site2"},"site1Advantages":["string"],"site2Advantages":["string"],"summary":"3 paragraphs","recommendations":["string"]}
Data: ${JSON.stringify(summary)}` }]
  });
  try { const raw = msg.content.find(b=>b.type==='text')?.text||'{}'; return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { return {}; }
}

function buildPagePrompt(page) {
  const images = page.images || [];
  const internalLinks = page.internalLinks || [];
  const h1s = page.h1s || [];
  const h2s = page.h2s || [];
  const schemas = page.schemas || [];
  const schemaTypes = page.schemaTypes || [];
  const phones = page.phones || [];
  const og = page.og || {};
  const twitter = page.twitter || {};
  return `Analyze this veterinary website page as a professional veterinary SEO expert.

URL: ${page.url||''}
Title: ${page.pageTitle||'(none)'} (${page.titleLength||0} chars)
Meta Desc: ${page.metaDescription||'(none)'} (${page.metaDescLength||0} chars)
Canonical: ${page.canonical||'none'}
Robots: ${page.robotsMeta||'none'}
Noindex: ${page.isNoindex||false} | Orphan: ${page.isOrphan||false} | Status: ${page.status||0}
HTTPS: ${page.hasHttps||false} | Word Count: ${page.wordCount||0}
H1s: ${JSON.stringify(h1s)} | H2s: ${JSON.stringify(h2s.slice(0,6))}
OG Title: ${og.title||'none'} | OG Image: ${og.image?'Present':'MISSING'}
Twitter Card: ${twitter.card||'MISSING'}
Schema Types: ${JSON.stringify(schemaTypes)}
Phones: ${JSON.stringify(phones)} | Address: ${page.hasAddress||false} | Hours: ${page.hasHours||false}
Images: ${images.length} total, ${page.imagesWithoutAlt||0} no alt
Internal Links: ${internalLinks.length} | FAQ Content: ${page.hasFAQContent||false}
Is Blog: ${page.isBlog||false}${page.author?' | Author: '+page.author:''}${page.publishDate?' | Published: '+page.publishDate:''}
Has FAQ Content (H2/H3 headings): ${page.hasFAQContent||false}
Has FAQPage Schema: ${page.hasFAQSchema||false}

Required schema: ${VET_REQUIRED_SCHEMA.join(', ')}
Recommended schema: ${VET_RECOMMENDED_SCHEMA.join(', ')}

Respond JSON ONLY:
{"scores":{"overallSEO":0,"localSEO":0,"schemaStructuredData":0,"geoAIReadiness":0,"contentQuality":0,"technicalSEO":0,"eeAt":0},"audit":{"urlStructure":"string","metadata":"string","openGraph":"string","schema":"string","faqSchema":"string","localSEO":"string","contentEEAT":"string","geoAI":"string","technicalSEO":"string","internalLinking":"string","priorityActions":[{"action":"string","impact":"HIGH|MEDIUM|LOW"},{"action":"string","impact":"HIGH|MEDIUM|LOW"},{"action":"string","impact":"HIGH|MEDIUM|LOW"}]},"missingCriticalSchema":["string"],"recommendedSchema":["string"]}`;
}

function buildSystemPrompt() {
  return `You are a world-class SEO expert specializing in veterinary website SEO, Local SEO, and GEO with 15+ years experience. Respond ONLY with valid JSON. Be specific and actionable. Most vet sites score 40-65 without professional SEO help.`;
}

function defaultScores() {
  return { overallSEO:0, localSEO:0, schemaStructuredData:0, geoAIReadiness:0, contentQuality:0, technicalSEO:0, eeAt:0 };
}

function computeAverages(pages) {
  const keys = ['overallSEO','localSEO','schemaStructuredData','geoAIReadiness','contentQuality','technicalSEO','eeAt'];
  const avg = {};
  keys.forEach(k => {
    const vals = (pages||[]).map(p => (p.scores&&p.scores[k])||0).filter(v=>v>0);
    avg[k] = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  });
  return avg;
}

function buildFlags(page) {
  const flags = [];
  if (!page) return flags;
  if (page.isNoindex) flags.push({type:'warn',label:'NOINDEX'});
  if (page.isOrphan) flags.push({type:'info',label:'ORPHAN'});
  if ((page.status||0)>=400) flags.push({type:'error',label:`${page.status} ERROR`});
  if ((page.wordCount||0)<300) flags.push({type:'warn',label:'THIN CONTENT'});
  if (!page.pageTitle) flags.push({type:'error',label:'NO TITLE'});
  if (!page.metaDescription) flags.push({type:'warn',label:'NO META DESC'});
  if (!page.h1s||page.h1s.length===0) flags.push({type:'warn',label:'NO H1'});
  if (page.h1s&&page.h1s.length>1) flags.push({type:'warn',label:'MULTIPLE H1'});
  if (!page.og||!page.og.image) flags.push({type:'info',label:'NO OG IMAGE'});
  if (!page.schemas||page.schemas.length===0) flags.push({type:'warn',label:'NO SCHEMA'});
  if (!page.canonical) flags.push({type:'info',label:'NO CANONICAL'});
  if ((page.imagesWithoutAlt||0)>0) flags.push({type:'warn',label:`${page.imagesWithoutAlt} IMGS NO ALT`});
  return flags;
}

function getMissingSchema(page) {
  const found = new Set((page.schemaTypes||[]).map(t=>(t||'').toLowerCase()));
  return VET_REQUIRED_SCHEMA.filter(s=>!found.has(s.toLowerCase())).slice(0,6);
}

function findDuplicates(arr) {
  const seen={},dupes=[];
  (arr||[]).forEach(v=>{if(v&&seen[v])dupes.push(v);seen[v]=true;});
  return dupes;
}

module.exports = { analyzeSite, analyzeSitemap, compareAnalysis };
