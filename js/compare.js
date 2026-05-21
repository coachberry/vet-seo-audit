var lastCompareData = null;

function runCompare() {
  var u1 = validUrl(getVal('compare1Url'));
  var u2 = validUrl(getVal('compare2Url'));
  if (!u1 || !u2) { alert('Please enter two valid URLs'); return; }
  setDisabled(['compareBtn'], true);
  startAndPoll(
    { url: u1, url1: u1, url2: u2, type: 'compare' },
    'compareOutput',
    ['Crawling site 1...', 'Crawling site 2...', 'Scoring both sites...', 'Building comparison...'],
    function(data) {
      lastCompareData = data;
      saveToFirestore('compare', ((data.site1 && data.site1.domain) || '') + ' vs ' + ((data.site2 && data.site2.domain) || ''), data);
      renderCompare(data);
      setDisabled(['compareBtn'], false);
    },
    function(err) {
      document.getElementById('compareOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['compareBtn'], false);
    }
  );
}

function renderCompare(data) {
  if (!data) return;
  var s1 = data.site1 || {}, s2 = data.site2 || {}, cmp = data.comparison || {};
  var w = cmp.overallWinner;

  var scoreRows = SCORE_KEYS.map(function(sk) {
    var v1 = Math.round((s1.siteAverages && s1.siteAverages[sk.key]) || 0);
    var v2 = Math.round((s2.siteAverages && s2.siteAverages[sk.key]) || 0);
    var winner = cmp.categoryWinners && cmp.categoryWinners[sk.key];
    return '<div class="cst-row">' +
      '<span class="cst-key">' + sk.label + '</span>' +
      '<span class="cst-val" style="color:' + scoreColor(v1) + '">' + v1 + (winner === 'site1' ? '<span class="winner-badge">WINNER</span>' : '') + '</span>' +
      '<span class="cst-val" style="color:' + scoreColor(v2) + '">' + v2 + (winner === 'site2' ? '<span class="winner-badge">WINNER</span>' : '') + '</span>' +
    '</div>';
  }).join('');

  var s1Pages = (s1.pages || []).map(buildPageCard).join('');
  var s2Pages = (s2.pages || []).map(buildPageCard).join('');

  document.getElementById('compareOutput').innerHTML =
    '<div class="top-actions"><button class="btn btn-export" onclick="exportComparePDF()">↓ EXPORT PDF</button></div>' +
    '<div class="compare-header-grid">' +
      '<div class="compare-col-label">' + (s1.domain || 'Site 1') + (w === 'site1' ? ' 🏆' : '') + '</div>' +
      '<div class="compare-vs">VS</div>' +
      '<div class="compare-col-label">' + (s2.domain || 'Site 2') + (w === 'site2' ? ' 🏆' : '') + '</div>' +
    '</div>' +
    '<div class="compare-score-table">' +
      '<div class="cst-header"><span>Category</span><span>' + (s1.domain || 'Site 1') + '</span><span>' + (s2.domain || 'Site 2') + '</span></div>' +
      scoreRows +
    '</div>' +
    '<div class="audit-grid" style="margin-bottom:1.5rem">' +
      '<div class="page-card" style="margin:0">' +
        '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
          '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--green)">✦ ' + (s1.domain || 'Site 1') + ' Advantages</span>' +
          '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
        '</div>' +
        '<div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' +
          (cmp.site1Advantages || []).map(function(a) { return '<li class="green">' + a + '</li>'; }).join('') +
        '</ul></div>' +
      '</div>' +
      '<div class="page-card" style="margin:0">' +
        '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
          '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--blue)">✦ ' + (s2.domain || 'Site 2') + ' Advantages</span>' +
          '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
        '</div>' +
        '<div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' +
          (cmp.site2Advantages || []).map(function(a) { return '<li class="blue">' + a + '</li>'; }).join('') +
        '</ul></div>' +
      '</div>' +
    '</div>' +
    '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">📊 Competitive Analysis</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open"><div class="prose">' +
        (cmp.summary || '').split('\n\n').map(function(p) { return '<p>' + p + '</p>'; }).join('') +
      '</div></div>' +
    '</div>' +
    '<div class="page-card" style="margin-bottom:1.75rem">' +
      '<div class="page-card-header expanded" onclick="toggleCard(this)">' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--accent2)">🔧 Recommendations</span>' +
        '<span class="arrow-icon" style="margin-left:auto">▾</span>' +
      '</div>' +
      '<div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">' +
        (cmp.recommendations || []).map(function(r) { return '<li style="color:var(--text)">' + r + '</li>'; }).join('') +
      '</ul></div>' +
    '</div>' +
    '<div class="audit-grid" style="align-items:start">' +
      '<div><div class="section-title" style="font-size:1rem">' + (s1.domain || 'Site 1') + ' — Page Audits</div>' + s1Pages + '</div>' +
      '<div><div class="section-title" style="font-size:1rem">' + (s2.domain || 'Site 2') + ' — Page Audits</div>' + s2Pages + '</div>' +
    '</div>';
}

function exportComparePDF() {
  if (!lastCompareData) { alert('No comparison data to export. Run a comparison first.'); return; }
  generatePDF('compare', lastCompareData);
}
