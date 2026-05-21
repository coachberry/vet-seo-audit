const axios = require('axios');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const xml2js = require('xml2js');
const { URL } = require('url');

const USER_AGENT = 'VetSEOAuditor/1.0 (compatible; Googlebot/2.1)';
const REQUEST_TIMEOUT = 12000;
const CONCURRENCY = 4;

function isBlogUrl(url) {
  try {
    return /\/blog\//i.test(new URL(url).pathname);
  } catch(e) { return false; }
}

async function fetchPage(url, retries) {
  retries = retries === undefined ? 2 : retries;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var res = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache' },
        maxRedirects: 5,
        validateStatus: function() { return true; }
      });
      return {
        url: (res.request && res.request.res && res.request.res.responseUrl) || url,
        status: res.status,
        html: res.data || '',
        contentType: res.headers['content-type'] || ''
      };
    } catch(e) {
      if (attempt === retries) return { url: url, status: 0, html: '', error: e.message };
      await sleep(300 * (attempt + 1));
    }
  }
}

async function getRobots(rootUrl) {
  try {
    var res = await axios.get(new URL('/robots.txt', rootUrl).href, {
      timeout: 5000, headers: { 'User-Agent': USER_AGENT }, validateStatus: function() { return true; }
    });
    if (res.status === 200) return robotsParser(new URL('/robots.txt', rootUrl).href, res.data);
  } catch(e) {}
  return null;
}

async function getXMLSitemap(rootUrl) {
  var candidates = ['/sitemap.xml', '/sitemap_index.xml'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var sitemapUrl = new URL(candidates[i], rootUrl).href;
      var res = await axios.get(sitemapUrl, { timeout: 8000, validateStatus: function() { return true; } });
      if (res.status !== 200 || !res.data) continue;
      var parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false }).catch(function() { return null; });
      if (!parsed) continue;
      var urls = [];
      if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
        var sitemaps = Array.isArray(parsed.sitemapindex.sitemap) ? parsed.sitemapindex.sitemap : [parsed.sitemapindex.sitemap];
        for (var j = 0; j < Math.min(sitemaps.length, 10); j++) {
          try {
            var subRes = await axios.get(sitemaps[j].loc, { timeout: 8000, validateStatus: function() { return true; } });
            var subParsed = await xml2js.parseStringPromise(subRes.data, { explicitArray: false }).catch(function() { return null; });
            if (subParsed && subParsed.urlset && subParsed.urlset.url) {
              var subUrls = Array.isArray(subParsed.urlset.url) ? subParsed.urlset.url : [subParsed.urlset.url];
              subUrls.forEach(function(u) { if (u.loc) urls.push({ loc: u.loc, priority: parseFloat(u.priority) || 0.5 }); });
            }
          } catch(e) {}
        }
      }
      if (parsed.urlset && parsed.urlset.url) {
        var urlList = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
        urlList.forEach(function(u) { if (u.loc) urls.push({ loc: u.loc, priority: parseFloat(u.priority) || 0.5 }); });
      }
      return { found: true, url: sitemapUrl, urls: urls };
    } catch(e) {}
  }
  return { found: false, urls: [] };
}

function extractLinks(html, baseUrl, rootDomain) {
  var $ = cheerio.load(html);
  var navLinks = [];
  var regularLinks = [];
  $('a[href]').each(function(_, el) {
    try {
      var href = $(el).attr('href') && $(el).attr('href').trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      var resolved = new URL(href, baseUrl).href.split('#')[0].split('?')[0].replace(/\/$/, '') || baseUrl;
      var domain = new URL(resolved).hostname.replace(/^www\./, '');
      if (domain !== rootDomain) return;
      if (resolved.match(/\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx|zip|mp4|mp3|css|js)(\?.*)?$/i)) return;
      var inNav = $(el).closest('nav, header, .nav, .menu, .header, [class*="nav"], [class*="menu"]').length > 0;
      if (inNav) navLinks.push(resolved);
      else regularLinks.push(resolved);
    } catch(e) {}
  });
  return navLinks.concat(regularLinks);
}

function parsePage(html, url, status) {
  if (!html) html = '';
  var $ = cheerio.load(html);
  var title = $('title').first().text().trim() || '';
  var metaDesc = $('meta[name="description"]').attr('content') || $('meta[name="Description"]').attr('content') || '';
  var canonical = $('link[rel="canonical"]').attr('href') || '';
  var robotsMeta = $('meta[name="robots"]').attr('content') || '';
  var isNoindex = robotsMeta.toLowerCase().includes('noindex');
  var og = {
    title: $('meta[property="og:title"]').attr('content') || '',
    description: $('meta[property="og:description"]').attr('content') || '',
    image: $('meta[property="og:image"]').attr('content') || '',
    type: $('meta[property="og:type"]').attr('content') || '',
    url: $('meta[property="og:url"]').attr('content') || ''
  };
  var twitter = {
    card: $('meta[name="twitter:card"]').attr('content') || '',
    title: $('meta[name="twitter:title"]').attr('content') || '',
    description: $('meta[name="twitter:description"]').attr('content') || '',
    image: $('meta[name="twitter:image"]').attr('content') || ''
  };
  var h1s = $('h1').map(function(_, el) { return $(el).text().trim(); }).get().filter(Boolean);
  var h2s = $('h2').map(function(_, el) { return $(el).text().trim(); }).get().filter(Boolean).slice(0, 10);
  var h3s = $('h3').map(function(_, el) { return $(el).text().trim(); }).get().filter(Boolean).slice(0, 10);
  var images = $('img').map(function(_, el) { return { src: $(el).attr('src') || '', alt: $(el).attr('alt') || '' }; }).get();
  var imagesWithoutAlt = images.filter(function(img) { return !img.alt; }).length;
  var schemas = [];
  $('script[type="application/ld+json"]').each(function(_, el) {
    try {
      var json = JSON.parse($(el).html());
      var items = Array.isArray(json) ? json : [json];
      items.forEach(function(item) {
        if (item && item['@type']) schemas.push(item);
        if (item && item['@graph']) item['@graph'].forEach(function(g) { if (g && g['@type']) schemas.push(g); });
      });
    } catch(e) {}
  });
  $('script, style, nav, header, footer').remove();
  var bodyText = ($('body').text() || '').replace(/\s+/g, ' ').trim();
  var wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  var phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
  var phones = Array.from(new Set((bodyText.match(phoneRegex) || []).map(function(p) { return p.trim(); })));
  var hasAddress = /\d+\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Suite|Ste)/i.test(bodyText);
  var hasHours = /(?:mon|tue|wed|thu|fri|sat|sun|open|hours|am|pm)/i.test(bodyText);
  var publishDate = $('meta[property="article:published_time"]').attr('content') ||
    $('time[datetime]').first().attr('datetime') || '';
  var author = $('meta[name="author"]').attr('content') ||
    $('[class*="author"]').first().text().trim() || '';
  return {
    url: url, status: status,
    pageTitle: title, metaDescription: metaDesc,
    canonical: canonical, robotsMeta: robotsMeta, isNoindex: isNoindex,
    og: og, twitter: twitter,
    h1s: h1s, h2s: h2s, h3s: h3s,
    wordCount: wordCount, schemas: schemas,
    schemaTypes: schemas.map(function(s) { return Array.isArray(s['@type']) ? s['@type'].join(', ') : s['@type']; }).filter(Boolean),
    images: images, imagesWithoutAlt: imagesWithoutAlt,
    phones: phones, hasAddress: hasAddress, hasHours: hasHours,
    hasViewport: $('meta[name="viewport"]').length > 0,
    hasHttps: url.startsWith('https://'),
    titleLength: title.length, metaDescLength: metaDesc.length,
    hasFAQContent: $('[class*="faq"],[id*="faq"],details').length > 0,
    isBlog: isBlogUrl(url),
    publishDate: publishDate,
    author: author
  };
}

function buildHierarchy(pages, rootUrl) {
  var origin = new URL(rootUrl).origin;
  var seen = new Set();
  var dedupedPages = [];
  pages.forEach(function(page) {
    if (!page || !page.url) return;
    var normalized = page.url.replace(/\/$/, '').toLowerCase();
    if (!seen.has(normalized)) { seen.add(normalized); dedupedPages.push(page); }
  });

  var nodesByPath = {};
  dedupedPages.forEach(function(page) {
    try {
      var u = new URL(page.url);
      var pathname = u.pathname.replace(/\/$/, '') || '/';
      if (nodesByPath[pathname]) return;
      var parts = pathname === '/' ? [] : pathname.split('/').filter(Boolean);
      nodesByPath[pathname] = {
        url: page.url,
        label: pathname === '/' ? '/' : pathname,
        depth: parts.length,
        status: page.isNoindex ? 'noindex' : page.status >= 400 ? 'error' : page.status >= 300 ? 'redirect' : 'ok',
        isOrphan: page.isOrphan || false,
        type: classifyPage(page.url, page.pageTitle || ''),
        pageTitle: page.pageTitle || '',
        wordCount: page.wordCount || 0,
        hasSchema: page.schemas && page.schemas.length > 0,
        publishDate: page.publishDate || '',
        author: page.author || '',
        children: []
      };
    } catch(e) {}
  });

  var roots = [];
  Object.keys(nodesByPath).sort().forEach(function(pathname) {
    var node = nodesByPath[pathname];
    if (pathname === '/') { roots.unshift(node); return; }
    var parts = pathname.split('/').filter(Boolean);
    var parentPath = parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');
    if (!nodesByPath[parentPath]) {
      var vParts = parentPath === '/' ? [] : parentPath.split('/').filter(Boolean);
      nodesByPath[parentPath] = {
        url: origin + parentPath, label: parentPath,
        depth: vParts.length, status: 'ok', isOrphan: false,
        type: 'section', pageTitle: '', wordCount: 0, hasSchema: false,
        virtual: true, children: []
      };
      roots.push(nodesByPath[parentPath]);
    }
    nodesByPath[parentPath].children.push(node);
  });

  function sortNodes(nodes) {
    nodes.sort(function(a, b) {
      if (a.label === '/') return -1;
      if (b.label === '/') return 1;
      return a.label.localeCompare(b.label);
    });
    nodes.forEach(function(n) { if (n.children && n.children.length) sortNodes(n.children); });
  }
  sortNodes(roots);
  return roots;
}

function classifyPage(url, title) {
  try {
    var path = url.toLowerCase();
    var t = (title || '').toLowerCase();
    var parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length === 0) return 'homepage';
    if (/\/blog\//i.test(path)) return 'blog';
    if (/service|treatment|dental|surgery|wellness|vaccin|spay|neuter|emergency/.test(path + t)) return 'service';
    if (/team|doctor|dr\.|staff|veterinarian|about/.test(path + t)) return 'team';
    if (/contact|location|direction|hour|find/.test(path + t)) return 'contact';
    if (/appointment|book|schedule|request/.test(path + t)) return 'booking';
    if (/client|new.patient|form|portal/.test(path + t)) return 'client';
    if (/dog|cat|bird|exotic|equine|rabbit|reptile|avian/.test(path + t)) return 'species';
    if (/testimonial|review/.test(path + t)) return 'reviews';
    return 'page';
  } catch(e) { return 'page'; }
}

async function crawlSite(rootUrl, options) {
  options = options || {};
  var pageLimit = options.pageLimit || 100;
  var crawlSubpages = options.crawlSubpages !== false;
  var filterBlogs = options.filterBlogs || false;  // exclude /blog/ pages
  var blogOnly = options.blogOnly || false;          // only /blog/ pages

  var root = new URL(rootUrl);
  var rootDomain = root.hostname.replace(/^www\./, '');
  var normalizedRoot = root.origin + '/';

  var robots = await getRobots(rootUrl);
  var xmlSitemap = await getXMLSitemap(rootUrl);

  var visited = new Set();
  var priorityQueue = [normalizedRoot];
  var regularQueue = [];
  var sitemapQueue = [];

  // Seed from XML sitemap sorted by priority
  if (xmlSitemap.found) {
    var sitemapUrls = xmlSitemap.urls.slice().sort(function(a, b) {
      var da = (new URL(a.loc).pathname.match(/\//g) || []).length;
      var db2 = (new URL(b.loc).pathname.match(/\//g) || []).length;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return da - db2;
    });
    sitemapUrls.forEach(function(u) {
      if (u.loc) sitemapQueue.push(u.loc.replace(/\/$/, '') || u.loc);
    });
  }

  var crawledPages = [];
  var inboundLinks = {};

  function shouldInclude(url) {
    if (blogOnly) return isBlogUrl(url);
    if (filterBlogs) return !isBlogUrl(url);
    return true;
  }

  function getNext() {
    if (priorityQueue.length) return priorityQueue.shift();
    if (regularQueue.length) return regularQueue.shift();
    if (sitemapQueue.length) return sitemapQueue.shift();
    return null;
  }
  function hasMore() {
    return priorityQueue.length > 0 || regularQueue.length > 0 || sitemapQueue.length > 0;
  }

  while (hasMore() && crawledPages.length < pageLimit) {
    var batch = [];
    while (batch.length < CONCURRENCY && hasMore() && crawledPages.length + batch.length < pageLimit) {
      var url = getNext();
      if (!url) break;
      var normalized = url.replace(/\/$/, '') || url;
      if (!visited.has(normalized)) { visited.add(normalized); batch.push(url); }
    }
    if (!batch.length) break;

    var results = await Promise.all(batch.map(async function(url) {
      if (robots && !robots.isAllowed(url, USER_AGENT)) return null;
      return fetchPage(url);
    }));

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (!result || !result.html) continue;
      var isHtml = !result.contentType || result.contentType.includes('text/html');
      if (!isHtml) continue;

      var parsed = parsePage(result.html, result.url, result.status);

      // Only add to results if it matches our filter
      if (shouldInclude(result.url)) {
        crawledPages.push(parsed);
      }

      // Always follow links regardless of filter (to discover all pages)
      if (crawlSubpages && result.status < 400) {
        var links = extractLinks(result.html, result.url, rootDomain);
        links.forEach(function(link, idx) {
          var normLink = link.replace(/\/$/, '') || link;
          if (!inboundLinks[normLink]) inboundLinks[normLink] = [];
          inboundLinks[normLink].push(result.url);
          if (!visited.has(normLink)) {
            if (idx < 20) priorityQueue.push(link);
            else regularQueue.push(link);
          }
        });
      }
    }
    if (hasMore()) await sleep(100);
  }

  // Mark orphans
  crawledPages.forEach(function(page) {
    if (!page || !page.url) return;
    var normUrl = page.url.replace(/\/$/, '') || page.url;
    var isRoot = normUrl === root.origin || normUrl === root.origin + '/' || normUrl === normalizedRoot.replace(/\/$/, '');
    if (!isRoot) {
      page.isOrphan = !inboundLinks[normUrl] || inboundLinks[normUrl].length === 0;
      page.inboundCount = inboundLinks[normUrl] ? inboundLinks[normUrl].length : 0;
    } else {
      page.isOrphan = false;
      page.inboundCount = 999;
    }
  });

  return {
    domain: rootDomain, rootUrl: rootUrl,
    totalPagesCrawled: crawledPages.length,
    hasRobotsTxt: robots !== null,
    xmlSitemap: xmlSitemap,
    inboundLinks: inboundLinks,
    pages: crawledPages
  };
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
module.exports = { crawlSite: crawlSite, buildHierarchy: buildHierarchy, classifyPage: classifyPage, isBlogUrl: isBlogUrl };
