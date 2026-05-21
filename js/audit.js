var lastAuditData = null;

function runAudit() {
  var url = validUrl(getVal('auditUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var pageLimit = parseInt(getVal('pageLimit')) || 100;
  var crawlSubpages = document.getElementById('crawlSubpages').checked;
  setDisabled(['auditBtn'], true);
  startAndPoll(
    { url: url, pageLimit: pageLimit, crawlSubpages: crawlSubpages, type: 'audit' },
    'auditOutput',
    ['Fetching homepage HTML...','Discovering all pages...','Crawling internal links...','Parsing meta tags & schema...','Analyzing Open Graph data...','Checking structured data...','Evaluating content & E-E-A-T...','Scoring GEO & AI readiness...','Building recommendations...','Generating full report...'],
    function(data) {
      lastAuditData = data;
      saveToFirestore('audit', data.domain || 'unknown', data);
      renderAudit(data);
      setDisabled(['auditBtn'], false);
    },
    function(err) {
      document.getElementById('auditOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['auditBtn'], false);
    }
  );
}

function renderAudit(data, sortBy, sortDir, minScore, filterKey) {
  if (!data) { document.getElementById('auditOutput').innerHTML = '<div class="error-msg">No audit data returned.</div>'; return; }
  sortBy = sortBy || 'overallSEO';
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

  var allPages = data.pages || [];
  var pages = allPages.slice();

  if (filterKey !== 'all') {
    pages = pages.filter(function(p) {
      return p && p.scores && (p.scores[filterKey] || 0) < 70;
    });
  }
  pages = pages.filter(function(p) {
    return p && p.scores && (p.scores.overallSEO || 0) >= minScore;
  });
  pages.sort(function(a, b) {
    var va = (a && a.scores && a.scores[sortBy]) || 0;
    var vb = (b && b.scores && b.scores[sortBy]) || 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  var sortOpts = '';
  var filterOpts = '<option value="all">All pages</option>';
  SCORE_KEYS.forEach(function(sk) {
    sortOpts += '<option value="' + sk.key + '"' + (sortBy === sk.key ? ' selected' : '') + '>' + sk.label + '</option>';
    filterOpts += '<option value="' + sk.key + '"' + (filterKey === sk.key ? ' selected' : '') + '>Low ' + sk.label + '</option>';
  });

  document.getElementById('auditOutput').innerHTML =
    '<div class="info-msg">✓ Real crawl complete — ' + (data.totalPagesCrawled || allPages.length || 0) + ' pages analyzed from ' + (data.domain || '') + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportAuditPDF()">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Site-Wide Score Summary — ' + (data.domain || '') + '</div>' +
    '<div class="score-grid">' + avgCards + '</div>' +
    '<div class="section-title">Page-by-Page Audit</div>' +
    '<div class="filter-bar">' +
      '<span class="filter-label">SORT BY</span>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="sortKey">' + sortOpts + '</select>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="sortDir">' +
        '<option value="desc"' + (sortDir === 'desc' ? ' selected' : '') + '>High → Low</option>' +
        '<option value="asc"' + (sortDir === 'asc' ? ' selected' : '') + '>Low → High</option>' +
      '</select>' +
      '<div class="filter-sep"></div>' +
      '<span class="filter-label">SHOW</span>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="filterKey">' + filterOpts + '</select>' +
      '<div class="filter-sep"></div>' +
      '<div class="score-range-wrap">' +
        '<span>Min score:</span>' +
        '<input type="range" min="0" max="100" step="5" value="' + minScore + '" id="minScore" oninput="document.getElementById(\'minScoreVal\').textContent=this.value;applyAuditFilters()"/>' +
        '<span id="minScoreVal">' + minScore + '</span>' +
      '</div>' +
      '<div class="filter-sep"></div>' +
      '<span class="page-count-badge">' + pages.length + ' / ' + allPages.length + ' pages</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="resetAuditFilters()">RESET</button>' +
    '</div>' +
    (pages.length ? pages.map(buildPageCard).join('') : '<div class="empty-state">No pages match current filters.</div>');
}

function buildPageCard(page) {
  if (!page) return '';
  var s = page.scores || {};
  var miniScores = SCORE_KEYS.slice(0, 4).map(function(sk) {
    var v = Math.round(s[sk.key] || 0);
    return '<span class="mini-score ' + scoreClass(v) + '" style="border-color:' + scoreColor(v) + ';background:' + scoreColor(v) + '15">' +
      sk.label.split(' ')[0] + ': ' + v + '</span>';
  }).join('');

  var flags = (page.flags || []).map(function(f) {
    if (!f) return '';
    return '<span class="flag flag-' + (f.type || 'info') + '">' + (f.label || '') + '</span>';
  }).join('');

  var schemaFound = (page.schemaTypes || []).map(function(s) {
    return '<span class="schema-badge">' + s + '</span>';
  }).join('');

  var schemaMissing = (page.missingSchema || []).map(function(s) {
    return '<span class="schema-badge missing">Missing: ' + s + '</span>';
  }).join('');

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
      priorityHTML += '<div class="priority-item">' +
        '<span class="priority-num">' + (i + 1) + '.</span>' +
        '<div><div class="priority-text">' + action + '</div>' +
        (impact ? '<span class="priority-impact impact-' + impact.toLowerCase() + '">' + impact + ' IMPACT</span>' : '') +
        '</div></div>';
    });
    priorityHTML += '</div>';
  }

  var schemaSection = (schemaFound || schemaMissing) ?
    '<div class="audit-section" style="grid-column:1/-1">' +
    '<div class="audit-section-title">Schema Found / Missing</div>' +
    '<div class="schema-badges">' + schemaFound + schemaMissing + '</div>' +
    '</div>' : '';

  var pageUrl = page.url || '';
  var safeUrl = pageUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return '<div class="page-card">' +
    '<div class="page-card-header" onclick="toggleCard(this)">' +
      '<div class="page-meta">' +
        '<div style="display:flex;align-items:center;gap:.5rem">' +
          '<div class="page-url">' + pageUrl + '</div>' +
          '<button onclick="event.stopPropagation();openUrl(\'' + safeUrl + '\')" class="btn btn-ghost btn-sm" style="padding:.1rem .35rem;font-size:.65rem;flex-shrink:0">↗</button>' +
        '</div>' +
        '<div class="page-title-sub">' + (page.pageTitle || '(no title)') + '</div>' +
        '<div class="page-flags">' + flags + '</div>' +
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

function applyAuditFilters() {
  if (!lastAuditData) return;
  var sortKey = document.getElementById('sortKey');
  var sortDir = document.getElementById('sortDir');
  var minScore = document.getElementById('minScore');
  var filterKey = document.getElementById('filterKey');
  renderAudit(
    lastAuditData,
    sortKey ? sortKey.value : 'overallSEO',
    sortDir ? sortDir.value : 'desc',
    minScore ? parseInt(minScore.value) : 0,
    filterKey ? filterKey.value : 'all'
  );
}

function resetAuditFilters() {
  if (lastAuditData) renderAudit(lastAuditData);
}

function exportAuditPDF() {
  if (!lastAuditData) { alert('No audit data to export'); return; }
  generatePDF('audit', lastAuditData);
}
