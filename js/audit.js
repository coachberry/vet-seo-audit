var lastAuditData = null;
var lastServicesData = null;
var lastSitepagesData = null;

// ── Services Audit ─────────────────────────────
function runServices() {
  var url = validUrl(getVal('servicesUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var limit = parseInt(getVal('servicesLimit')) || 50;
  setDisabled(['servicesBtn'], true);
  startAndPoll(
    { url: url, type: 'services', pageLimit: limit },
    'servicesOutput',
    ['Discovering /services/ pages...','Crawling service pages...','Parsing meta & schema...','Analyzing content quality...','Scoring E-E-A-T signals...','Building recommendations...'],
    function(data) {
      lastServicesData = data;
      saveToFirestore('services', data.domain || 'unknown', data);
      renderAuditResult('servicesOutput', data, 'services');
      setDisabled(['servicesBtn'], false);
    },
    function(err) {
      document.getElementById('servicesOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['servicesBtn'], false);
    }
  );
}

// ── Site Pages Audit ───────────────────────────
function runSitepages() {
  var url = validUrl(getVal('sitepagesUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  var limit = parseInt(getVal('sitepagesLimit')) || 25;
  setDisabled(['sitepagesBtn'], true);
  startAndPoll(
    { url: url, type: 'sitepages', pageLimit: limit },
    'sitepagesOutput',
    ['Discovering core pages...','Crawling homepage, about, contact...','Parsing meta & schema...','Analyzing content & E-E-A-T...','Scoring local SEO signals...','Building recommendations...'],
    function(data) {
      lastSitepagesData = data;
      saveToFirestore('sitepages', data.domain || 'unknown', data);
      renderAuditResult('sitepagesOutput', data, 'sitepages');
      setDisabled(['sitepagesBtn'], false);
    },
    function(err) {
      document.getElementById('sitepagesOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['sitepagesBtn'], false);
    }
  );
}

// ── Shared render for services and sitepages ───
function renderAuditResult(outputId, data, type, sortBy, sortDir, minScore, filterKey) {
  if (!data) { document.getElementById(outputId).innerHTML = '<div class="error-msg">No data returned.</div>'; return; }
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

  var allPages = (data.pages || []).filter(function(p) { return p; });
  var pages = allPages.slice();
  if (filterKey !== 'all') pages = pages.filter(function(p) { return p && p.scores && (p.scores[filterKey]||0) < 70; });
  pages = pages.filter(function(p) { return p && p.scores && (p.scores.overallSEO||0) >= minScore; });
  pages.sort(function(a,b) {
    var va=(a&&a.scores&&a.scores[sortBy])||0, vb=(b&&b.scores&&b.scores[sortBy])||0;
    return sortDir==='desc' ? vb-va : va-vb;
  });

  var sortOpts='', filterOpts='<option value="all">All pages</option>';
  SCORE_KEYS.forEach(function(sk) {
    sortOpts += '<option value="'+sk.key+'"'+(sortBy===sk.key?' selected':'')+'>'+sk.label+'</option>';
    filterOpts += '<option value="'+sk.key+'"'+(filterKey===sk.key?' selected':'')+'>Low '+sk.label+'</option>';
  });

  var typeLabel = type === 'services' ? 'service pages' : 'core site pages';
  var exportFn = type === 'services' ? 'exportServicesPDF()' : 'exportSitepagesPDF()';
  var filterId = type + '_';

  document.getElementById(outputId).innerHTML =
    '<div class="info-msg">✓ Audit complete — ' + (data.totalPagesCrawled||allPages.length||0) + ' ' + typeLabel + ' analyzed from ' + (data.domain||'') + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="' + exportFn + '">↓ EXPORT PDF</button></div>' +
    '<div class="section-title">Score Summary — ' + (data.domain||'') + '</div>' +
    '<div class="score-grid">' + avgCards + '</div>' +
    '<div class="section-title">Page-by-Page Audit</div>' +
    '<div class="filter-bar">' +
      '<span class="filter-label">SORT BY</span>' +
      '<select class="filter-select" onchange="applyFilter(\'' + outputId + '\',\'' + type + '\')" id="' + filterId + 'sortKey">' + sortOpts + '</select>' +
      '<select class="filter-select" onchange="applyFilter(\'' + outputId + '\',\'' + type + '\')" id="' + filterId + 'sortDir">' +
        '<option value="desc"'+(sortDir==='desc'?' selected':'')+'>High → Low</option>' +
        '<option value="asc"'+(sortDir==='asc'?' selected':'')+'>Low → High</option>' +
      '</select><div class="filter-sep"></div>' +
      '<span class="filter-label">SHOW</span>' +
      '<select class="filter-select" onchange="applyFilter(\'' + outputId + '\',\'' + type + '\')" id="' + filterId + 'filterKey">' + filterOpts + '</select>' +
      '<div class="filter-sep"></div>' +
      '<div class="score-range-wrap"><span>Min score:</span>' +
        '<input type="range" min="0" max="100" step="5" value="'+minScore+'" id="'+filterId+'minScore" ' +
        'oninput="document.getElementById(\''+filterId+'minScoreVal\').textContent=this.value;applyFilter(\''+outputId+'\',\''+type+'\')"/>' +
        '<span id="'+filterId+'minScoreVal">'+minScore+'</span></div>' +
      '<div class="filter-sep"></div>' +
      '<span class="page-count-badge">'+pages.length+' / '+allPages.length+' pages</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="resetFilter(\''+outputId+'\',\''+type+'\')">RESET</button>' +
    '</div>' +
    (pages.length ? pages.map(buildPageCard).join('') : '<div class="empty-state">No pages match current filters.</div>');
}

function applyFilter(outputId, type) {
  var p = type + '_';
  var data = type === 'services' ? lastServicesData : lastSitepagesData;
  if (!data) return;
  renderAuditResult(outputId, data, type,
    document.getElementById(p+'sortKey')&&document.getElementById(p+'sortKey').value,
    document.getElementById(p+'sortDir')&&document.getElementById(p+'sortDir').value,
    document.getElementById(p+'minScore')&&parseInt(document.getElementById(p+'minScore').value),
    document.getElementById(p+'filterKey')&&document.getElementById(p+'filterKey').value
  );
}

function resetFilter(outputId, type) {
  var data = type === 'services' ? lastServicesData : lastSitepagesData;
  if (data) renderAuditResult(outputId, data, type);
}

function buildPageCard(page) {
  if (!page) return '';
  var s = page.scores || {};
  var miniScores = SCORE_KEYS.slice(0,4).map(function(sk) {
    var v = Math.round(s[sk.key]||0);
    return '<span class="mini-score '+scoreClass(v)+'" style="border-color:'+scoreColor(v)+';background:'+scoreColor(v)+'15">'+sk.label.split(' ')[0]+': '+v+'</span>';
  }).join('');
  var flags = (page.flags||[]).map(function(f) {
    if(!f) return '';
    return '<span class="flag flag-'+(f.type||'info')+'">'+(f.label||'')+'</span>';
  }).join('');
  var schemaFound = (page.schemaTypes||[]).map(function(s){return '<span class="schema-badge">'+s+'</span>';}).join('');
  var schemaMissing = (page.missingSchema||[]).map(function(s){return '<span class="schema-badge missing">Missing: '+s+'</span>';}).join('');
  var auditSections = AUDIT_KEYS.map(function(ak) {
    return '<div class="audit-section"><div class="audit-section-title">'+ak.label+'</div><div class="audit-section-body">'+(page.audit&&page.audit[ak.key]||'')+'</div></div>';
  }).join('');
  var priorities = (page.audit&&page.audit.priorityActions)||[];
  var priorityHTML = '';
  if (priorities.length) {
    priorityHTML = '<div class="priority-box"><div class="priority-box-title">⚡ Priority Actions</div>';
    priorities.forEach(function(a,i) {
      if(!a) return;
      var action = typeof a==='string'?a:(a.action||'');
      var impact = typeof a==='object'?(a.impact||''):'';
      priorityHTML += '<div class="priority-item"><span class="priority-num">'+(i+1)+'.</span><div><div class="priority-text">'+action+'</div>'+(impact?'<span class="priority-impact impact-'+impact.toLowerCase()+'">'+impact+' IMPACT</span>':'')+'</div></div>';
    });
    priorityHTML += '</div>';
  }
  var schemaSection = (schemaFound||schemaMissing)?'<div class="audit-section" style="grid-column:1/-1"><div class="audit-section-title">Schema Found / Missing</div><div class="schema-badges">'+schemaFound+schemaMissing+'</div></div>':'';
  var pageUrl = page.url||'';
  var safeUrl = pageUrl.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return '<div class="page-card">'+
    '<div class="page-card-header" onclick="toggleCard(this)">'+
      '<div class="page-meta">'+
        '<div style="display:flex;align-items:center;gap:.5rem">'+
          '<div class="page-url">'+pageUrl+'</div>'+
          '<button onclick="event.stopPropagation();openUrl(\''+safeUrl+'\')" class="btn btn-ghost btn-sm" style="padding:.1rem .35rem;font-size:.65rem;flex-shrink:0">↗</button>'+
        '</div>'+
        '<div class="page-title-sub">'+(page.pageTitle||'(no title)')+'</div>'+
        '<div class="page-flags">'+flags+'</div>'+
      '</div>'+
      '<div class="page-scores-mini">'+miniScores+'</div>'+
      '<span class="arrow-icon">▸</span>'+
    '</div>'+
    '<div class="page-card-body"><div class="audit-grid">'+auditSections+schemaSection+'</div>'+priorityHTML+'</div>'+
  '</div>';
}

function exportServicesPDF() {
  if (!lastServicesData) { alert('No services audit data to export.'); return; }
  generatePDF('audit', lastServicesData);
}
function exportSitepagesPDF() {
  if (!lastSitepagesData) { alert('No site pages audit data to export.'); return; }
  generatePDF('audit', lastSitepagesData);
}
