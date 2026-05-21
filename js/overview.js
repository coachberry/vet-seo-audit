var lastOverviewData = null;

function runOverview() {
  var url = validUrl(getVal('overviewUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  setDisabled(['overviewBtn'], true);
  startAndPoll(
    { url: url, type: 'overview', pageLimit: 50 },
    'overviewOutput',
    [
      'Crawling site for signals...',
      'Checking schema coverage...',
      'Analyzing technical SEO...',
      'Reviewing content signals...',
      'Evaluating local SEO...',
      'Scoring GEO & AI readiness...',
      'Generating priorities...'
    ],
    function(data) {
      lastOverviewData = data;
      saveToFirestore('overview', data.domain || 'unknown', data);
      renderOverview(data);
      setDisabled(['overviewBtn'], false);
    },
    function(err) {
      document.getElementById('overviewOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['overviewBtn'], false);
    }
  );
}

function renderOverview(data) {
  if (!data) return;
  var scores = data.scores || {};
  var CATEGORIES = [
    { key: 'overallSEO', label: 'Overall SEO', icon: '🎯' },
    { key: 'localSEO', label: 'Local SEO', icon: '📍' },
    { key: 'schemaStructuredData', label: 'Schema / Structured Data', icon: '🏗' },
    { key: 'contentQuality', label: 'Content Quality', icon: '✍️' },
    { key: 'technicalSEO', label: 'Technical SEO', icon: '⚙️' },
    { key: 'geoAIReadiness', label: 'GEO & AI Readiness', icon: '🤖' },
    { key: 'eeAt', label: 'E-E-A-T', icon: '🏆' }
  ];

  var scoreCards = CATEGORIES.map(function(cat) {
    var v = Math.round(scores[cat.key] || 0);
    var grade = scoreGrade(v);
    return '<div class="score-card" style="text-align:center">' +
      '<div style="font-size:1.5rem;margin-bottom:.35rem">' + cat.icon + '</div>' +
      '<div class="score-label">' + cat.label + '</div>' +
      '<div class="score-num" style="color:' + scoreColor(v) + '">' + v + '</div>' +
      '<div class="score-bar"><div class="score-fill" style="width:' + v + '%;background:' + scoreColor(v) + '"></div></div>' +
      '<div class="score-grade ' + scoreClass(v) + '">' + grade + '</div>' +
      '</div>';
  }).join('');

  // Top priorities
  var priorities = data.topPriorities || [];
  var priorityCards = priorities.length ? priorities.map(function(p, i) {
    if (!p) return '';
    var impact = (p.impact || 'medium').toLowerCase();
    return '<div class="priority-item" style="padding:.65rem 0">' +
      '<span class="priority-num">' + (i+1) + '.</span>' +
      '<div style="flex:1">' +
        '<div class="priority-text">' + (p.action || '') + '</div>' +
        '<div style="display:flex;gap:.5rem;margin-top:.3rem;flex-wrap:wrap">' +
          '<span class="priority-impact impact-' + impact + '">' + (p.impact||'MEDIUM') + ' IMPACT</span>' +
          (p.effort ? '<span class="priority-impact" style="background:rgba(91,163,245,.1);color:var(--blue);border:1px solid rgba(91,163,245,.2)">' + p.effort + ' EFFORT</span>' : '') +
          (p.category ? '<span style="font-family:\'DM Mono\',monospace;font-size:.62rem;color:var(--muted)">' + p.category + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') : '<div style="color:var(--muted);font-size:.875rem">No priorities generated.</div>';

  // Quick wins
  var quickWins = data.quickWins || [];
  var quickWinsHTML = quickWins.length ?
    '<ul style="padding-left:1.1rem;font-size:.875rem;line-height:2.1">' +
      quickWins.map(function(w) { return '<li class="green">' + w + '</li>'; }).join('') +
    '</ul>' :
    '<div style="color:var(--muted);font-size:.875rem">No quick wins identified.</div>';

  // Strategy sections
  function strategyCard(title, icon, content, color) {
    color = color || 'var(--accent2)';
    return '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:' + color + '">' + icon + ' ' + title + '</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' +
        '<div class="prose">' + (content || '<p style="color:var(--muted)">No data available.</p>') + '</div>' +
      '</div>' +
    '</div>';
  }

  function paragraphify(text) {
    if (!text) return '';
    return text.split('\n\n').map(function(p) { return '<p>' + p + '</p>'; }).join('');
  }

  // Crawl stats
  var crawlStats = data.crawlStats || {};

  document.getElementById('overviewOutput').innerHTML =
    '<div class="info-msg">✓ Overview complete — ' + (data.totalPagesCrawled||0) + ' pages crawled from ' + (data.domain||'') + ' in signal-only mode</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportOverviewPDF()">↓ EXPORT PDF</button></div>' +

    '<div class="section-title">Site-Wide Scores — ' + (data.domain||'') + '</div>' +
    '<div class="score-grid">' + scoreCards + '</div>' +

    // Crawl signal stats
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem;margin-bottom:1.5rem">' +
      statChip('Pages Crawled', crawlStats.totalPages || data.totalPagesCrawled || 0, '') +
      statChip('Has Schema', crawlStats.pagesWithSchema || 0, ' pages') +
      statChip('Missing H1', crawlStats.pagesNoH1 || 0, ' pages') +
      statChip('No Meta Desc', crawlStats.pagesNoMeta || 0, ' pages') +
      statChip('Avg Word Count', crawlStats.avgWordCount || 0, ' words') +
      statChip('Orphan Pages', crawlStats.orphanPages || 0, ' pages') +
      statChip('XML Sitemap', data.hasXMLSitemap ? '✓' : '✗', '') +
      statChip('robots.txt', data.hasRobotsTxt ? '✓' : '✗', '') +
    '</div>' +

    '<div class="section-title">Top Priorities</div>' +
    '<div class="priority-box" style="margin-bottom:1.5rem">' +
      '<div class="priority-box-title">⚡ Ranked by Impact — Fix These First</div>' +
      priorityCards +
    '</div>' +

    '<div class="section-title">Quick Wins</div>' +
    '<div class="page-card" style="margin-bottom:1.5rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ Quick Wins — Low Effort, High Impact</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open">' + quickWinsHTML + '</div>' +
    '</div>' +

    '<div class="section-title">Strategy Breakdown</div>' +
    strategyCard('Overall Findings', '📊', paragraphify(data.overallFindings), 'var(--accent2)') +
    strategyCard('Local SEO Strategy', '📍', paragraphify(data.localSEOFindings), 'var(--blue)') +
    strategyCard('Content Strategy', '✍️', paragraphify(data.contentStrategy), 'var(--green)') +
    strategyCard('Schema Strategy', '🏗', paragraphify(data.schemaStrategy), 'var(--amber)') +
    strategyCard('GEO & AI Strategy', '🤖', paragraphify(data.geoAIStrategy), 'var(--pink)') +

    '<div class="section-title" style="margin-top:1.5rem">Next Steps</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem;margin-bottom:1.5rem">' +
      nextStepCard('🔧 Services Audit', 'Deep audit of all /services/ pages', 'services', data.domain) +
      nextStepCard('📝 Blog Audit', 'Audit all blog posts for content quality', 'blog', data.domain) +
      nextStepCard('📄 Site Pages Audit', 'Audit homepage, about, contact, team', 'sitepages', data.domain) +
      nextStepCard('🗺 Build Sitemap', 'Full URL hierarchy and crawlability report', 'sitemap', data.domain) +
    '</div>';
}

function statChip(label, value, suffix) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:.75rem;text-align:center">' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:.65rem;letter-spacing:.08em;color:var(--muted);margin-bottom:.35rem">' + label.toUpperCase() + '</div>' +
    '<div style="font-family:\'Fraunces\',serif;font-size:1.5rem;color:var(--accent2)">' + value + '<span style="font-size:.8rem;color:var(--muted)">' + suffix + '</span></div>' +
  '</div>';
}

function nextStepCard(title, desc, view, domain) {
  var url = domain ? 'https://www.' + domain : '';
  var inputId = view === 'services' ? 'servicesUrl' : view === 'blog' ? 'blogUrl' : view === 'sitepages' ? 'sitepagesUrl' : 'sitemapUrl';
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:1rem;cursor:pointer;transition:border-color .2s" ' +
    'onclick="showView(\'' + view + '\');if(document.getElementById(\'' + inputId + '\'))document.getElementById(\'' + inputId + '\').value=\'' + url + '\'" ' +
    'onmouseover="this.style.borderColor=\'var(--border2)\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
    '<div style="font-size:1.1rem;margin-bottom:.35rem">' + title + '</div>' +
    '<div style="font-size:.82rem;color:var(--muted);line-height:1.5">' + desc + '</div>' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:.68rem;color:var(--accent2);margin-top:.65rem">Click to run →</div>' +
  '</div>';
}

function exportOverviewPDF() {
  if (!lastOverviewData) { alert('No overview data to export.'); return; }
  generatePDF('overview', lastOverviewData);
}
