var lastBlogData = null;

function runBlogAudit() {
  var url = validUrl(getVal('blogUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var pageLimit = parseInt(getVal('blogPageLimit')) || 500;
  setDisabled(['blogBtn'], true);
  startAndPoll(
    { url: url, type: 'blog', pageLimit: pageLimit },
    'blogOutput',
    [
      'Discovering blog posts...',
      'Crawling /blog/ pages...',
      'Parsing meta tags & schema...',
      'Analyzing content quality...',
      'Checking E-E-A-T signals...',
      'Evaluating GEO & AI readiness...',
      'Scoring all blog posts...',
      'Building recommendations...'
    ],
    function(data) {
      lastBlogData = data;
      saveToFirestore('blog', data.domain || 'unknown', data);
      renderBlogAudit(data);
      setDisabled(['blogBtn'], false);
    },
    function(err) {
      document.getElementById('blogOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['blogBtn'], false);
    }
  );
}

function renderBlogAudit(data, sortBy, sortDir, minScore, filterKey) {
  if (!data) { document.getElementById('blogOutput').innerHTML = '<div class="error-msg">No data returned.</div>'; return; }
  sortBy = sortBy || 'contentQuality';
  sortDir = sortDir || 'desc';
  minScore = minScore || 0;
  filterKey = filterKey || 'all';

  var avg = data.siteAverages || {};
  var avgCards = SCORE_KEYS.map(function(sk) {
    var v = Math.round(avg[sk.key] || 0);
    return '<div class="score-card">' +
      '<div class="score-label">' + sk.label + '</div>' +
      '<div class="score-num" style="color:' + scoreColor(v) + '">' + v + '</div>' +
      '<div class="score-bar"><div class="score-fill" style="width:' + v + '%;background:' + scoreColor(v) + '"></div></div>' +
      '<div class="score-grade ' + scoreClass(v) + '">' + scoreGrade(v) + '</div>' +
      '</div>';
  }).join('');

  var allPages = (data.pages || []).filter(function(p) { return p; });
  var pages = allPages.slice();

  if (filterKey !== 'all') {
    pages = pages.filter(function(p) { return p && p.scores && (p.scores[filterKey] || 0) < 70; });
  }
  pages = pages.filter(function(p) { return p && p.scores && (p.scores.overallSEO || 0) >= minScore; });
  pages.sort(function(a, b) {
    var va = (a && a.scores && a.scores[sortBy]) || 0;
    var vb = (b && b.scores && b.scores[sortBy]) || 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  var sortOpts = '';
  var filterOpts = '<option value="all">All posts</option>';
  SCORE_KEYS.forEach(function(sk) {
    sortOpts += '<option value="' + sk.key + '"' + (sortBy === sk.key ? ' selected' : '') + '>' + sk.label + '</option>';
    filterOpts += '<option value="' + sk.key + '"' + (filterKey === sk.key ? ' selected' : '') + '>Low ' + sk.label + '</option>';
  });

  // Blog-specific stats
  var totalWords = allPages.reduce(function(sum, p) { return sum + (p.wordCount || 0); }, 0);
  var avgWords = allPages.length ? Math.round(totalWords / allPages.length) : 0;
  var orphanCount = allPages.filter(function(p) { return p.isOrphan; }).length;
  var noSchemaCount = allPages.filter(function(p) { return !p.schemaTypes || !p.schemaTypes.length; }).length;
  var thinContent = allPages.filter(function(p) { return (p.wordCount || 0) < 500; }).length;

  document.getElementById('blogOutput').innerHTML =
    '<div class="info-msg">✓ Blog audit complete — ' + allPages.length + ' blog posts analyzed from ' + (data.domain || '') + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportBlogPDF()">↓ EXPORT PDF</button></div>' +

    '<div class="section-title">Blog-Wide Score Summary — ' + (data.domain || '') + '</div>' +
    '<div class="score-grid">' + avgCards + '</div>' +

    '<div class="section-title">Blog Health Stats</div>' +
    '<div class="score-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">' +
      '<div class="score-card"><div class="score-label">Total Posts</div><div class="score-num" style="color:var(--accent2)">' + allPages.length + '</div></div>' +
      '<div class="score-card"><div class="score-label">Avg Word Count</div><div class="score-num" style="color:' + (avgWords >= 800 ? 'var(--green)' : avgWords >= 500 ? 'var(--amber)' : 'var(--red)') + '">' + avgWords + '</div></div>' +
      '<div class="score-card"><div class="score-label">Orphan Posts</div><div class="score-num" style="color:' + (orphanCount > 0 ? 'var(--red)' : 'var(--green)') + '">' + orphanCount + '</div><div style="font-size:.65rem;color:var(--muted);margin-top:.2rem">no inbound links</div></div>' +
      '<div class="score-card"><div class="score-label">Thin Content</div><div class="score-num" style="color:' + (thinContent > 0 ? 'var(--amber)' : 'var(--green)') + '">' + thinContent + '</div><div style="font-size:.65rem;color:var(--muted);margin-top:.2rem">under 500 words</div></div>' +
    '</div>' +

    '<div class="section-title">Post-by-Post Audit</div>' +
    '<div class="filter-bar">' +
      '<span class="filter-label">SORT BY</span>' +
      '<select class="filter-select" onchange="applyBlogFilters()" id="blogSortKey">' + sortOpts + '</select>' +
      '<select class="filter-select" onchange="applyBlogFilters()" id="blogSortDir">' +
        '<option value="desc"' + (sortDir === 'desc' ? ' selected' : '') + '>High → Low</option>' +
        '<option value="asc"' + (sortDir === 'asc' ? ' selected' : '') + '>Low → High</option>' +
      '</select>' +
      '<div class="filter-sep"></div>' +
      '<span class="filter-label">SHOW</span>' +
      '<select class="filter-select" onchange="applyBlogFilters()" id="blogFilterKey">' + filterOpts + '</select>' +
      '<div class="filter-sep"></div>' +
      '<div class="score-range-wrap">' +
        '<span>Min score:</span>' +
        '<input type="range" min="0" max="100" step="5" value="' + minScore + '" id="blogMinScore" ' +
        'oninput="document.getElementById(\'blogMinScoreVal\').textContent=this.value;applyBlogFilters()"/>' +
        '<span id="blogMinScoreVal">' + minScore + '</span>' +
      '</div>' +
      '<div class="filter-sep"></div>' +
      '<span class="page-count-badge">' + pages.length + ' / ' + allPages.length + ' posts</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="resetBlogFilters()">RESET</button>' +
    '</div>' +
    (pages.length ? pages.map(buildBlogPostCard).join('') : '<div class="empty-state">No posts match current filters.</div>');
}

function buildBlogPostCard(page) {
  if (!page) return '';
  var s = page.scores || {};

  var miniScores = SCORE_KEYS.slice(0, 4).map(function(sk) {
    var v = Math.round(s[sk.key] || 0);
    return '<span class="mini-score ' + scoreClass(v) + '" style="border-color:' + scoreColor(v) + ';background:' + scoreColor(v) + '15">' +
      sk.label.split(' ')[0] + ': ' + v + '</span>';
  }).join('');

  var flags = [];
  if (page.isOrphan) flags.push('<span class="flag flag-info">ORPHAN</span>');
  if ((page.wordCount || 0) < 500) flags.push('<span class="flag flag-warn">THIN</span>');
  if (!page.metaDescription) flags.push('<span class="flag flag-warn">NO META DESC</span>');
  if (!page.schemaTypes || !page.schemaTypes.length) flags.push('<span class="flag flag-warn">NO SCHEMA</span>');
  if (page.isNoindex) flags.push('<span class="flag flag-error">NOINDEX</span>');
  var flagsHTML = flags.join('');

  var auditSections = AUDIT_KEYS.map(function(ak) {
    var val = (page.audit && page.audit[ak.key]) || '';
    return '<div class="audit-section">' +
      '<div class="audit-section-title">' + ak.label + '</div>' +
      '<div class="audit-section-body">' + val + '</div>' +
      '</div>';
  }).join('');

  var priorities = (page.audit && page.audit.priorityActions) || [];
  var priorityHTML = '';
  if (priorities.length) {
    priorityHTML = '<div class="priority-box"><div class="priority-box-title">⚡ Priority Actions</div>';
    priorities.forEach(function(a, i) {
      if (!a) return;
      var action = typeof a === 'string' ? a : (a.action || '');
      var impact = typeof a === 'object' ? (a.impact || '') : '';
      priorityHTML += '<div class="priority-item"><span class="priority-num">' + (i + 1) + '.</span>' +
        '<div><div class="priority-text">' + action + '</div>' +
        (impact ? '<span class="priority-impact impact-' + impact.toLowerCase() + '">' + impact + ' IMPACT</span>' : '') +
        '</div></div>';
    });
    priorityHTML += '</div>';
  }

  var schemaFound = (page.schemaTypes || []).map(function(s) { return '<span class="schema-badge">' + s + '</span>'; }).join('');
  var schemaMissing = (page.missingSchema || []).map(function(s) { return '<span class="schema-badge missing">Missing: ' + s + '</span>'; }).join('');
  var schemaSection = (schemaFound || schemaMissing) ?
    '<div class="audit-section" style="grid-column:1/-1">' +
    '<div class="audit-section-title">Schema Found / Missing</div>' +
    '<div class="schema-badges">' + schemaFound + schemaMissing + '</div>' +
    '</div>' : '';

  var pageUrl = page.url || '';
  var safeUrl = pageUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Blog-specific meta row
  var metaRow = '<div style="display:flex;gap:1.25rem;font-family:\'DM Mono\',monospace;font-size:.68rem;color:var(--muted);margin-top:.35rem;flex-wrap:wrap">';
  if (page.wordCount) metaRow += '<span>📝 ' + page.wordCount + ' words</span>';
  if (page.author) metaRow += '<span>✍ ' + page.author + '</span>';
  if (page.publishDate) metaRow += '<span>📅 ' + page.publishDate.split('T')[0] + '</span>';
  if (page.inboundCount !== undefined) metaRow += '<span>🔗 ' + page.inboundCount + ' inbound link' + (page.inboundCount !== 1 ? 's' : '') + '</span>';
  metaRow += '</div>';

  return '<div class="page-card">' +
    '<div class="page-card-header" onclick="toggleCard(this)">' +
      '<div class="page-meta">' +
        '<div style="display:flex;align-items:center;gap:.5rem">' +
          '<div class="page-url">' + pageUrl + '</div>' +
          '<button onclick="event.stopPropagation();openUrl(\'' + safeUrl + '\')" class="btn btn-ghost btn-sm" style="padding:.1rem .35rem;font-size:.65rem;flex-shrink:0">↗</button>' +
        '</div>' +
        '<div class="page-title-sub">' + (page.pageTitle || '(no title)') + '</div>' +
        metaRow +
        '<div class="page-flags" style="margin-top:.25rem">' + flagsHTML + '</div>' +
      '</div>' +
      '<div class="page-scores-mini">' + miniScores + '</div>' +
      '<span class="arrow-icon">▸</span>' +
    '</div>' +
    '<div class="page-card-body">' +
      '<div class="audit-grid">' + auditSections + schemaSection + '</div>' +
      priorityHTML +
    '</div>' +
  '</div>';
}

function applyBlogFilters() {
  if (!lastBlogData) return;
  renderBlogAudit(
    lastBlogData,
    document.getElementById('blogSortKey') && document.getElementById('blogSortKey').value,
    document.getElementById('blogSortDir') && document.getElementById('blogSortDir').value,
    document.getElementById('blogMinScore') && parseInt(document.getElementById('blogMinScore').value),
    document.getElementById('blogFilterKey') && document.getElementById('blogFilterKey').value
  );
}

function resetBlogFilters() {
  if (lastBlogData) renderBlogAudit(lastBlogData);
}

function exportBlogPDF() {
  if (!lastBlogData) { alert('No blog audit data to export. Run a blog audit first.'); return; }
  generatePDF('audit', lastBlogData); // reuses the audit PDF format
}
