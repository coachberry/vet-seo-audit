async function loadHistory() {
  var out = document.getElementById('historyOutput');
  try {
    var snap = await db.collection('audits').orderBy('createdAt', 'desc').limit(50).get();
    if (snap.empty) { out.innerHTML = '<div class="empty-state">No audit history yet.</div>'; return; }
    var cards = '';
    snap.forEach(function(d) {
      var item = d.data();
      var date = new Date(item.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
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
