async function loadHistory() {
  var out = document.getElementById('historyOutput');
  try {
    var snap = await db.collection('audits').orderBy('createdAt', 'desc').limit(50).get();
    if (snap.empty) {
      out.innerHTML = '<div class="empty-state">No audit history yet. Run your first audit above.</div>';
      return;
    }
    var cards = '';
    snap.forEach(function(d) {
      var item = d.data();
      var date = new Date(item.createdAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      cards += '<div class="history-card">' +
        '<div style="flex:1;cursor:pointer;min-width:0" onclick="loadHistoryItem(\'' + d.id + '\',\'' + item.type + '\')">' +
          '<div class="history-domain">' + (item.domain || 'Unknown') + '</div>' +
          '<div class="history-date">' + date + '</div>' +
        '</div>' +
        '<span class="history-type">' + (item.type || '') + '</span>' +
        '<button onclick="deleteHistoryItem(\'' + d.id + '\')" class="btn btn-ghost btn-sm" ' +
          'style="color:var(--red);border-color:rgba(240,107,107,.25);padding:.35rem .6rem;font-size:.7rem;flex-shrink:0" ' +
          'title="Delete this report">🗑 Delete</button>' +
        '<span style="color:var(--muted);cursor:pointer;flex-shrink:0" onclick="loadHistoryItem(\'' + d.id + '\',\'' + item.type + '\')">→</span>' +
      '</div>';
    });
    out.innerHTML =
      '<div class="section-title">Recent Audits</div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:.7rem;color:var(--muted);margin-bottom:1rem">' +
        'Click a report to reload it. Reports are ~50-200KB each — storage is rarely a concern.' +
      '</div>' +
      cards;
  } catch(e) {
    out.innerHTML = '<div class="error-msg">Could not load history: ' + e.message + '</div>';
  }
}

async function deleteHistoryItem(id) {
  if (!confirm('Are you sure you want to permanently delete this report? This cannot be undone.')) return;
  try {
    await db.collection('audits').doc(id).delete();
    loadHistory();
  } catch(e) {
    alert('Could not delete: ' + e.message);
  }
}

async function loadHistoryItem(id, type) {
  try {
    var snap = await db.collection('audits').doc(id).get();
    if (!snap.exists) { alert('Report not found'); return; }
    var item = snap.data();
    if (!item || !item.data) { alert('Report data is empty'); return; }
    if (type === 'audit') { lastAuditData = item.data; showView('audit'); renderAudit(item.data); }
    else if (type === 'sitemap') { lastSitemapData = item.data; showView('sitemap'); renderSitemap(item.data); }
    else if (type === 'compare') { lastCompareData = item.data; showView('compare'); renderCompare(item.data); }
  } catch(e) {
    alert('Could not load report: ' + e.message);
  }
}
