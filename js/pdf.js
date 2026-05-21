function generatePDF(type, data) {
  if (!window.jspdf) {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function() { buildPDF(type, data); };
    script.onerror = function() { alert('Could not load PDF library. Check your internet connection.'); };
    document.head.appendChild(script);
  } else {
    buildPDF(type, data);
  }
}

function buildPDF(type, data) {
  try {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var margin = 14;
    var y = 0;

    function checkPage(needed) {
      if (y + (needed || 10) > H - margin) {
        doc.addPage();
        y = margin + 5;
      }
    }

    function addHeader(title, subtitle) {
      doc.setFillColor(7, 8, 15);
      doc.rect(0, 0, W, 32, 'F');
      doc.setTextColor(157, 150, 250);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text('VetSEO AUDITOR', W / 2, 10, { align: 'center' });
      doc.setTextColor(232, 233, 245);
      doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text(title, W / 2, 20, { align: 'center' });
      doc.setFontSize(8); doc.setTextColor(126, 128, 160); doc.setFont('helvetica', 'normal');
      doc.text(subtitle || '', W / 2, 28, { align: 'center' });
      y = 38;
    }

    function scoreCard(x, cy, w, label, score) {
      score = Math.round(score || 0);
      var rgb = score >= 80 ? [31, 217, 160] : score >= 55 ? [245, 166, 35] : [240, 107, 107];
      doc.setFillColor(15, 16, 24);
      doc.roundedRect(x, cy, w, 16, 1.5, 1.5, 'F');
      doc.setFontSize(6); doc.setTextColor(126, 128, 160); doc.setFont('helvetica', 'normal');
      doc.text(label.toUpperCase(), x + w / 2, cy + 5.5, { align: 'center', maxWidth: w - 2 });
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(String(score), x + w / 2, cy + 13, { align: 'center' });
    }

    function sectionHead(text) {
      checkPage(12);
      doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.setTextColor(157, 150, 250);
      doc.text(text.toUpperCase(), margin, y);
      y += 5;
    }

    function bodyText(text, colorArr) {
      if (!text) return;
      colorArr = colorArr || [200, 200, 210];
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      doc.setTextColor(colorArr[0], colorArr[1], colorArr[2]);
      var lines = doc.splitTextToSize(String(text), W - margin * 2);
      checkPage(lines.length * 3.5 + 2);
      doc.text(lines, margin, y);
      y += lines.length * 3.5 + 2;
    }

    function bulletList(items, colorArr) {
      (items || []).forEach(function(item) {
        if (item) bodyText('• ' + item, colorArr);
      });
    }

    // ── AUDIT PDF ──────────────────────────────────
    if (type === 'audit') {
      addHeader('SEO Audit Report', (data.domain || '') + ' · ' + new Date().toLocaleDateString());

      // Site-wide score cards
      var cw = (W - margin * 2 - (SCORE_KEYS.length - 1) * 2) / SCORE_KEYS.length;
      SCORE_KEYS.forEach(function(sk, i) {
        scoreCard(margin + i * (cw + 2), y, cw, sk.label, (data.siteAverages && data.siteAverages[sk.key]) || 0);
      });
      y += 22;

      // Page-by-page
      (data.pages || []).forEach(function(page, pi) {
        if (!page) return;
        doc.addPage(); y = margin;

        // Page URL bar
        doc.setFillColor(15, 16, 24);
        doc.roundedRect(margin, y, W - margin * 2, 8, 1, 1, 'F');
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(157, 150, 250);
        doc.text((page.url || '').substring(0, 90), margin + 2, y + 5.5, { maxWidth: W - margin * 2 - 4 });
        y += 11;

        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(126, 128, 160);
        doc.text(page.pageTitle || '(no title)', margin, y); y += 5;

        // Per-page score cards
        var pcw = (W - margin * 2 - 6) / 4;
        SCORE_KEYS.slice(0, 4).forEach(function(sk, i) {
          scoreCard(margin + i * (pcw + 2), y, pcw, sk.label, (page.scores && page.scores[sk.key]) || 0);
        });
        y += 20;

        // Audit sections
        AUDIT_KEYS.forEach(function(ak) {
          var val = page.audit && page.audit[ak.key];
          if (val) { sectionHead(ak.label); bodyText(val); y += 1; }
        });

        // Priority actions
        var priorities = (page.audit && page.audit.priorityActions) || [];
        if (priorities.length) {
          sectionHead('Priority Actions');
          priorities.forEach(function(a, i) {
            if (!a) return;
            var action = typeof a === 'string' ? a : (a.action || '');
            var impact = typeof a === 'object' ? (a.impact || '') : '';
            bodyText((i + 1) + '. ' + action + (impact ? ' [' + impact + ' IMPACT]' : ''));
          });
        }

        // Schema
        var schemaTypes = page.schemaTypes || [];
        var missingSchema = page.missingSchema || [];
        if (schemaTypes.length || missingSchema.length) {
          sectionHead('Schema');
          if (schemaTypes.length) bodyText('Found: ' + schemaTypes.join(', '), [31, 217, 160]);
          if (missingSchema.length) bodyText('Missing: ' + missingSchema.join(', '), [240, 107, 107]);
        }
      });

      doc.save('vetseo-audit-' + (data.domain || 'report') + '.pdf');

    // ── SITEMAP PDF ──────────────────────────────────
    } else if (type === 'sitemap') {
      addHeader('Sitemap Report', (data.domain || '') + ' · ' + new Date().toLocaleDateString());

      var sw = (W - margin * 2 - 6) / 3;
      scoreCard(margin, y, sw, 'Total Pages', data.totalPages || 0);
      scoreCard(margin + sw + 3, y, sw, 'Crawl Depth', data.maxDepth || 0);
      scoreCard(margin + (sw + 3) * 2, y, sw, 'Crawlability', (data.crawlability && data.crawlability.score) || 0);
      y += 22;

      sectionHead('Crawl Summary');
      bodyText('XML Sitemap: ' + (data.hasXMLSitemap ? 'Found (' + (data.xmlSitemapUrlCount || 0) + ' URLs)' : 'Not found'));
      bodyText('robots.txt: ' + (data.hasRobotsTxt ? 'Found' : 'Not found'));
      y += 4;

      sectionHead('URL Strengths');
      bulletList((data.urlAnalysis && data.urlAnalysis.strengths) || [], [31, 217, 160]);
      y += 4;

      sectionHead('URL Issues');
      bulletList((data.urlAnalysis && data.urlAnalysis.issues) || [], [240, 107, 107]);
      y += 4;

      sectionHead('Recommendations');
      bulletList((data.urlAnalysis && data.urlAnalysis.recommendations) || []);
      y += 4;

      // Pages with issues
      var issuePages = (data.pages || []).filter(function(p) { return p && (p.status !== 'ok' || p.isOrphan); });
      if (issuePages.length) {
        doc.addPage(); y = margin;
        sectionHead('Pages Requiring Attention (' + issuePages.length + ')');
        issuePages.forEach(function(p) {
          if (!p) return;
          checkPage(22);
          doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(165, 148, 249);
          doc.text((p.url || '').substring(0, 90), margin, y); y += 4;
          var status = p.isOrphan ? 'ORPHAN' : (p.status || '').toUpperCase();
          bodyText('Status: ' + status, [240, 107, 107]);
          if (p.issue) bodyText(p.issue);
          if (p.recommendation) bodyText('Fix: ' + p.recommendation, [31, 217, 160]);
          y += 3;
        });
      }

      if (data.overallReport) {
        doc.addPage(); y = margin;
        sectionHead('Full Analysis Report');
        bodyText(data.overallReport);
      }

      doc.save('vetseo-sitemap-' + (data.domain || 'report') + '.pdf');

    // ── COMPARE PDF ──────────────────────────────────
    } else if (type === 'compare') {
      var s1 = data.site1 || {}, s2 = data.site2 || {}, cmp = data.comparison || {};
      addHeader('Competitor Comparison', (s1.domain || 'Site 1') + ' vs ' + (s2.domain || 'Site 2'));

      var hw = (W - margin * 2 - 4) / 2;
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(157, 150, 250);
      doc.text((s1.domain || 'Site 1') + (cmp.overallWinner === 'site1' ? ' WINNER' : ''), margin + hw / 2, y, { align: 'center' });
      doc.text((s2.domain || 'Site 2') + (cmp.overallWinner === 'site2' ? ' WINNER' : ''), margin + hw + 4 + hw / 2, y, { align: 'center' });
      y += 7;

      SCORE_KEYS.forEach(function(sk) {
        checkPage(20);
        var v1 = Math.round((s1.siteAverages && s1.siteAverages[sk.key]) || 0);
        var v2 = Math.round((s2.siteAverages && s2.siteAverages[sk.key]) || 0);
        scoreCard(margin, y, hw, sk.label + ' — ' + (s1.domain || 'Site 1'), v1);
        scoreCard(margin + hw + 4, y, hw, sk.label + ' — ' + (s2.domain || 'Site 2'), v2);
        y += 19;
      });
      y += 4;

      sectionHead((s1.domain || 'Site 1') + ' Advantages');
      bulletList(cmp.site1Advantages, [31, 217, 160]);
      y += 3;

      sectionHead((s2.domain || 'Site 2') + ' Advantages');
      bulletList(cmp.site2Advantages, [91, 163, 245]);
      y += 3;

      if (cmp.summary) { sectionHead('Analysis Summary'); bodyText(cmp.summary); }

      if (cmp.recommendations && cmp.recommendations.length) {
        y += 3;
        sectionHead('Recommendations');
        bulletList(cmp.recommendations);
      }

      doc.save('vetseo-compare-' + (s1.domain || 'site1') + '-vs-' + (s2.domain || 'site2') + '.pdf');
    }

  } catch(e) {
    alert('PDF generation failed: ' + e.message);
    console.error('PDF error:', e);
  }
}
