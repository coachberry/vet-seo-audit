var lastSinglePageData = null;

function runSinglePage() {
  var url = validUrl(getVal('singlePageUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  setDisabled(['singlePageBtn'], true);
  startAndPoll(
    { url: url, type: 'singlepage' },
    'singlePageOutput',
    [
      'Fetching page HTML...',
      'Parsing meta tags & schema...',
      'Analyzing content & E-E-A-T...',
      'Scoring GEO & AI readiness...',
      'Building recommendations...'
    ],
    function(data) {
      lastSinglePageData = data;
      saveToFirestore('singlepage', data.domain || 'unknown', data);
      renderSinglePage(data);
      setDisabled(['singlePageBtn'], false);
    },
    function(err) {
      document.getElementById('singlePageOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['singlePageBtn'], false);
    }
  );
}

function renderSinglePage(data) {
  if (!data || !data.page) {
    document.getElementById('singlePageOutput').innerHTML = '<div class="error-msg">No page data returned.</div>';
    return;
  }
  var page = data.page;
  var s = page.scores || {};

  // Score cards
  var scoreCards = SCORE_KEYS.map(function(sk) {
    var v = Math.round(s[sk.key] || 0);
    return '<div class="score-card">' +
      '<div class="score-label">' + sk.label + '</div>' +
      '<div class="score-num" style="color:' + scoreColor(v) + '">' + v + '</div>' +
      '<div class="score-bar"><div class="score-fill" style="width:' + v + '%;background:' + scoreColor(v) + '"></div></div>' +
      '<div class="score-grade ' + scoreClass(v) + '">' + scoreGrade(v) + '</div>' +
    '</div>';
  }).join('');

  // Raw signals
  var rawSignals = [
    { label: 'Title', value: page.pageTitle || '(none)', status: page.pageTitle ? (page.titleLength > 60 ? 'warn' : 'ok') : 'error', note: page.titleLength + ' chars' },
    { label: 'Meta Description', value: page.metaDescription || '(none)', status: page.metaDescription ? (page.metaDescLength > 160 ? 'warn' : 'ok') : 'error', note: page.metaDescLength + ' chars' },
    { label: 'Canonical', value: page.canonical || '(none)', status: page.canonical ? 'ok' : 'warn', note: '' },
    { label: 'Robots Meta', value: page.robotsMeta || '(not set)', status: page.isNoindex ? 'error' : 'ok', note: page.isNoindex ? 'NOINDEX!' : '' },
    { label: 'H1 Tags', value: (page.h1s || []).join(', ') || '(none)', status: !page.h1s || page.h1s.length === 0 ? 'error' : page.h1s.length > 1 ? 'warn' : 'ok', note: (page.h1s || []).length + ' found' },
    { label: 'H2 Tags', value: (page.h2s || []).slice(0,3).join(', ') + ((page.h2s||[]).length > 3 ? '...' : '') || '(none)', status: (page.h2s||[]).length > 0 ? 'ok' : 'warn', note: (page.h2s||[]).length + ' found' },
    { label: 'Word Count', value: (page.wordCount || 0) + ' words', status: (page.wordCount||0) >= 800 ? 'ok' : (page.wordCount||0) >= 300 ? 'warn' : 'error', note: (page.wordCount||0) < 300 ? 'Thin content' : '' },
    { label: 'HTTPS', value: page.hasHttps ? 'Yes' : 'No', status: page.hasHttps ? 'ok' : 'error', note: '' },
    { label: 'Viewport Meta', value: page.hasViewport ? 'Present' : 'Missing', status: page.hasViewport ? 'ok' : 'error', note: '' },
    { label: 'OG Title', value: (page.og && page.og.title) || '(none)', status: (page.og && page.og.title) ? 'ok' : 'warn', note: '' },
    { label: 'OG Image', value: (page.og && page.og.image) ? 'Present' : 'Missing', status: (page.og && page.og.image) ? 'ok' : 'warn', note: '' },
    { label: 'Twitter Card', value: (page.twitter && page.twitter.card) || 'Missing', status: (page.twitter && page.twitter.card) ? 'ok' : 'warn', note: '' },
    { label: 'Images Without Alt', value: (page.imagesWithoutAlt || 0) + ' of ' + (page.images||[]).length, status: (page.imagesWithoutAlt||0) === 0 ? 'ok' : 'warn', note: '' },
    { label: 'FAQ Content', value: page.hasFAQContent ? 'Detected' : 'Not found', status: page.hasFAQContent ? 'ok' : 'info', note: '' },
    { label: 'Phone Numbers', value: (page.phones||[]).length > 0 ? (page.phones||[]).join(', ') : '(none detected)', status: (page.phones||[]).length > 0 ? 'ok' : 'warn', note: '' },
    { label: 'Address Detected', value: page.hasAddress ? 'Yes' : 'No', status: page.hasAddress ? 'ok' : 'warn', note: '' },
    { label: 'Hours Detected', value: page.hasHours ? 'Yes' : 'No', status: page.hasHours ? 'ok' : 'warn', note: '' }
  ];

  var signalRows = rawSignals.map(function(sig) {
    var statusIcon = sig.status === 'ok' ? '✓' : sig.status === 'warn' ? '⚠' : sig.status === 'error' ? '✗' : 'ℹ';
    var statusColor = sig.status === 'ok' ? 'var(--green)' : sig.status === 'warn' ? 'var(--amber)' : sig.status === 'error' ? 'var(--red)' : 'var(--blue)';
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:.5rem .75rem;font-family:\'DM Mono\',monospace;font-size:.72rem;color:var(--muted);white-space:nowrap">' + sig.label + '</td>' +
      '<td style="padding:.5rem .75rem;font-size:.85rem;color:var(--text);max-width:300px;overflow:hidden;text-overflow:ellipsis">' + sig.value + '</td>' +
      '<td style="padding:.5rem .75rem;font-size:.75rem;color:var(--muted)">' + (sig.note || '') + '</td>' +
      '<td style="padding:.5rem .75rem;text-align:center;font-size:.9rem;color:' + statusColor + '">' + statusIcon + '</td>' +
    '</tr>';
  }).join('');

  // Schema section
  var schemaFound = (page.schemaTypes || []).map(function(s) { return '<span class="schema-badge">' + s + '</span>'; }).join('');
  var schemaMissing = (page.missingSchema || []).map(function(s) { return '<span class="schema-badge missing">Missing: ' + s + '</span>'; }).join('');

  // Audit sections
  var auditSections = AUDIT_KEYS.map(function(ak) {
    var val = page.audit && page.audit[ak.key] || '';
    return '<div class="audit-section">' +
      '<div class="audit-section-title">' + ak.label + '</div>' +
      '<div class="audit-section-body">' + val + '</div>' +
    '</div>';
  }).join('');

  // Priority actions
  var priorities = (page.audit && page.audit.priorityActions) || [];
  var priorityHTML = '';
  if (priorities.length) {
    priorityHTML = '<div class="priority-box"><div class="priority-box-title">⚡ Priority Actions</div>';
    priorities.forEach(function(a, i) {
      if (!a) return;
      var action = typeof a === 'string' ? a : (a.action || '');
      var impact = typeof a === 'object' ? (a.impact || '') : '';
      priorityHTML += '<div class="priority-item"><span class="priority-num">' + (i+1) + '.</span>' +
        '<div><div class="priority-text">' + action + '</div>' +
        (impact ? '<span class="priority-impact impact-' + impact.toLowerCase() + '">' + impact + ' IMPACT</span>' : '') +
        '</div></div>';
    });
    priorityHTML += '</div>';
  }

  // Flags
  var flags = (page.flags || []).map(function(f) {
    if (!f) return '';
    return '<span class="flag flag-' + (f.type||'info') + '">' + (f.label||'') + '</span>';
  }).join('');

  var safeUrl = (page.url || '').replace(/'/g, "\\'");

  document.getElementById('singlePageOutput').innerHTML =
    '<div class="info-msg">✓ Single page audit complete — <a onclick="openUrl(\'' + safeUrl + '\')" style="color:var(--accent2);cursor:pointer">' + (page.url || '') + '</a></div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportSinglePagePDF()">↓ EXPORT PDF</button></div>' +

    '<div class="section-title">Page Scores</div>' +
    '<div style="margin-bottom:.5rem">' + flags + '</div>' +
    '<div class="score-grid">' + scoreCards + '</div>' +

    '<div class="section-title">Raw Page Signals</div>' +
    '<div class="page-card" style="margin-bottom:1rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">📊 Technical Signals — What the Crawler Found</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--surface2)">' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">SIGNAL</th>' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">VALUE</th>' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">NOTE</th>' +
            '<th style="padding:.5rem .75rem;text-align:center;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">STATUS</th>' +
          '</tr></thead>' +
          '<tbody>' + signalRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +

    '<div class="section-title">Schema / Structured Data</div>' +
    '<div class="page-card" style="margin-bottom:1rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🏗 Schema Found & Missing</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        '<div class="schema-badges">' + (schemaFound || '<span style="color:var(--muted);font-size:.875rem">No schema found on this page</span>') + schemaMissing + '</div>' +
      '</div>' +
    '</div>' +

    '<div class="section-title">Detailed Audit</div>' +
    '<div class="audit-grid">' + auditSections + '</div>' +
    priorityHTML;
}

function exportSinglePagePDF() {
  if (!lastSinglePageData) { alert('No page data to export.'); return; }
  generatePDF('audit', {
    domain: lastSinglePageData.domain || '',
    totalPagesCrawled: 1,
    siteAverages: lastSinglePageData.page && lastSinglePageData.page.scores || {},
    pages: [lastSinglePageData.page]
  });
}
