function generatePDF(type, data) {
  // Load jsPDF dynamically if not already loaded
  if (!window.jspdf) {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function() { buildPDF(type, data); };
    document.head.appendChild(script);
  } else {
    buildPDF(type, data);
  }
}

function buildPDF(type, data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  var W = doc.internal.pageSize.getWidth();
  var H = doc.internal.pageSize.getHeight();
  var margin = 14;
  var y = 0;

  function checkPage(needed) {
    needed = needed || 10;
    if (y + needed > H - margin) { doc.addPage(); y = margin + 5; }
  }

  function header(title, subtitle) {
    doc.setFillColor(7, 8, 15);
    doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(157, 150, 250);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('🐾 VetSEO AUDITOR', W/2, 10, { align: 'center' });
    doc.setTextColor(232, 233, 245);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text(title, W/2, 20, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(126, 128, 160);
    doc.text(subtitle, W/2, 28, { align: 'center' });
    y = 38;
  }

  function scoreCard(x, cy, w, label, score) {
    var rgb = score >= 80 ? [31,217,160] : score >= 55 ? [245,166,35] : [240,107,107];
    doc.setFillColor(15, 16, 24);
    doc.roundedRect(x, cy, w, 16, 1.5, 1.5, 'F');
    doc.setFontSize(6); doc.setTextColor(126,128,160); doc.setFont('helvetica','normal');
    doc.text(label.toUpperCase(), x+w/2, cy+5.5, { align:'center', maxWidth: w-2 });
    doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(...rgb);
    doc.text(String(score), x+w/2, cy+13, { align:'center' });
  }

  function sectionHeader(text) {
    checkPage(10);
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(157,150,250);
    doc.text(text.toUpperCase(), margin, y); y += 5;
  }

  function bodyText(text, color) {
    color = color || [200,200,210];
    if (!text) return;
    doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...color);
    var lines = doc.splitTextToSize(String(text), W - margin*2);
    checkPage(lines.length * 3.5 + 2);
    doc.text(lines, margin, y);
    y += lines.length * 3.5 + 2;
  }

  function bulletList(items, color) {
    color = color || [200,200,210];
    (items||[]).forEach(function(item) {
      checkPage(8);
      bodyText('• ' + item, color);
    });
  }

  if (type === 'audit') {
    header('SEO Audit Report', (data.domain||'') + ' · ' + new Date().toLocaleDateString());
    // Site averages
    var cw = (W - margin*2 - (SCORE_KEYS.length-1)*2) / SCORE_KEYS.length;
    SCORE_KEYS.forEach(function(sk, i) {
      scoreCard(margin + i*(cw+2), y, cw, sk.label, Math.round(data.siteAverages&&data.siteAverages[sk.key]||0));
    });
    y += 20;

    (data.pages||[]).forEach(function(page, pi) {
      doc.addPage(); y = margin;
      // Page header
      doc.setFillColor(15,16,24); doc.roundedRect(margin, y, W-margin*2, 8, 1, 1, 'F');
      doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(157,150,250);
      doc.text((page.url||'').substring(0, 90), margin+2, y+5.5, { maxWidth: W-margin*2-4 });
      y += 11;

      // Page scores
      var pcw = (W-margin*2-6)/4;
      SCORE_KEYS.slice(0,4).forEach(function(sk, i) {
        scoreCard(margin+i*(pcw+2), y, pcw, sk.label, Math.round(page.scores&&page.scores[sk.key]||0));
      });
      y += 20;

      // Audit sections
      AUDIT_KEYS.forEach(function(ak) {
        if (page.audit && page.audit[ak.key]) {
          sectionHeader(ak.label);
          bodyText(page.audit[ak.key]);
          y += 2;
        }
      });

      // Priority actions
      var priorities = page.audit && page.audit.priorityActions || [];
      if (priorities.length) {
        sectionHeader('Priority Actions');
        priorities.forEach(function(a, i) {
          var text = (i+1) + '. ' + (typeof a === 'string' ? a : a.action||'');
          if (typeof a === 'object' && a.impact) text += ' [' + a.impact + ' IMPACT]';
          bodyText(text);
        });
      }
    });

    doc.save('vetseo-audit-' + (data.domain||'report') + '.pdf');

  } else if (type === 'sitemap') {
    header('Sitemap Report', (data.domain||'') + ' · ' + new Date().toLocaleDateString());
    var sw = (W-margin*2-6)/3;
    scoreCard(margin, y, sw, 'Total Pages', data.totalPages||0);
    scoreCard(margin+sw+3, y, sw, 'Crawl Depth', data.maxDepth||0);
    scoreCard(margin+(sw+3)*2, y, sw, 'Crawlability', Math.round(data.crawlability&&data.crawlability.score||0));
    y += 20;

    sectionHeader('Crawl Summary');
    bodyText('XML Sitemap: ' + (data.hasXMLSitemap ? 'Found ('+data.xmlSitemapUrlCount+' URLs)' : 'Not found'));
    bodyText('robots.txt: ' + (data.hasRobotsTxt ? 'Found' : 'Not found'));
    y += 3;

    sectionHeader('URL Strengths');
    bulletList(data.urlAnalysis&&data.urlAnalysis.strengths, [31,217,160]);
    y += 3;

    sectionHeader('URL Issues');
    bulletList(data.urlAnalysis&&data.urlAnalysis.issues, [240,107,107]);
    y += 3;

    sectionHeader('Recommendations');
    bulletList(data.urlAnalysis&&data.urlAnalysis.recommendations);
    y += 3;

    // Pages with issues
    var issuePages = (data.pages||[]).filter(function(p) { return p.status !== 'ok' || p.isOrphan; });
    if (issuePages.length) {
      doc.addPage(); y = margin;
      sectionHeader('Pages Requiring Attention (' + issuePages.length + ')');
      issuePages.forEach(function(p) {
        checkPage(20);
        doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(165,148,249);
        doc.text((p.url||'').substring(0,90), margin, y); y += 4;
        bodyText('Status: ' + (p.isOrphan?'ORPHAN':(p.status||'').toUpperCase()), [240,107,107]);
        if (p.issue) bodyText(p.issue);
        if (p.recommendation) bodyText('Fix: ' + p.recommendation, [31,217,160]);
        y += 3;
      });
    }

    if (data.overallReport) {
      doc.addPage(); y = margin;
      sectionHeader('Full Analysis Report');
      bodyText(data.overallReport);
    }

    doc.save('vetseo-sitemap-' + (data.domain||'report') + '.pdf');

  } else if (type === 'compare') {
    var s1 = data.site1||{}, s2 = data.site2||{}, cmp = data.comparison||{};
    header('Competitor Comparison', (s1.domain||'Site 1') + ' vs ' + (s2.domain||'Site 2'));
    var hw = (W-margin*2-4)/2;
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(157,150,250);
    doc.text((s1.domain||'Site 1')+(cmp.overallWinner==='site1'?' 🏆':''), margin+hw/2, y, {align:'center'});
    doc.text((s2.domain||'Site 2')+(cmp.overallWinner==='site2'?' 🏆':''), margin+hw+4+hw/2, y, {align:'center'});
    y += 6;
    SCORE_KEYS.forEach(function(sk) {
      var v1=Math.round(s1.siteAverages&&s1.siteAverages[sk.key]||0);
      var v2=Math.round(s2.siteAverages&&s2.siteAverages[sk.key]||0);
      scoreCard(margin, y, hw, sk.label+' — '+s1.domain, v1);
      scoreCard(margin+hw+4, y, hw, sk.label+' — '+s2.domain, v2);
      y += 19; checkPage(5);
    });
    y += 4;
    sectionHeader(s1.domain+' Advantages');
    bulletList(cmp.site1Advantages, [31,217,160]);
    y += 3;
    sectionHeader(s2.domain+' Advantages');
    bulletList(cmp.site2Advantages, [91,163,245]);
    y += 3;
    if (cmp.summary) { sectionHeader('Analysis'); bodyText(cmp.summary); }
    if (cmp.recommendations&&cmp.recommendations.length) {
      y += 3; sectionHeader('Recommendations');
      bulletList(cmp.recommendations);
    }
    doc.save('vetseo-compare-' + (s1.domain||'site1') + '-vs-' + (s2.domain||'site2') + '.pdf');
  }
}
