var lastSitemapData = null;

function runSitemap() {
  var url = validUrl(getVal('sitemapUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  setDisabled(['sitemapBtn'], true);
  startAndPoll(
    { url: url, type: 'sitemap' },
    'sitemapOutput',
    ['Fetching root page...','Following internal links...','Checking robots.txt & XML sitemap...','Detecting noindex pages...','Identifying orphaned pages...','Mapping URL hierarchy...','Building recommendations...'],
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

function renderSitemap(data) {
  var cs = Math.round(data.crawlability && data.crawlability.score || 0);

  // Count real issues - pages that are orphan, noindex, error, or redirect
  var allPages = data.pages || [];
  var issuePages = allPages.filter(function(p) {
    return p.status === 'noindex' || p.status === 'error' || p.status === 'redirect' || p.isOrphan;
  });

  function renderTree(nodes, depth) {
    depth = depth || 0;
    if (!nodes || !nodes.length) return '';
    var html = '';
    nodes.forEach(function(n) {
      // Determine true status - orphan takes priority over ok
      var trueStatus = n.status;
      if (n.isOrphan && trueStatus === 'ok') trueStatus = 'orphan';
      var statusCls = 'status-' + trueStatus;
      var statusLabels = { ok:'OK', noindex:'NOINDEX', orphan:'ORPHAN', redirect:'REDIRECT', error:'ERROR' };
      var statusLabel = statusLabels[trueStatus] || trueStatus.toUpperCase();
      var typeLabel = n.type && n.type !== 'page' ? '<span class="node-type flag flag-info">' + n.type + '</span>' : '';
      var schemaLabel = n.hasSchema ? '<span class="node-type flag flag-ok">schema</span>' : '';
      var wordLabel = n.wordCount ? '<span style="font-size:.65rem;color:var(--muted2);margin-left:.25rem">' + n.wordCount + 'w</span>' : '';

      html += '<div class="sitemap-node" style="padding-left:' + (depth * 16) + 'px">' +
        '<button onclick="openUrl(\'' + n.url.replace(/'/g, "\\'") + '\')" class="btn-ghost btn-sm" style="padding:.1rem .35rem;font-size:.65rem;margin-right:.35rem;flex-shrink:0" title="Open page">↗</button>' +
        '<span class="node-url" title="' + n.url + '">' + n.label + '</span>' +
        wordLabel +
        '<span class="node-status ' + statusCls + '" style="margin-left:.5rem">' + statusLabel + '</span>' +
        typeLabel + schemaLabel +
      '</div>';

      if (n.children && n.children.length) {
        html += renderTree(n.children, depth + 1);
      }
    });
    return html;
  }

  // Build issue cards with clickable links
  var issueCards = '';
  if (issuePages.length) {
    issueCards = '<div class="section-title">Pages Requiring Attention (' + issuePages.length + ')</div>';
    issuePages.forEach(function(p) {
      var trueStatus = p.isOrphan ? 'orphan' : p.status;
      var flagType = trueStatus === 'noindex' ? 'warn' : trueStatus === 'error' ? 'error' : 'info';
      issueCards += '<div class="page-card">' +
        '<div class="page-card-header" onclick="toggleCard(this)">' +
          '<div class="page-meta">' +
            '<div class="page-url">' + p.url + '</div>' +
            '<div class="page-title-sub">' + (p.pageTitle || '') + '</div>' +
          '</div>' +
          '<button onclick="event.stopPropagation();openUrl(\'' + p.url.replace(/'/g, "\\'") + '\')" class="btn btn-ghost btn-sm" style="flex-shrink:0">↗ Open</button>' +
          '<span class="flag flag-' + flagType + '" style="margin-left:.5rem">' + trueStatus.toUpperCase() + '</span>' +
          '<span class="arrow-icon">▸</span>' +
        '</div>' +
        '<div class="page-card-body">' +
          '<div style="margin-bottom:.75rem">' +
            '<div style="font-family:\'DM Mono\',monospace;font-size:.68rem;color:var(--muted);margin-bottom:.35rem">ISSUE</div>' +
            '<div style="font-size:.875rem;color:var(--text)">' + (p.issue || getDefaultIssue(trueStatus, p)) + '</div>' +
          '</div>' +
          '<div class="priority-box">' +
            '<div class="priority-box-title">Recommendation</div>' +
            '<div style="font-size:.875rem;color:var(--text)">' + (p.recommendation || getDefaultRecommendation(trueStatus)) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
  }

  var strengths = data.urlAnalysis && data.urlAnalysis.strengths || [];
  var issues = data.urlAnalysis && data.urlAnalysis.issues || [];
  var recommendations = data.urlAnalysis && data.urlAnalysis.recommendations || [];
  var overallReport = data.overallReport || '';

  // If Claude analysis didn't return content, show a helpful message
  var noAnalysisMsg = '<div style="font-size:.875rem;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:.75rem">Analysis data unavailable — the AI analysis timed out for this section. Run the full SEO Audit for detailed recommendations.</div>';

  document.getElementById('sitemapOutput').innerHTML =
    '<div class="info-msg">✓ Real crawl complete — ' + allPages.length + ' pages discovered on ' + data.domain +
    (data.hasXMLSitemap ? ' · XML sitemap found (' + (data.xmlSitemapUrlCount||0) + ' URLs)' : ' · No XML sitemap found') +
    (data.hasRobotsTxt ? ' · robots.txt found' : ' · No robots.txt') + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportSitemapPDF()">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Sitemap Overview — ' + data.domain + '</div>' +
    '<div class="score-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="score-card"><div class="score-label">Total Pages</div><div class="score-num" style="color:var(--accent2)">' + allPages.length + '</div></div>' +
      '<div class="score-card"><div class="score-label">Crawl Depth</div><div class="score-num" style="color:var(--blue)">' + (data.maxDepth||0) + '</div></div>' +
      '<div class="score-card"><div class="score-label">Crawlability</div><div class="score-num" style="color:' + scoreColor(cs) + '">' + cs + '</div>' +
        '<div class="score-bar"><div class="score-fill" style="width:' + cs + '%;background:' + scoreColor(cs) + '"></div></div></div>' +
      '<div class="score-card"><div class="score-label">Pages w/ Issues</div><div class="score-num" style="color:' + (issuePages.length>0?'var(--red)':'var(--green)') + '">' + issuePages.length + '</div>' +
        '<div style="font-size:.65rem;color:var(--muted);margin-top:.25rem">' + allPages.length + ' total pages</div></div>' +
    '</div>' +

    // Sitemap tree
    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🗺 SITEMAP TREE — All Pages Visible to Visitors & Crawlers</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:.68rem;color:var(--muted);margin-bottom:.65rem;display:flex;gap:1rem;flex-wrap:wrap">' +
          '<span class="flag flag-ok">OK</span> Indexed & linked &nbsp;' +
          '<span class="flag flag-warn">NOINDEX</span> Hidden from search &nbsp;' +
          '<span class="flag flag-info">ORPHAN</span> No inbound links &nbsp;' +
          '<span class="flag flag-error">ERROR</span> Broken &nbsp;' +
          '<span class="flag flag-warn">REDIRECT</span> Redirected' +
        '</div>' +
        '<div class="sitemap-wrapper"><div class="sitemap-tree">' + renderTree(data.sitemapTree || []) + '</div></div>' +
      '</div>' +
    '</div>' +

    issueCards +

    // Strengths
    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ URL STRENGTHS</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        (strengths.length ? '<ul style="padding-left:1.1rem;font-size:.875rem;line-height:2.1">' + strengths.map(function(s){return '<li class="green">'+s+'</li>';}).join('') + '</ul>' : noAnalysisMsg) +
      '</div>' +
    '</div>' +

    // Issues
    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--red)">⚠ URL ISSUES</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        (issues.length ? '<ul style="padding-left:1.1rem;font-size:.875rem;line-height:2.1">' + issues.map(function(s){return '<li class="red">'+s+'</li>';}).join('') + '</ul>' : noAnalysisMsg) +
      '</div>' +
    '</div>' +

    // Full analysis
    '<div class="page-card">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--blue)">📊 FULL ANALYSIS REPORT</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        (overallReport ? '<div class="prose">' + overallReport.split('\n\n').map(function(p){return '<p>'+p+'</p>';}).join('') + '</div>' : noAnalysisMsg) +
      '</div>' +
    '</div>';
}

function getDefaultIssue(status, page) {
  var wc = page.wordCount || 0;
  var schema = page.hasSchema ? 'Schema markup is present.' : 'No schema markup found.';
  if (status === 'orphan') {
    return 'ORPHAN PAGE — No internal links from any other crawled page point to this URL. ' +
      'Google and visitors can only reach it via the XML sitemap or a direct URL. ' +
      'Word count: ' + wc + ' words. ' + schema + ' ' +
      'Orphaned pages receive no link equity from your site and are harder for Google to prioritize.';
  }
  if (status === 'noindex') return 'NOINDEX — A robots meta tag on this page instructs search engines not to index it. It will not appear in Google search results.';
  if (status === 'error') return 'HTTP ERROR — This page returned a ' + (page.status||'4xx/5xx') + ' error. Search engines cannot crawl or index broken pages.';
  if (status === 'redirect') return 'REDIRECT — This URL redirects to another page. If it appears in your navigation or sitemap, update the link to point directly to the destination.';
  return 'This page may have crawlability issues. Review its indexation status in Google Search Console.';
}

function getDefaultRecommendation(status) {
  if (status === 'orphan') return 'Add internal links to this page from relevant service pages, the blog index, the navigation menu, or related blog posts. If this content is outdated or thin, consider consolidating it with a stronger page via a 301 redirect, or unpublishing it entirely to keep your site\'s crawl budget focused on high-value pages.';
  if (status === 'noindex') return 'Verify this noindex tag is intentional. If this page should rank in Google, remove the noindex directive from the page\'s robots meta tag or HTTP header.';
  if (status === 'error') return 'Fix the broken URL or set up a 301 redirect to the most relevant live page. Remove this URL from your XML sitemap and any internal links pointing to it.';
  if (status === 'redirect') return 'Update all internal links and sitemap entries to point directly to the final destination URL to avoid redirect chains.';
  return 'Review this page in Google Search Console to identify any indexation issues.';
}

function exportSitemapPDF() { if(!lastSitemapData){alert("No sitemap data");return;} generatePDF("sitemap",lastSitemapData); }
