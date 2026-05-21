var lastSitemapData = null;

function runSitemap() {
  var url = validUrl(getVal('sitemapUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var pageLimit = parseInt(getVal('sitemapPageLimit')) || 500;
  setDisabled(['sitemapBtn'], true);
  startAndPoll(
    { url: url, type: 'sitemap', pageLimit: pageLimit },
    'sitemapOutput',
    ['Fetching root page...','Following internal links...','Checking robots.txt & XML sitemap...','Detecting noindex pages...','Identifying orphaned pages...','Mapping URL hierarchy...','Analyzing with Claude...','Building recommendations...'],
    function(data) {
      lastSitemapData = data;
      saveToFirestore('sitemap', data.domain, data);
      renderSitemap(data);
      setDisabled(['sitemapBtn'], false);
    },
    function(err) {
      document.getElementById('sitemapOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['sitemapBtn'], false);
    }
  );
}

function isBlogUrl(url) {
  return /\/blog\//i.test(url || '');
}

function renderSitemap(data) {
  var cs = Math.round((data.crawlability && data.crawlability.score) || 0);
  var allPages = data.pages || [];

  // Separate blog and non-blog pages
  var nonBlogPages = allPages.filter(function(p) { return p && !isBlogUrl(p.url); });
  var blogPages = allPages.filter(function(p) { return p && isBlogUrl(p.url); });

  // Filter sitemap tree to exclude blog nodes
  function filterTree(nodes) {
    if (!nodes || !nodes.length) return [];
    var filtered = [];
    nodes.forEach(function(n) {
      if (!n) return;
      if (isBlogUrl(n.url)) return; // skip blog URLs
      var filteredNode = Object.assign({}, n);
      filteredNode.children = filterTree(n.children);
      filtered.push(filteredNode);
    });
    return filtered;
  }
  var filteredTree = filterTree(data.sitemapTree || []);

  // Issue pages — non-blog only
  var issuePages = nonBlogPages.filter(function(p) {
    return p.status === 'noindex' || p.status === 'error' || p.status === 'redirect' || p.isOrphan;
  });

  function renderTree(nodes, depth) {
    depth = depth || 0;
    if (!nodes || !nodes.length) return '';
    var html = '';
    nodes.forEach(function(n) {
      if (!n) return;
      var trueStatus = (n.isOrphan && n.status === 'ok') ? 'orphan' : (n.status || 'ok');
      var statusLabels = { ok:'OK', noindex:'NOINDEX', orphan:'ORPHAN', redirect:'REDIRECT', error:'ERROR' };
      var statusLabel = statusLabels[trueStatus] || trueStatus.toUpperCase();
      var statusCls = 'status-' + trueStatus;
      var typeLabel = (n.type && n.type !== 'page' && n.type !== 'section') ?
        '<span class="node-type flag flag-info">' + n.type + '</span>' : '';
      var schemaLabel = n.hasSchema ? '<span class="node-type flag flag-ok">schema</span>' : '';
      var wordLabel = n.wordCount ? '<span style="font-size:.63rem;color:var(--muted2);margin-left:.3rem">' + n.wordCount + 'w</span>' : '';
      var safeUrl = (n.url || '').replace(/'/g, "\\'");
      html += '<div class="sitemap-node" style="padding-left:' + (depth * 16) + 'px">' +
        '<button onclick="openUrl(\'' + safeUrl + '\')" style="padding:.1rem .3rem;font-size:.62rem;margin-right:.3rem;flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--accent2);cursor:pointer">↗</button>' +
        '<span class="node-url" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem" title="' + (n.url||'') + '">' + (n.label||n.url||'') + '</span>' +
        wordLabel +
        '<span class="node-status ' + statusCls + '" style="margin-left:.4rem;flex-shrink:0">' + statusLabel + '</span>' +
        typeLabel + schemaLabel +
      '</div>';
      if (n.children && n.children.length) html += renderTree(n.children, depth + 1);
    });
    return html;
  }

  var issueCards = '';
  if (issuePages.length) {
    issueCards = '<div class="section-title">Pages Requiring Attention (' + issuePages.length + ')</div>';
    issuePages.forEach(function(p) {
      if (!p) return;
      var trueStatus = p.isOrphan ? 'orphan' : (p.status || 'ok');
      var flagType = trueStatus === 'noindex' ? 'warn' : trueStatus === 'error' ? 'error' : 'info';
      var safeUrl = (p.url || '').replace(/'/g, "\\'");
      issueCards += '<div class="page-card">' +
        '<div class="page-card-header" onclick="toggleCard(this)">' +
          '<div class="page-meta">' +
            '<div class="page-url">' + (p.url||'') + '</div>' +
            '<div class="page-title-sub">' + (p.pageTitle||'') + '</div>' +
          '</div>' +
          '<button onclick="event.stopPropagation();openUrl(\'' + safeUrl + '\')" class="btn btn-ghost btn-sm" style="flex-shrink:0;font-size:.7rem">↗ Open</button>' +
          '<span class="flag flag-' + flagType + '" style="margin-left:.5rem;flex-shrink:0">' + trueStatus.toUpperCase() + '</span>' +
          '<span class="arrow-icon">▸</span>' +
        '</div>' +
        '<div class="page-card-body">' +
          '<div style="margin-bottom:.75rem">' +
            '<div style="font-family:\'DM Mono\',monospace;font-size:.68rem;color:var(--muted);margin-bottom:.35rem">ISSUE</div>' +
            '<div style="font-size:.875rem;color:var(--text);line-height:1.65">' + (p.issue || getDefaultIssue(trueStatus, p)) + '</div>' +
          '</div>' +
          '<div class="priority-box">' +
            '<div class="priority-box-title">Recommendation</div>' +
            '<div style="font-size:.875rem;color:var(--text);line-height:1.65">' + (p.recommendation || getDefaultRecommendation(trueStatus)) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
  }

  var strengths = (data.urlAnalysis && data.urlAnalysis.strengths) || [];
  var issues = (data.urlAnalysis && data.urlAnalysis.issues) || [];
  var recommendations = (data.urlAnalysis && data.urlAnalysis.recommendations) || [];
  var overallReport = data.overallReport || '';
  var noAnalysisMsg = '<div style="font-size:.82rem;color:var(--muted);font-family:\'DM Mono\',monospace">AI analysis unavailable for this section. Run the SEO Audit for detailed recommendations.</div>';

  // Blog summary box
  var blogBox = '<div style="background:rgba(108,99,245,.06);border:1px solid rgba(108,99,245,.2);border-radius:11px;padding:1.1rem 1.25rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap">' +
    '<div style="font-size:1.5rem">📝</div>' +
    '<div style="flex:1">' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:.72rem;letter-spacing:.08em;color:var(--accent2);margin-bottom:.25rem">BLOG POSTS FOUND</div>' +
      '<div style="font-size:.9rem;color:var(--text)">' +
        '<strong style="font-size:1.4rem;color:var(--accent2);font-family:\'Fraunces\',serif">' + blogPages.length + '</strong> ' +
        'pages with <code style="background:var(--surface2);padding:.1rem .35rem;border-radius:4px;font-size:.8rem">/blog/</code> in the URL were found but excluded from this sitemap view.' +
      '</div>' +
      '<div style="font-size:.8rem;color:var(--muted);margin-top:.35rem">Use the <strong>Blog Audit</strong> tab to analyze all blog posts separately.</div>' +
    '</div>' +
    '<button onclick="showView(\'blog\');document.getElementById(\'blogUrl\').value=\'' + (data.domain ? 'https://www.' + data.domain : '') + '\'" class="btn btn-secondary" style="flex-shrink:0;font-size:.75rem">📝 Audit Blogs →</button>' +
  '</div>';

  document.getElementById('sitemapOutput').innerHTML =
    '<div class="info-msg">✓ Real crawl complete — ' + allPages.length + ' total pages discovered on ' + (data.domain||'') +
      (data.hasXMLSitemap ? ' · XML sitemap found (' + (data.xmlSitemapUrlCount||0) + ' URLs)' : ' · No XML sitemap') +
      (data.hasRobotsTxt ? ' · robots.txt found' : ' · No robots.txt') +
    '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportSitemapPDF()">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Sitemap Overview — ' + (data.domain||'') + '</div>' +
    '<div class="score-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="score-card"><div class="score-label">Non-Blog Pages</div><div class="score-num" style="color:var(--accent2)">' + nonBlogPages.length + '</div></div>' +
      '<div class="score-card"><div class="score-label">Blog Posts</div><div class="score-num" style="color:var(--accent2)">' + blogPages.length + '</div><div style="font-size:.65rem;color:var(--muted);margin-top:.2rem">excluded from tree</div></div>' +
      '<div class="score-card"><div class="score-label">Crawlability</div>' +
        '<div class="score-num" style="color:' + scoreColor(cs) + '">' + cs + '</div>' +
        '<div class="score-bar"><div class="score-fill" style="width:' + cs + '%;background:' + scoreColor(cs) + '"></div></div>' +
      '</div>' +
      '<div class="score-card"><div class="score-label">Pages w/ Issues</div>' +
        '<div class="score-num" style="color:' + (issuePages.length > 0 ? 'var(--red)' : 'var(--green)') + '">' + issuePages.length + '</div>' +
        '<div style="font-size:.65rem;color:var(--muted);margin-top:.2rem">non-blog only</div>' +
      '</div>' +
    '</div>' +

    blogBox +

    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🗺 SITEMAP TREE — Non-Blog Pages Only</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:.67rem;color:var(--muted);margin-bottom:.65rem;display:flex;gap:1rem;flex-wrap:wrap">' +
          '<span class="flag flag-ok">OK</span> Indexed &nbsp;' +
          '<span class="flag flag-warn">NOINDEX</span> Hidden &nbsp;' +
          '<span class="flag flag-info">ORPHAN</span> No inbound links &nbsp;' +
          '<span class="flag flag-error">ERROR</span> Broken &nbsp;' +
          '<span class="flag flag-warn">REDIRECT</span> Redirected' +
        '</div>' +
        '<div class="sitemap-wrapper"><div class="sitemap-tree">' + renderTree(filteredTree) + '</div></div>' +
      '</div>' +
    '</div>' +

    issueCards +

    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ URL STRENGTHS</span><span class="arrow-icon" style="margin-left:auto">▾</span></div>' +
      '<div class="page-card-body open">' + (strengths.length ? '<ul style="padding-left:1.1rem;font-size:.875rem;line-height:2.1">' + strengths.map(function(s){return '<li class="green">'+s+'</li>';}).join('') + '</ul>' : noAnalysisMsg) + '</div>' +
    '</div>' +

    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--red)">⚠ URL ISSUES</span><span class="arrow-icon" style="margin-left:auto">▾</span></div>' +
      '<div class="page-card-body open">' + (issues.length ? '<ul style="padding-left:1.1rem;font-size:.875rem;line-height:2.1">' + issues.map(function(s){return '<li class="red">'+s+'</li>';}).join('') + '</ul>' : noAnalysisMsg) + '</div>' +
    '</div>' +

    '<div class="page-card">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--blue)">📊 FULL ANALYSIS REPORT</span><span class="arrow-icon" style="margin-left:auto">▾</span></div>' +
      '<div class="page-card-body open">' + (overallReport ? '<div class="prose">' + overallReport.split('\n\n').map(function(p){return '<p>'+p+'</p>';}).join('') + '</div>' : noAnalysisMsg) + '</div>' +
    '</div>';
}

function getDefaultIssue(status, page) {
  var wc = (page && page.wordCount) || 0;
  var hasSchema = page && page.hasSchema;
  if (status === 'orphan') return 'ORPHAN PAGE — No internal links from any other crawled page point to this URL. Google and visitors can only find it via the XML sitemap or a direct URL. Word count: ' + wc + ' words. Schema: ' + (hasSchema ? 'Present' : 'Missing') + '.';
  if (status === 'noindex') return 'NOINDEX — A robots meta tag tells search engines NOT to index this page. It will not appear in Google search results.';
  if (status === 'error') return 'HTTP ' + ((page && page.status) || '4xx/5xx') + ' ERROR — This page returned an error. Search engines cannot crawl or index broken pages.';
  if (status === 'redirect') return 'REDIRECT — This URL redirects to another page. Links pointing here transfer equity to the destination.';
  return 'This page may have crawlability issues. Review in Google Search Console.';
}

function getDefaultRecommendation(status) {
  if (status === 'orphan') return 'Add internal links from relevant service pages, navigation menus, or related content. If outdated, consider a 301 redirect or unpublish it.';
  if (status === 'noindex') return 'Verify the noindex tag is intentional. If this page should rank in Google, remove the noindex directive.';
  if (status === 'error') return 'Fix the page or set up a 301 redirect to the most relevant live page. Remove from XML sitemap and internal links.';
  if (status === 'redirect') return 'Update all internal links and sitemap entries to point directly to the final destination URL.';
  return 'Review this page in Google Search Console for indexation issues.';
}

function exportSitemapPDF() {
  if (!lastSitemapData) { alert('No sitemap data to export. Run a sitemap build first.'); return; }
  generatePDF('sitemap', lastSitemapData);
}
