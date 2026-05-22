var lastContentMapData = null;

function runContentMap() {
  var url = validUrl(getVal('contentMapUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  setDisabled(['contentMapBtn'], true);
  startAndPoll(
    { url: url, type: 'contentmap', pageLimit: 9999 },
    'contentMapOutput',
    [
      'Discovering all blog posts...',
      'Discovering all service pages...',
      'Matching blogs to service pages with AI...',
      'Identifying linking gaps...',
      'Building content map report...'
    ],
    function(data) {
      lastContentMapData = data;
      saveToFirestore('contentmap', data.domain || 'unknown', data);
      renderContentMap(data);
      setDisabled(['contentMapBtn'], false);
    },
    function(err) {
      document.getElementById('contentMapOutput').innerHTML = '<div class="error-msg">❌ ' + err + '</div>';
      setDisabled(['contentMapBtn'], false);
    }
  );
}

function renderContentMap(data) {
  if (!data) return;
  var mappings = data.mappings || [];
  var unmapped = data.unmappedBlogs || [];
  var totalBlogs = mappings.length + unmapped.length;
  var serviceCount = 0;

  // Group mappings by service page
  var byService = {};
  mappings.forEach(function(m) {
    if (!m) return;
    var key = m.serviceUrl || 'Unknown';
    if (!byService[key]) {
      byService[key] = { serviceUrl: m.serviceUrl || '', serviceTitle: m.serviceTitle || '', blogs: [] };
      serviceCount++;
    }
    byService[key].blogs.push(m);
  });

  var serviceCards = Object.values(byService).sort(function(a, b) {
    return b.blogs.length - a.blogs.length;
  }).map(function(group) {
    var blogRows = group.blogs.map(function(m) {
      var safeBlogUrl = (m.blogUrl || '').replace(/'/g, "\\'");
      var confidence = m.confidence || 'medium';
      var confColor = confidence === 'high' ? 'var(--green)' : confidence === 'medium' ? 'var(--amber)' : 'var(--muted)';
      return '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:.5rem .75rem;font-size:.8rem;color:var(--text)">' +
          '<a onclick="openUrl(\'' + safeBlogUrl + '\')" style="color:var(--accent2);cursor:pointer;text-decoration:none">' + (m.blogTitle || m.blogUrl || '') + '</a>' +
        '</td>' +
        '<td style="padding:.5rem .75rem;font-size:.72rem;color:var(--muted);font-family:\'DM Mono\',monospace;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (m.blogUrl || '').replace(/https?:\/\/[^\/]+/, '') +
        '</td>' +
        '<td style="padding:.5rem .75rem;text-align:center">' +
          '<span style="font-family:\'DM Mono\',monospace;font-size:.62rem;color:' + confColor + ';background:' + confColor + '15;padding:.15rem .4rem;border-radius:3px;border:1px solid ' + confColor + '40">' + confidence.toUpperCase() + '</span>' +
        '</td>' +
        '<td style="padding:.5rem .75rem;font-size:.78rem;color:var(--muted)">' + (m.reason || '') + '</td>' +
      '</tr>';
    }).join('');

    var safeServiceUrl = (group.serviceUrl || '').replace(/'/g, "\\'");
    return '<div class="page-card" style="margin-bottom:.75rem">' +
      '<div class="page-card-header" onclick="toggleCard(this)">' +
        '<div class="page-meta">' +
          '<div style="display:flex;align-items:center;gap:.5rem">' +
            '<div class="page-url">' + (group.serviceTitle || group.serviceUrl) + '</div>' +
            '<button onclick="event.stopPropagation();openUrl(\'' + safeServiceUrl + '\')" class="btn btn-ghost btn-sm" style="padding:.1rem .35rem;font-size:.65rem;flex-shrink:0">↗</button>' +
          '</div>' +
          '<div class="page-title-sub">' + group.serviceUrl + '</div>' +
        '</div>' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:.72rem;background:rgba(108,99,245,.1);color:var(--accent2);padding:.2rem .5rem;border-radius:4px;flex-shrink:0">' + group.blogs.length + ' posts</span>' +
        '<span class="arrow-icon">▸</span>' +
      '</div>' +
      '<div class="page-card-body">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--surface2)">' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">BLOG POST</th>' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">URL</th>' +
            '<th style="padding:.5rem .75rem;text-align:center;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">MATCH</th>' +
            '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">REASON</th>' +
          '</tr></thead>' +
          '<tbody>' + blogRows + '</tbody>' +
        '</table>' +
        '<div style="margin-top:.75rem;padding:.75rem;background:rgba(108,99,245,.06);border-radius:7px;border:1px solid rgba(108,99,245,.2)">' +
          '<div style="font-family:\'DM Mono\',monospace;font-size:.67rem;letter-spacing:.08em;color:var(--accent2);margin-bottom:.35rem">RECOMMENDED ACTION</div>' +
          '<div style="font-size:.855rem;color:var(--text)">Add these ' + group.blogs.length + ' blog posts as a "Related Articles" section on <strong>' + (group.serviceTitle || group.serviceUrl) + '</strong>. Also add a link back to this service page at the bottom of each blog post.</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var unmappedHTML = '';
  if (unmapped.length) {
    var unmappedRows = unmapped.map(function(b) {
      if (!b) return '';
      var safeBlogUrl = (b.url || '').replace(/'/g, "\\'");
      return '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:.5rem .75rem;font-size:.8rem"><a onclick="openUrl(\'' + safeBlogUrl + '\')" style="color:var(--accent2);cursor:pointer">' + (b.title || b.url || '') + '</a></td>' +
        '<td style="padding:.5rem .75rem;font-size:.72rem;color:var(--muted);font-family:\'DM Mono\',monospace">' + (b.url || '').replace(/https?:\/\/[^\/]+/, '') + '</td>' +
        '<td style="padding:.5rem .75rem;font-size:.78rem;color:var(--amber)">' + (b.reason || 'No clear service page match') + '</td>' +
      '</tr>';
    }).join('');
    unmappedHTML = '<div class="section-title" style="margin-top:1.5rem">Unmapped Posts (' + unmapped.length + ')</div>' +
      '<div class="info-msg" style="background:rgba(245,166,35,.07);border-color:rgba(245,166,35,.25);color:var(--amber)">These posts don\'t match any specific service page. Link from homepage, a resources hub page, or create a new service page to match them.</div>' +
      '<div class="page-card"><div class="page-card-header expanded" onclick="toggleCard(this)"><span style="font-family:\'DM Mono\',monospace;font-size:.73rem;color:var(--amber)">⚠ ' + unmapped.length + ' Posts Without a Service Page Match</span><span class="arrow-icon" style="margin-left:auto">▾</span></div>' +
      '<div class="page-card-body open"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--surface2)">' +
        '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">BLOG POST</th>' +
        '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">URL</th>' +
        '<th style="padding:.5rem .75rem;text-align:left;font-family:\'DM Mono\',monospace;font-size:.65rem;color:var(--muted)">RECOMMENDATION</th>' +
      '</tr></thead><tbody>' + unmappedRows + '</tbody></table></div></div>';
  }

  document.getElementById('contentMapOutput').innerHTML =
    '<div class="info-msg">✓ Content map complete — ' + mappings.length + ' blog posts matched to ' + serviceCount + ' service pages from ' + (data.domain || '') + '</div>' +
    '<div class="top-actions"><button class="btn btn-export" onclick="exportContentMapCSV()">↓ EXPORT CSV</button></div>' +
    '<div class="section-title">Content Map Overview — ' + (data.domain || '') + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem;margin-bottom:1.5rem">' +
      cmChip('Total Blog Posts', totalBlogs) +
      cmChip('Matched to Services', mappings.length) +
      cmChip('Unmapped Posts', unmapped.length) +
      cmChip('Service Pages', serviceCount) +
    '</div>' +
    '<div class="info-msg" style="background:rgba(31,217,160,.07);border-color:rgba(31,217,160,.25);color:var(--green);margin-bottom:1.5rem">' +
      '💡 <strong>How to use this:</strong> For each service page below, add the listed blog posts as "Related Articles." ' +
      'Then add a link back to the service page at the bottom of each blog post. ' +
      'Export as CSV and send to your web team or GeniusVets support.' +
    '</div>' +
    '<div class="section-title">Blog Posts Mapped by Service Page</div>' +
    serviceCards + unmappedHTML;
}

function cmChip(label, value) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:.65rem;text-align:center">' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:.6rem;letter-spacing:.06em;color:var(--muted);margin-bottom:.3rem">' + label.toUpperCase() + '</div>' +
    '<div style="font-family:\'Fraunces\',serif;font-size:1.4rem;color:var(--accent2)">' + value + '</div>' +
  '</div>';
}

function exportContentMapCSV() {
  if (!lastContentMapData) { alert('No content map data to export.'); return; }
  var rows = [['Blog Post Title','Blog URL','Service Page Title','Service Page URL','Match Confidence','Reason']];
  (lastContentMapData.mappings || []).forEach(function(m) {
    if (!m) return;
    rows.push(['"'+(m.blogTitle||'').replace(/"/g,'""')+'"', m.blogUrl||'', '"'+(m.serviceTitle||'').replace(/"/g,'""')+'"', m.serviceUrl||'', m.confidence||'', '"'+(m.reason||'').replace(/"/g,'""')+'"']);
  });
  (lastContentMapData.unmappedBlogs || []).forEach(function(b) {
    if (!b) return;
    rows.push(['"'+(b.title||'').replace(/"/g,'""')+'"', b.url||'', 'UNMAPPED','','','"'+(b.reason||'No match').replace(/"/g,'""')+'"']);
  });
  var csv = rows.map(function(r){return r.join(',');}).join('\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'content-map-'+(lastContentMapData.domain||'report')+'.csv';
  a.click();
}
