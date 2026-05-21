const axios = require('axios');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const xml2js = require('xml2js');
const { URL } = require('url');

const USER_AGENT = 'VetSEOAuditor/1.0 (compatible; Googlebot/2.1)';
const REQUEST_TIMEOUT = 12000;
const CONCURRENCY = 3;

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
      return { url: (res.request&&res.request.res&&res.request.res.responseUrl)||url, status: res.status, html: res.data, contentType: res.headers['content-type']||'' };
    } catch(e) {
      if (attempt === retries) return { url: url, status: 0, html: '', error: e.message };
      await sleep(500 * (attempt + 1));
    }
  }
}

async function getRobots(rootUrl) {
  try {
    var res = await axios.get(new URL('/robots.txt', rootUrl).href, { timeout: 5000, headers: { 'User-Agent': USER_AGENT }, validateStatus: function() { return true; } });
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
        for (var j = 0; j < Math.min(sitemaps.length, 5); j++) {
          try {
            var subRes = await axios.get(sitemaps[j].loc, { timeout: 8000, validateStatus: function() { return true; } });
            var subParsed = await xml2js.parseStringPromise(subRes.data, { explicitArray: false }).catch(function() { return null; });
            if (subParsed && subParsed.urlset && subParsed.urlset.url) {
              var subUrls = Array.isArray(subParsed.urlset.url) ? subParsed.urlset.url : [subParsed.urlset.url];
              subUrls.forEach(function(u) { if (u.loc) urls.push({ loc: u.loc }); });
            }
          } catch(e) {}
        }
      }
      if (parsed.urlset && parsed.urlset.url) {
        var urlList = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
        urlList.forEach(function(u) { if (u.loc) urls.push({ loc: u.loc }); });
      }
      return { found: true, url: sitemapUrl, urls: urls };
    } catch(e) {}
  }
  return { found: false, urls: [] };
}

function extractLinks(html, baseUrl, rootDomain) {
  var $ = cheerio.load(html);
  var links = new Set();
  $('a[href]').each(function(_, el) {
    try {
      var href = $(el).attr('href') && $(el).attr('href').trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      var resolved = new URL(href, baseUrl).href.split('#')[0].split('?')[0];
      var domain = new URL(resolved).hostname.replace(/^www\./, '');
      if (domain === rootDomain && !resolved.match(/\.(jpg|jpeg|png|gif|svg|webp|pdf|doc|docx|zip|mp4|mp3|css|js)(\?.*)?$/i)) {
        links.add(resolved.replace(/\/$/, '') || resolved);
      }
    } catch(e) {}
  });
  return Array.from(links);
}

function parsePage(html, url, status) {
  var $ = cheerio.load(html);
  var title = $('title').first().text().trim();
  var metaDesc = $('meta[name="description"]').attr('content') || '';
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
  var h1s = $('h1').map(function(_, el) { return $(el).text().trim(); }).get();
  var h2s = $('h2').map(function(_, el) { return $(el).text().trim(); }).get();
  var images = $('img').map(function(_, el) { return { src: $(el).attr('src')||'', alt: $(el).attr('alt')||'' }; }).get();
  var imagesWithoutAlt = images.filter(function(img) { return !img.alt; }).length;
  var schemas = [];
  $('script[type="application/ld+json"]').each(function(_, el) {
    try {
      var json = JSON.parse($(el).html());
      var items = Array.isArray(json) ? json : [json];
      items.forEach(function(item) {
        if (item['@type']) schemas.push(item);
        if (item['@graph']) item['@graph'].forEach(function(g) { if (g['@type']) schemas.push(g); });
      });
    } catch(e) {}
  });
  $('script, style, nav, header, footer').remove();
  var wordCount = $('body').text().replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  var fullText = $('body').text();
  var phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
  var phones = Array.from(new Set((fullText.match(phoneRegex)||[]).map(function(p){return p.trim();})));
  var hasAddress = /\d+\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Suite|Ste)/i.test(fullText);
  var hasHours = /(?:mon|tue|wed|thu|fri|sat|sun|open|hours|am|pm)/i.test(fullText);
  return {
    url: url, status: status, pageTitle: title, metaDescription: metaDesc,
    canonical: canonical, robotsMeta: robotsMeta, isNoindex: isNoindex,
    og: og, twitter: twitter, h1s: h1s, h2s: h2s,
    wordCount: wordCount, schemas: schemas,
    schemaTypes: schemas.map(function(s) { return Array.isArray(s['@type']) ? s['@type'].join(', ') : s['@type']; }),
    images: images, imagesWithoutAlt: imagesWithoutAlt,
    phones: phones, hasAddress: hasAddress, hasHours: hasHours,
    hasViewport: $('meta[name="viewport"]').length > 0,
    hasHttps: url.startsWith('https://'),
    titleLength: title.length, metaDescLength: metaDesc.length
  };
}

function buildHierarchy(pages, rootUrl) {
  var origin = new URL(rootUrl).origin;

  // Deduplicate pages by normalized URL
  var seen = new Set();
  var dedupedPages = [];
  pages.forEach(function(page) {
    // Normalize: strip trailing slash, lowercase
    var normalized = page.url.replace(/\/$/, '').toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      dedupedPages.push(page);
    }
  });

  // Build flat map of pathname -> node
  var nodesByPath = {};

  // First pass: create all nodes
  dedupedPages.forEach(function(page) {
    try {
      var u = new URL(page.url);
      var pathname = u.pathname.replace(/\/$/, '') || '/';

      // Skip duplicate root paths
      if (nodesByPath[pathname]) return;

      var parts = pathname === '/' ? [] : pathname.split('/').filter(Boolean);
      var displayLabel = pathname === '/' ? '/' : pathname;

      var node = {
        url: page.url,
        label: displayLabel,
        depth: parts.length,
        status: page.isNoindex ? 'noindex' : page.status >= 400 ? 'error' : page.status >= 300 ? 'redirect' : 'ok',
        isOrphan: page.isOrphan || false,
        type: classifyPage(page.url, page.pageTitle || ''),
        pageTitle: page.pageTitle || '',
        wordCount: page.wordCount || 0,
        hasSchema: page.schemas && page.schemas.length > 0,
        children: []
      };

      nodesByPath[pathname] = node;
    } catch(e) {}
  });

  // Second pass: build tree by linking children to parents
  var roots = [];
  Object.keys(nodesByPath).forEach(function(pathname) {
    var node = nodesByPath[pathname];
    if (pathname === '/') {
      roots.unshift(node); // homepage first
      return;
    }
    // Find parent by removing last segment
    var parts = pathname.split('/').filter(Boolean);
    var parentPath = parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');

    if (nodesByPath[parentPath]) {
      nodesByPath[parentPath].children.push(node);
    } else {
      // Create virtual parent nodes for missing intermediate paths
      var currentPath = '';
      var lastExistingNode = nodesByPath['/'];
      for (var i = 0; i < parts.length - 1; i++) {
        currentPath += '/' + parts[i];
        if (!nodesByPath[currentPath]) {
          var virtualNode = {
            url: origin + currentPath,
            label: currentPath,
            depth: i + 1,
            status: 'ok',
            isOrphan: false,
            type: 'section',
            pageTitle: '',
            wordCount: 0,
            hasSchema: false,
            virtual: true,
            children: []
          };
          nodesByPath[currentPath] = virtualNode;
          if (lastExistingNode) {
            lastExistingNode.children.push(virtualNode);
          } else {
            roots.push(virtualNode);
          }
        }
        lastExistingNode = nodesByPath[currentPath];
      }
      if (lastExistingNode && lastExistingNode !== node) {
        lastExistingNode.children.push(node);
      } else if (!lastExistingNode) {
        roots.push(node);
      }
    }
  });

  // Sort children alphabetically at each level
  function sortChildren(nodes) {
    nodes.sort(function(a, b) {
      // Homepage always first
      if (a.label === '/') return -1;
      if (b.label === '/') return 1;
      return a.label.localeCompare(b.label);
    });
    nodes.forEach(function(n) { if (n.children.length) sortChildren(n.children); });
  }
  sortChildren(roots);

  return roots;
}

function classifyPage(url, title) {
  var path = url.toLowerCase();
  var t = (title || '').toLowerCase();
  var parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return 'homepage';
  if (/\/blog\//.test(path)) return 'blog';
  if (/service|treatment|dental|surgery|wellness|vaccin|spay|neuter|emergency/.test(path + t)) return 'service';
  if (/team|doctor|dr\.|staff|veterinarian|about/.test(path + t)) return 'team';
  if (/contact|location|direction|hour|find/.test(path + t)) return 'contact';
  if (/appointment|book|schedule|request/.test(path + t)) return 'booking';
  if (/client|new.patient|form|portal/.test(path + t)) return 'client';
  if (/dog|cat|bird|exotic|equine|rabbit|reptile|avian/.test(path + t)) return 'species';
  if (/testimonial|review/.test(path + t)) return 'reviews';
  return 'page';
}

async function crawlSite(rootUrl, options) {
  options = options || {};
  var pageLimit = options.pageLimit || 50;
  var crawlSubpages = options.crawlSubpages !== false;
  var root = new URL(rootUrl);
  var rootDomain = root.hostname.replace(/^www\./, '');
  // Normalize root URL - no trailing slash
  var normalizedRoot = root.origin + '/';

  var robots = await getRobots(rootUrl);
  var xmlSitemap = await getXMLSitemap(rootUrl);

  var visited = new Set();
  var queue = [normalizedRoot];
  var crawledPages = [];
  var inboundLinks = {};

  // Add XML sitemap URLs to queue
  if (xmlSitemap.found) {
    xmlSitemap.urls.slice(0, pageLimit * 2).forEach(function(u) {
      if (u.loc) {
        var normalized = u.loc.replace(/\/$/, '');
        if (!queue.includes(normalized)) queue.push(normalized);
      }
    });
  }

  while (queue.length > 0 && crawledPages.length < pageLimit) {
    var batch = [];
    while (batch.length < CONCURRENCY && queue.length > 0) {
      var url = queue.shift();
      var normalized = url.replace(/\/$/, '') || url;
      if (!visited.has(normalized)) {
        visited.add(normalized);
        batch.push(url);
      }
    }
    if (!batch.length) continue;

    var results = await Promise.all(batch.map(async function(url) {
      if (robots && !robots.isAllowed(url, USER_AGENT)) return null;
      return fetchPage(url);
    }));

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (!result || !result.html) continue;
      var isHtml = result.contentType.includes('text/html') || !result.contentType;
      if (!isHtml) continue;

      var parsed = parsePage(result.html, result.url, result.status);
      crawledPages.push(parsed);

      if (crawlSubpages && result.status < 400) {
        var links = extractLinks(result.html, result.url, rootDomain);
        links.forEach(function(link) {
          var normLink = link.replace(/\/$/, '') || link;
          if (!inboundLinks[normLink]) inboundLinks[normLink] = [];
          inboundLinks[normLink].push(result.url);
          if (!visited.has(normLink)) queue.push(link);
        });
      }
    }
    if (queue.length > 0) await sleep(150);
  }

  // Mark orphans - pages with no inbound links except homepage
  crawledPages.forEach(function(page) {
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

module.exports = { crawlSite: crawlSite, buildHierarchy: buildHierarchy, classifyPage: classifyPage };
