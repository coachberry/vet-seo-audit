// VetSEO Auditor - app.js (polling version)

var lastAuditData = null;
var lastSitemapData = null;
var lastCompareData = null;

var SCORE_KEYS = [
  { key: 'overallSEO', label: 'Overall SEO' },
  { key: 'localSEO', label: 'Local SEO' },
  { key: 'schemaStructuredData', label: 'Schema / Structured Data' },
  { key: 'geoAIReadiness', label: 'GEO & AI Readiness' },
  { key: 'contentQuality', label: 'Content Quality' },
  { key: 'technicalSEO', label: 'Technical SEO' },
  { key: 'eeAt', label: 'E-E-A-T' }
];

var AUDIT_KEYS = [
  { key: 'urlStructure', label: 'URL & Structure' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'openGraph', label: 'Open Graph' },
  { key: 'schema', label: 'Schema / Structured Data' },
  { key: 'faqSchema', label: 'FAQ Schema' },
  { key: 'localSEO', label: 'Local SEO & NAP' },
  { key: 'contentEEAT', label: 'Content & E-E-A-T' },
  { key: 'geoAI', label: 'GEO & AI Readiness' },
  { key: 'technicalSEO', label: 'Technical SEO' },
  { key: 'internalLinking', label: 'Internal Linking' }
];

function showView(name) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('view' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
  document.getElementById('nav' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
  if (name === 'history') loadHistory();
}

function scoreColor(n) {
  if (n >= 80) return 'var(--green)';
  if (n >= 55) return 'var(--amber)';
  return 'var(--red)';
}
function scoreClass(n) { return n >= 80 ? 'green' : n >= 55 ? 'amber' : 'red'; }
function scoreGrade(n) {
  if (n >= 90) return 'A+'; if (n >= 80) return 'A';
  if (n >= 70) return 'B'; if (n >= 60) return 'C';
  if (n >= 50) return 'D'; return 'F';
}
function setDisabled(ids, d) {
  ids.forEach(function(id) { var el = document.getElementById(id); if (el) el.disabled = d; });
}
function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function validUrl(v) { try { new URL(v); return v; } catch(e) { return null; } }
function toggleCard(header) {
  var body = header.nextElementSibling;
  if (!body) return;
  body.classList.toggle('open');
  header.classList.toggle('expanded');
}

function showLoading(outputId, label, steps) {
  var si = 0;
  document.getElementById(outputId).innerHTML =
    '<div class="loader-wrap">' +
    '<div class="loader-spinner"></div>' +
    '<div class="loader-label">' + label + '</div>' +
    '<div class="loader-step" id="loadStep">' + steps[0] + '</div>' +
    '<div class="loader-progress"><div class="loader-progress-fill" id="loadProgress" style="width:5%"></div></div>' +
    '</div>';
  var iv = setInterval(function() {
    si = (si + 1) % steps.length;
    var el = document.getElementById('loadStep');
    var prog = document.getElementById('loadProgress');
    if (el) el.textContent = steps[si];
    if (prog) prog.style.width = Math.min(90, 5 + (si / steps.length) * 85) + '%';
    else clearInterval(iv);
  }, 3000);
  return iv;
}

// Start a job then poll until complete
async function startAndPoll(payload, outputId, steps, onComplete, onError) {
  var iv = showLoading(outputId, 'PROCESSING', steps);
  try {
    // Start job
    var startRes = await fetch(FUNCTIONS_BASE_URL + '/startAudit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!startRes.ok) throw new Error('Failed to start job');
    var startData = await startRes.json();
    var jobId = startData.jobId;

    // Poll every 5 seconds
    var pollCount = 0;
    var maxPolls = 120; // 10 minutes max
    var pollInterval = setInterval(async function() {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(pollInterval);
        clearInterval(iv);
        onError('Job timed out after 10 minutes');
        return;
      }
      try {
        var pollRes = await fetch(FUNCTIONS_BASE_URL + '/getJob?jobId=' + jobId);
        var job = await pollRes.json();
        if (job.status === 'complete') {
          clearInterval(pollInterval);
          clearInterval(iv);
          onComplete(job.result);
        } else if (job.status === 'error') {
          clearInterval(pollInterval);
          clearInterval(iv);
          onError(job.error || 'Job failed');
        }
        // still running - keep polling
      } catch(e) {
        // network hiccup - keep polling
      }
    }, 5000);
  } catch(e) {
    clearInterval(iv);
    onError(e.message);
  }
}

async function saveToFirestore(type, domain, data) {
  try {
    await db.collection('audits').add({
      type: type, domain: domain,
      createdAt: new Date().toISOString(), data: data
    });
  } catch(e) { console.warn('Firestore save failed:', e.message); }
}

async function loadHistory() {
  var out = document.getElementById('historyOutput');
  try {
    var snap = await db.collection('audits').orderBy('createdAt', 'desc').limit(50).get();
    if (snap.empty) { out.innerHTML = '<div class="empty-state">No audit history yet.</div>'; return; }
    var cards = '';
    snap.forEach(function(d) {
      var item = d.data();
      var date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      cards += '<div class="history-card" onclick="loadHistoryItem(\'' + d.id + '\',\'' + item.type + '\')">' +
        '<div class="history-domain">' + item.domain + '</div>' +
        '<span class="history-type">' + item.type + '</span>' +
        '<div class="history-date">' + date + '</div>' +
        '<span style="color:var(--muted)">→</span></div>';
    });
    out.innerHTML = '<div class="section-title">Recent Audits</div>' + cards;
  } catch(e) { out.innerHTML = '<div class="error-msg">Could not load history: ' + e.message + '</div>'; }
}

async function loadHistoryItem(id, type) {
  try {
    var snap = await db.collection('audits').doc(id).get();
    if (!snap.exists) return;
    var item = snap.data();
    if (type === 'audit') { lastAuditData = item.data; showView('audit'); renderAudit(item.data); }
    else if (type === 'sitemap') { lastSitemapData = item.data; showView('sitemap'); renderSitemap(item.data); }
    else if (type === 'compare') { lastCompareData = item.data; showView('compare'); renderCompare(item.data); }
  } catch(e) { alert('Could not load: ' + e.message); }
}

function runAudit() {
  var url = validUrl(getVal('auditUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var pageLimit = parseInt(getVal('pageLimit')) || 50;
  var crawlSubpages = document.getElementById('crawlSubpages').checked;
  setDisabled(['auditBtn'], true);
  startAndPoll(
    { url: url, pageLimit: pageLimit, crawlSubpages: crawlSubpages, type: 'audit' },
    'auditOutput',
    ['Fetching homepage HTML...','Discovering all pages...','Crawling internal links...','Parsing meta tags & schema...','Analyzing Open Graph data...','Checking structured data...','Evaluating content & E-E-A-T...','Scoring GEO & AI readiness...','Building recommendations...','Generating full report...'],
    function(data) {
      lastAuditData = data;
      saveToFirestore('audit', data.domain, data);
      renderAudit(data);
      setDisabled(['auditBtn'], false);
    },
    function(err) {
      document.getElementById('auditOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['auditBtn'], false);
    }
  );
}

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

function runCompare() {
  var u1 = validUrl(getVal('compare1Url'));
  var u2 = validUrl(getVal('compare2Url'));
  if (!u1 || !u2) { alert('Please enter two valid URLs'); return; }
  setDisabled(['compareBtn'], true);
  startAndPoll(
    { url: u1, url1: u1, url2: u2, type: 'compare' },
    'compareOutput',
    ['Crawling site 1...','Crawling site 2...','Scoring both sites...','Building comparison...'],
    function(data) {
      lastCompareData = data;
      saveToFirestore('compare', (data.site1&&data.site1.domain||'') + ' vs ' + (data.site2&&data.site2.domain||''), data);
      renderCompare(data);
      setDisabled(['compareBtn'], false);
    },
    function(err) {
      document.getElementById('compareOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['compareBtn'], false);
    }
  );
}

function renderAudit(data, sortBy, sortDir, minScore, filterKey) {
  sortBy = sortBy || 'overallSEO'; sortDir = sortDir || 'desc';
  minScore = minScore || 0; filterKey = filterKey || 'all';
  var avg = data.siteAverages || {};
  var avgCards = '';
  SCORE_KEYS.forEach(function(sk) {
    var v = Math.round(avg[sk.key] || 0);
    avgCards += '<div class="score-card"><div class="score-label">' + sk.label + '</div>' +
      '<div class="score-num" style="color:' + scoreColor(v) + '">' + v + '</div>' +
      '<div class="score-bar"><div class="score-fill" style="width:' + v + '%;background:' + scoreColor(v) + '"></div></div>' +
      '<div class="score-grade ' + scoreClass(v) + '">' + scoreGrade(v) + '</div></div>';
  });
  var pages = (data.pages || []).slice();
  if (filterKey !== 'all') pages = pages.filter(function(p) { return (p.scores&&p.scores[filterKey]||0) < 70; });
  pages = pages.filter(function(p) { return (p.scores&&p.scores.overallSEO||0) >= minScore; });
  if (sortDir === 'desc') pages.sort(function(a,b) { return (b.scores&&b.scores[sortBy]||0)-(a.scores&&a.scores[sortBy]||0); });
  else pages.sort(function(a,b) { return (a.scores&&a.scores[sortBy]||0)-(b.scores&&b.scores[sortBy]||0); });
  var sortOpts = '', filterOpts = '<option value="all">All pages</option>';
  SCORE_KEYS.forEach(function(sk) {
    sortOpts += '<option value="' + sk.key + '"' + (sortBy===sk.key?' selected':'') + '>' + sk.label + '</option>';
    filterOpts += '<option value="' + sk.key + '"' + (filterKey===sk.key?' selected':'') + '>Low ' + sk.label + '</option>';
  });
  var pageCards = pages.map(function(p) { return buildPageCard(p); }).join('');
  document.getElementById('auditOutput').innerHTML =
    '<div class="info-msg">✓ Real crawl complete — ' + (data.totalPagesCrawled||0) + ' pages analyzed from ' + data.domain + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportAuditPDF()">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Site-Wide Score Summary — ' + data.domain + '</div>' +
    '<div class="score-grid">' + avgCards + '</div>' +
    '<div class="section-title">Page-by-Page Audit</div>' +
    '<div class="filter-bar">' +
      '<span class="filter-label">SORT BY</span>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="sortKey">' + sortOpts + '</select>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="sortDir">' +
        '<option value="desc"' + (sortDir==='desc'?' selected':'') + '>High → Low</option>' +
        '<option value="asc"' + (sortDir==='asc'?' selected':'') + '>Low → High</option>' +
      '</select><div class="filter-sep"></div>' +
      '<span class="filter-label">SHOW</span>' +
      '<select class="filter-select" onchange="applyAuditFilters()" id="filterKey">' + filterOpts + '</select>' +
      '<div class="filter-sep"></div>' +
      '<div class="score-range-wrap"><span>Min score:</span>' +
        '<input type="range" min="0" max="100" step="5" value="' + minScore + '" id="minScore" oninput="document.getElementById(\'minScoreVal\').textContent=this.value;applyAuditFilters()"/>' +
        '<span id="minScoreVal">' + minScore + '</span></div>' +
      '<div class="filter-sep"></div>' +
      '<span class="page-count-badge">' + pages.length + ' / ' + (data.pages&&data.pages.length||0) + ' pages</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="resetAuditFilters()">RESET</button>' +
    '</div>' +
    (pageCards || '<div class="empty-state">No pages match current filters.</div>');
}

function buildPageCard(page) {
  var s = page.scores || {};
  var miniScores = '';
  SCORE_KEYS.slice(0,4).forEach(function(sk) {
    var v = Math.round(s[sk.key]||0);
    miniScores += '<span class="mini-score ' + scoreClass(v) + '" style="border-color:' + scoreColor(v) + ';background:' + scoreColor(v) + '15">' + sk.label.split(' ')[0] + ': ' + v + '</span>';
  });
  var flags = (page.flags||[]).map(function(f) { return '<span class="flag flag-' + f.type + '">' + f.label + '</span>'; }).join('');
  var schemaFound = (page.schemaTypes||[]).map(function(s) { return '<span class="schema-badge">' + s + '</span>'; }).join('');
  var schemaMissing = (page.missingSchema||[]).map(function(s) { return '<span class="schema-badge missing">Missing: ' + s + '</span>'; }).join('');
  var auditSections = AUDIT_KEYS.map(function(ak) {
    return '<div class="audit-section"><div class="audit-section-title">' + ak.label + '</div><div class="audit-section-body">' + (page.audit&&page.audit[ak.key]||'') + '</div></div>';
  }).join('');
  var priorities = (page.audit&&page.audit.priorityActions)||[];
  var priorityHTML = '';
  if (priorities.length) {
    priorityHTML = '<div class="priority-box"><div class="priority-box-title">⚡ Priority Actions</div>';
    priorities.forEach(function(a,i) {
      priorityHTML += '<div class="priority-item"><span class="priority-num">' + (i+1) + '.</span><div><div class="priority-text">' + (a.action||a) + '</div>' + (a.impact?'<span class="priority-impact impact-' + a.impact.toLowerCase() + '">' + a.impact + ' IMPACT</span>':'') + '</div></div>';
    });
    priorityHTML += '</div>';
  }
  var schemaSection = (schemaFound||schemaMissing) ? '<div class="audit-section" style="grid-column:1/-1"><div class="audit-section-title">Schema Found / Missing</div><div class="schema-badges">' + schemaFound + schemaMissing + '</div></div>' : '';
  return '<div class="page-card"><div class="page-card-header" onclick="toggleCard(this)">' +
    '<div class="page-meta"><div class="page-url">' + page.url + '</div><div class="page-title-sub">' + (page.pageTitle||'(no title)') + '</div><div class="page-flags">' + flags + '</div></div>' +
    '<div class="page-scores-mini">' + miniScores + '</div><span class="arrow-icon">▸</span></div>' +
    '<div class="page-card-body"><div class="audit-grid">' + auditSections + schemaSection + '</div>' + priorityHTML + '</div></div>';
}

function applyAuditFilters() {
  if (!lastAuditData) return;
  renderAudit(lastAuditData,
    document.getElementById('sortKey')?document.getElementById('sortKey').value:'overallSEO',
    document.getElementById('sortDir')?document.getElementById('sortDir').value:'desc',
    document.getElementById('minScore')?parseInt(document.getElementById('minScore').value):0,
    document.getElementById('filterKey')?document.getElementById('filterKey').value:'all');
}
function resetAuditFilters() { if (lastAuditData) renderAudit(lastAuditData); }

function renderSitemap(data) {
  var cs = Math.round(data.crawlability&&data.crawlability.score||0);
  var pagesWithIssues = (data.pages||[]).filter(function(p) { return p.status !== 'ok'; });
  function renderTree(nodes, depth) {
    depth = depth || 0;
    if (!nodes||!nodes.length) return '';
    var html = '';
    nodes.forEach(function(n) {
      var statusCls = 'status-' + (n.status||'ok');
      var statusLabel = {ok:'OK',noindex:'NOINDEX',orphan:'ORPHAN',redirect:'REDIRECT',error:'ERROR'}[n.status||'ok']||(n.status||'').toUpperCase();
      html += '<div class="sitemap-node" style="padding-left:' + (depth*14) + 'px">' +
        '<a class="node-url" href="' + n.url + '" target="_blank" rel="noopener">' + (n.label||n.url) + '</a>' +
        '<span class="node-status ' + statusCls + '">' + statusLabel + '</span>' +
        (n.type?'<span class="node-type flag flag-info">' + n.type + '</span>':'') + '</div>';
      if (n.children&&n.children.length) html += renderTree(n.children, depth+1);
    });
    return html;
  }
  var issueCards = '';
  if (pagesWithIssues.length) {
    issueCards = '<div class="section-title">Pages Requiring Attention (' + pagesWithIssues.length + ')</div>';
    pagesWithIssues.forEach(function(p) {
      issueCards += '<div class="page-card"><div class="page-card-header" onclick="toggleCard(this)">' +
        '<div class="page-meta"><div class="page-url">' + p.url + '</div><div class="page-title-sub">' + (p.pageTitle||'') + '</div></div>' +
        '<span class="flag flag-' + (p.status==='noindex'?'warn':p.status==='error'?'error':'info') + '">' + (p.status||'').toUpperCase() + '</span>' +
        '<span class="arrow-icon">▸</span></div>' +
        '<div class="page-card-body"><div class="prose"><p>' + (p.issue||'Review this page.') + '</p></div>' +
        (p.recommendation?'<div class="priority-box"><div class="priority-box-title">Recommendation</div><div class="prose"><p>' + p.recommendation + '</p></div></div>':'') +
        '</div></div>';
    });
  }
  document.getElementById('sitemapOutput').innerHTML =
    '<div class="info-msg">✓ Real crawl complete — ' + (data.totalPages||0) + ' pages discovered on ' + data.domain + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportSitemapPDF()">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Sitemap Overview — ' + data.domain + '</div>' +
    '<div class="score-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="score-card"><div class="score-label">Total Pages</div><div class="score-num" style="color:var(--accent2)">' + (data.totalPages||0) + '</div></div>' +
      '<div class="score-card"><div class="score-label">Crawl Depth</div><div class="score-num" style="color:var(--blue)">' + (data.maxDepth||0) + '</div></div>' +
      '<div class="score-card"><div class="score-label">Crawlability</div><div class="score-num" style="color:' + scoreColor(cs) + '">' + cs + '</div><div class="score-bar"><div class="score-fill" style="width:' + cs + '%;background:' + scoreColor(cs) + '"></div></div></div>' +
      '<div class="score-card"><div class="score-label">Issues Found</div><div class="score-num" style="color:' + (pagesWithIssues.length>0?'var(--red)':'var(--green)') + '">' + pagesWithIssues.length + '</div></div>' +
    '</div>' +
    '<div class="page-card" style="margin-bottom:.75rem"><div class="page-card-header expanded" onclick="toggleCard(this)">' +
      '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🗺 FULL SITEMAP TREE</span>' +
      '<span class="arrow-icon" style="margin-left:auto">▾</span></div>' +
      '<div class="page-card-body open"><div class="sitemap-wrapper"><div class="sitemap-tree">' + renderTree(data.sitemapTree||[]) + '</div></div></div></div>' +
    issueCards +
    '<div class="page-card" style="margin-bottom:.75rem"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ STRENGTHS</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2.1">' + (data.urlAnalysis&&data.urlAnalysis.strengths||[]).map(function(s){return '<li class="green">'+s+'</li>';}).join('') + '</ul></div></div>' +
    '<div class="page-card" style="margin-bottom:.75rem"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--red)">⚠ ISSUES</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2.1">' + (data.urlAnalysis&&data.urlAnalysis.issues||[]).map(function(s){return '<li class="red">'+s+'</li>';}).join('') + '</ul></div></div>' +
    '<div class="page-card"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--blue)">📊 FULL ANALYSIS</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><div class="prose">' + (data.overallReport||'').split('\n\n').map(function(p){return '<p>'+p+'</p>';}).join('') + '</div></div></div>';
}

function renderCompare(data) {
  var s1=data.site1||{}, s2=data.site2||{}, cmp=data.comparison||{};
  var w = cmp.overallWinner;
  var scoreRows = '';
  SCORE_KEYS.forEach(function(sk) {
    var v1=Math.round(s1.siteAverages&&s1.siteAverages[sk.key]||0);
    var v2=Math.round(s2.siteAverages&&s2.siteAverages[sk.key]||0);
    var winner=cmp.categoryWinners&&cmp.categoryWinners[sk.key];
    scoreRows += '<div class="cst-row"><span class="cst-key">' + sk.label + '</span>' +
      '<span class="cst-val" style="color:' + scoreColor(v1) + '">' + v1 + (winner==='site1'?'<span class="winner-badge">WINNER</span>':'') + '</span>' +
      '<span class="cst-val" style="color:' + scoreColor(v2) + '">' + v2 + (winner==='site2'?'<span class="winner-badge">WINNER</span>':'') + '</span></div>';
  });
  var s1Pages=(s1.pages||[]).map(function(p){return buildPageCard(p);}).join('');
  var s2Pages=(s2.pages||[]).map(function(p){return buildPageCard(p);}).join('');
  document.getElementById('compareOutput').innerHTML =
    '<div class="top-actions"><button class="btn btn-export" onclick="exportComparePDF()">↓ EXPORT PDF</button></div>' +
    '<div class="compare-header-grid"><div class="compare-col-label">' + (s1.domain||'Site 1') + (w==='site1'?' 🏆':'') + '</div><div class="compare-vs">VS</div><div class="compare-col-label">' + (s2.domain||'Site 2') + (w==='site2'?' 🏆':'') + '</div></div>' +
    '<div class="compare-score-table"><div class="cst-header"><span>Category</span><span>' + (s1.domain||'Site 1') + '</span><span>' + (s2.domain||'Site 2') + '</span></div>' + scoreRows + '</div>' +
    '<div class="audit-grid" style="margin-bottom:1.5rem">' +
      '<div class="page-card" style="margin:0"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ ' + (s1.domain||'Site 1') + ' Advantages</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' + (cmp.site1Advantages||[]).map(function(a){return '<li class="green">'+a+'</li>';}).join('') + '</ul></div></div>' +
      '<div class="page-card" style="margin:0"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--blue)">✦ ' + (s2.domain||'Site 2') + ' Advantages</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' + (cmp.site2Advantages||[]).map(function(a){return '<li class="blue">'+a+'</li>';}).join('') + '</ul></div></div>' +
    '</div>' +
    '<div class="page-card" style="margin-bottom:.75rem"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">📊 Competitive Analysis</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><div class="prose">' + (cmp.summary||'').split('\n\n').map(function(p){return '<p>'+p+'</p>';}).join('') + '</div></div></div>' +
    '<div class="page-card" style="margin-bottom:1.75rem"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🔧 Recommendations</span><span class="arrow-icon" style="margin-left:auto">▾</span></div><div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' + (cmp.recommendations||[]).map(function(r){return '<li style="color:var(--text)">'+r+'</li>';}).join('') + '</ul></div></div>' +
    '<div class="audit-grid" style="align-items:start"><div><div class="section-title" style="font-size:1rem">' + (s1.domain||'Site 1') + '</div>' + s1Pages + '</div><div><div class="section-title" style="font-size:1rem">' + (s2.domain||'Site 2') + '</div>' + s2Pages + '</div></div>';
}

function exportAuditPDF() { alert('PDF export — coming soon!'); }
function exportSitemapPDF() { alert('PDF export — coming soon!'); }
function exportComparePDF() { alert('PDF export — coming soon!'); }
