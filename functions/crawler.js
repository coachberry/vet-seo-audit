// ═══════════════════════════════════════════════════
//  crawler.js — Real site crawling engine
//  Fetches actual HTML, follows links, respects robots.txt
// ═══════════════════════════════════════════════════
const axios = require('axios');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const xml2js = require('xml2js');
const { URL } = require('url');

const USER_AGENT = 'VetSEOAuditor/1.0 (compatible; Googlebot/2.1)';
const REQUEST_TIMEOUT = 12000;
const CONCURRENCY = 3;

// ── Fetch a single URL ────────────────────────────
async function fetchPage(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache'
        },
        maxRedirects: 5,
        validateStatus: () => true
      });
      return {
        url: res.request?.res?.responseUrl || url,
        status: res.status,
        html: res.data,
        contentType: res.headers['content-type'] || '',
        redirected: res.request?.res?.responseUrl !== url
      };
    } catch (e) {
      if (attempt === retries) return { url, status: 0, html: '', error: e.message };
      await sleep(500 * (attempt + 1));
    }
  }
}

// ── Parse robots.txt ──────────────────────────────
async function getRobots(rootUrl) {
  try {
    const robotsUrl = new URL('/robots.txt', rootUrl).href;
    const res = await axios.get(robotsUrl, { timeout: 5000, headers: { 'User-Agent': USER_AGENT }, validateStatus: () => true });
    if (res.status === 200) return robotsParser(robotsUrl, res.data);
  } catch {}
  return null;
}

// ── Fetch XML sitemap ─────────────────────────────
async function getXMLSitemap(rootUrl) {
  const candidates = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/sitemap.xml'];
  for (const path of candidates) {
    try {
      const sitemapUrl = new URL(path, rootUrl).href;
      const res = await axios.get(sitemapUrl, { timeout: 8000, validateStatus: () => true });
      if (res.status === 200 && res.data) {
        const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false }).catch(() => null);
        if (!parsed) continue;
        const urls = [];
        // Handle sitemap index
        if (parsed.sitemapindex?.sitemap) {
          const sitemaps = Array.isArray(parsed.sitemapindex.sitemap) ? parsed.sitemapindex.sitemap : [parsed.sitemapindex.sitemap];
          for (const s of sitemaps.slice(0, 5)) {
            try {
              const subRes = await axios.get(s.loc, { timeout: 8000, validateStatus: () => true });
              const subParsed = await xml2js.parseStringPromise(subRes.data, { explicitArray: false }).catch(() => null);
              if (subParsed?.urlset?.url) {
                const subUrls = Array.isArray(subParsed.urlset.url) ? subParsed.urlset.url : [subParsed.urlset.url];
                urls.push(...subUrls.map(u => ({ loc: u.loc, lastmod: u.lastmod, changefreq: u.changefreq, priority: u.priority })));
              }
            } catch {}
          }
        }
        // Handle regular sitemap
        if (parsed.urlset?.url) {
          const urlList = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
          urls.push(...urlList.map(u => ({ loc: u.loc, lastmod: u.lastmod, changefreq: u.changefreq, priority: u.priority })));
        }
        return { found: true, url: sitemapUrl, urls };
      }
    } catch {}
  }
  return { found: false, urls: [] };
}

// ── Extract all links from a page ─────────────────
function extractLinks(html, baseUrl, rootDomain) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href')?.trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      const resolved = new URL(href, baseUrl).href;
      const resolved_domain = new URL(resolved).hostname.replace(/^www\./, '');
      if (resolved_domain === rootDomain && !resolved.match(/\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx|zip|mp4|mp3|css|js)(\?.*)?$/i)) {
        links.add(resolved.split('#')[0].split('?')[0]);
      }
    } catch {}
  });
  return [...links];
}

// ── Parse a single page ───────────────────────────
function parsePage(html, url, status) {
  const $ = cheerio.load(html);

  // Basic meta
  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || $('meta[name="Description"]').attr('content') || '';
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const robotsMeta = $('meta[name="robots"]').attr('content') || '';
  const isNoindex = robotsMeta.toLowerCase().includes('noindex');
  const isNofollow = robotsMeta.toLowerCase().includes('nofollow');

  // Open Graph
  const og = {
    title: $('meta[property="og:title"]').attr('content') || '',
    description: $('meta[property="og:description"]').attr('content') || '',
    image: $('meta[property="og:image"]').attr('content') || '',
    type: $('meta[property="og:type"]').attr('content') || '',
    url: $('meta[property="og:url"]').attr('content') || '',
    siteName: $('meta[property="og:site_name"]').attr('content') || ''
  };

  // Twitter Card
  const twitter = {
    card: $('meta[name="twitter:card"]').attr('content') || '',
    title: $('meta[name="twitter:title"]').attr('content') || '',
    description: $('meta[name="twitter:description"]').attr('content') || '',
    image: $('meta[name="twitter:image"]').attr('content') || ''
  };

  // Headings
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();

  // Images
  const images = $('img').map((_, el) => ({
    src: $(el).attr('src') || '',
    alt: $(el).attr('alt') || '',
    title: $(el).attr('title') || ''
  })).get();
  const imagesWithoutAlt = images.filter(img => !img.alt).length;

  // Schema / Structured Data
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const items = Array.isArray(json) ? json : [json];
      items.forEach(item => {
        if (item['@type']) schemas.push(item);
        if (item['@graph']) item['@graph'].forEach(g => { if (g['@type']) schemas.push(g); });
      });
    } catch {}
  });

  // Internal links
  const internalLinks = $('a[href]').map((_, el) => $(el).attr('href')).get()
    .filter(h => h && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('mailto:'));

  // Content
  $('script, style, nav, header, footer, .nav, .header, .footer, .menu').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  // Page speed signals
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const hasHttps = url.startsWith('https://');
  const scriptCount = $('script[src]').length;
  const styleCount = $('link[rel="stylesheet"]').length;

  // NAP detection (veterinary specific)
  const fullText = $('body').text();
  const phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
  const phones = [...new Set((fullText.match(phoneRegex) || []).map(p => p.trim()))];
  const hasAddress = /\d+\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Suite|Ste)/i.test(fullText);
  const hasHours = /(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|open|hours|am|pm)/i.test(fullText);

  // FAQ detection
  const hasFAQContent = $('[class*="faq"], [id*="faq"], [class*="accordion"]').length > 0 ||
    $('details summary').length > 0 ||
    fullText.toLowerCase().includes('frequently asked');

  return {
    url,
    status,
    pageTitle: title,
    metaDescription: metaDesc,
    canonical,
    robotsMeta,
    isNoindex,
    isNofollow,
    og,
    twitter,
    h1s,
    h2s,
    h3s,
    wordCount,
    schemas,
    schemaTypes: schemas.map(s => Array.isArray(s['@type']) ? s['@type'].join(', ') : s['@type']),
    internalLinks,
    images,
    imagesWithoutAlt,
    phones,
    hasAddress,
    hasHours,
    hasFAQContent,
    hasViewport,
    hasHttps,
    scriptCount,
    styleCount,
    titleLength: title.length,
    metaDescLength: metaDesc.length
  };
}

// ── Build URL hierarchy ───────────────────────────
function buildHierarchy(pages, rootUrl) {
  const root = new URL(rootUrl);
  const tree = [];
  const map = {};

  const sorted = [...pages].sort((a, b) => {
    const depthA = new URL(a.url).pathname.split('/').filter(Boolean).length;
    const depthB = new URL(b.url).pathname.split('/').filter(Boolean).length;
    return depthA - depthB;
  });

  for (const page of sorted) {
    try {
      const u = new URL(page.url);
      const parts = u.pathname.split('/').filter(Boolean);
      const depth = parts.length;
      const label = parts[parts.length - 1] || root.hostname;

      const node = {
        url: page.url,
        label: label || '/',
        depth,
        status: page.isNoindex ? 'noindex' : page.status >= 400 ? 'error' : page.status >= 300 ? 'redirect' : 'ok',
        type: classifyPage(page.url, page.pageTitle || ''),
        children: []
      };

      map[page.url] = node;

      if (depth === 0) {
        tree.push(node);
      } else {
        // find parent
        const parentPath = '/' + parts.slice(0, -1).join('/');
        const parentUrl = root.origin + parentPath;
        const parentNode = map[parentUrl] || map[root.origin + '/'] || map[root.href];
        if (parentNode) parentNode.children.push(node);
        else tree.push(node);
      }
    } catch { }
  }

  return tree;
}

function classifyPage(url, title) {
  const path = url.toLowerCase();
  const t = title.toLowerCase();
  if (path === '/' || path.endsWith('.com') || path.endsWith('.com/')) return 'homepage';
  if (/service|treatment|dental|surgery|wellness|vaccin|spay|neuter|emergency|urgent/.test(path + t)) return 'service';
  if (/team|doctor|dr\.|staff|vet|veterinarian|about/.test(path + t)) return 'team';
  if (/blog|news|article|post|resource|tip|health/.test(path + t)) return 'blog';
  if (/contact|location|direction|map|hour|find/.test(path + t)) return 'contact';
  if (/appointment|book|schedule|request/.test(path + t)) return 'booking';
  if (/client|new.patient|form|portal/.test(path + t)) return 'client';
  if (/dog|cat|bird|exotic|equine|rabbit|reptile|avian/.test(path + t)) return 'species';
  if (/testimonial|review/.test(path + t)) return 'reviews';
  return 'page';
}

// ── Main crawl function ───────────────────────────
async function crawlSite(rootUrl, options = {}) {
  const { pageLimit = 50, crawlSubpages = true } = options;
  const root = new URL(rootUrl);
  const rootDomain = root.hostname.replace(/^www\./, '');

  // Get robots.txt
  const robots = await getRobots(rootUrl);

  // Get XML sitemap
  const xmlSitemap = await getXMLSitemap(rootUrl);

  // Crawl queue
  const visited = new Set();
  const queue = [root.origin + '/'];
  const crawledPages = [];
  const inboundLinks = {}; // track which pages link to which

  // Add sitemap URLs to queue
  if (xmlSitemap.found) {
    xmlSitemap.urls.slice(0, pageLimit).forEach(u => {
      if (u.loc) queue.push(u.loc);
    });
  }

  while (queue.length > 0 && crawledPages.length < pageLimit) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(
      batch
        .filter(url => !visited.has(url))
        .map(async url => {
          visited.add(url);
          if (robots && !robots.isAllowed(url, USER_AGENT)) {
            return { url, status: 0, html: '', blocked: true };
          }
          return fetchPage(url);
        })
    );

    for (const result of results) {
      if (!result || result.blocked) continue;
      const isHtml = result.contentType.includes('text/html') || !result.contentType;
      if (!isHtml || !result.html) continue;

      const parsed = parsePage(result.html, result.url, result.status);
      crawledPages.push(parsed);

      // Track inbound links
      if (crawlSubpages && result.status < 400) {
        const links = extractLinks(result.html, result.url, rootDomain);
        links.forEach(link => {
          if (!inboundLinks[link]) inboundLinks[link] = [];
          inboundLinks[link].push(result.url);
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        });
      }
    }

    if (queue.length > 0) await sleep(200);
  }

  // Mark orphaned pages (no inbound links except homepage)
  crawledPages.forEach(page => {
    if (page.url !== root.origin + '/' && page.url !== rootUrl) {
      page.isOrphan = !inboundLinks[page.url] || inboundLinks[page.url].length === 0;
    }
  });

  return {
    domain: rootDomain,
    rootUrl,
    totalPagesCrawled: crawledPages.length,
    hasRobotsTxt: robots !== null,
    xmlSitemap,
    inboundLinks,
    pages: crawledPages
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { crawlSite, buildHierarchy, classifyPage };
