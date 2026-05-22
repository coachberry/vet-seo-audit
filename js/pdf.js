function generatePDF(type, data) {
  if (!window.jspdf) {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = function() { buildPDF(type, data); };
    script.onerror = function() { alert('Could not load PDF library.'); };
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
    var margin = 12;
    var contentW = W - margin * 2;
    var y = margin;

    function newPage() {
      doc.addPage();
      y = margin + 4;
      // subtle page header
      doc.setFontSize(6); doc.setFont('helvetica','normal');
      doc.setTextColor(80,80,100);
      doc.text('VetSEO Auditor — ' + (data.domain || ''), margin, y);
      y += 5;
    }

    function checkPage(needed) {
      if (y + (needed || 8) > H - margin) newPage();
    }

    function drawHeader(title, subtitle) {
      doc.setFillColor(12, 13, 22);
      doc.rect(0, 0, W, 28, 'F');
      doc.setFillColor(108, 99, 245);
      doc.rect(0, 28, W, 1.5, 'F');
      doc.setFontSize(7); doc.setFont('helvetica','normal');
      doc.setTextColor(157, 150, 250);
      doc.text('🐾 VetSEO AUDITOR', W/2, 9, { align:'center' });
      doc.setFontSize(15); doc.setFont('helvetica','bold');
      doc.setTextColor(232, 233, 245);
      doc.text(title, W/2, 18, { align:'center' });
      doc.setFontSize(7.5); doc.setFont('helvetica','normal');
      doc.setTextColor(157, 150, 250);
      doc.text(subtitle || '', W/2, 25, { align:'center' });
      y = 36;
    }

    function sectionTitle(text, color) {
      color = color || [108, 99, 245];
      checkPage(10);
      doc.setFillColor(color[0], color[1], color[2], 0.08);
      doc.roundedRect(margin, y, contentW, 6.5, 1, 1, 'F');
      doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(text.toUpperCase(), margin + 3, y + 4.5);
      y += 9;
    }

    function bodyText(text, opts) {
      if (!text) return;
      opts = opts || {};
      var color = opts.color || [180, 180, 200];
      var size = opts.size || 7.5;
      var indent = opts.indent || 0;
      doc.setFontSize(size); doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setTextColor(color[0], color[1], color[2]);
      var lines = doc.splitTextToSize(String(text), contentW - indent);
      checkPage(lines.length * 3.8 + 1);
      doc.text(lines, margin + indent, y);
      y += lines.length * 3.8 + (opts.gap !== undefined ? opts.gap : 1.5);
    }

    function scoreRow(label, score, x, cy, w) {
      score = Math.round(score || 0);
      var rgb = score >= 80 ? [31,217,160] : score >= 60 ? [245,166,35] : [240,107,107];
      doc.setFillColor(18, 19, 30);
      doc.roundedRect(x, cy, w, 18, 1.5, 1.5, 'F');
      doc.setFontSize(5.5); doc.setTextColor(120,120,150); doc.setFont('helvetica','normal');
      doc.text(label.toUpperCase(), x + w/2, cy + 5, { align:'center', maxWidth: w-2 });
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(String(score), x + w/2, cy + 14, { align:'center' });
    }

    function drawScoreGrid(scores, categories) {
      checkPage(24);
      var cols = Math.min(categories.length, 7);
      var sw = (contentW - (cols-1)*2) / cols;
      categories.forEach(function(cat, i) {
        scoreRow(cat.label, scores[cat.key] || 0, margin + i*(sw+2), y, sw);
      });
      y += 22;
    }

    function signalTable(signals) {
      checkPage(20);
      // Header
      doc.setFillColor(20, 21, 32);
      doc.rect(margin, y, contentW, 6, 'F');
      doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(120,120,155);
      doc.text('SIGNAL', margin+2, y+4);
      doc.text('VALUE', margin+42, y+4);
      doc.text('NOTE', margin+120, y+4);
      doc.text('STATUS', W-margin-10, y+4, {align:'right'});
      y += 7;

      signals.forEach(function(sig) {
        checkPage(7);
        var statusColor = sig.status==='ok' ? [31,217,160] : sig.status==='warn' ? [245,166,35] : sig.status==='error' ? [240,107,107] : [91,163,245];
        var statusIcon = sig.status==='ok' ? '✓' : sig.status==='warn' ? '⚠' : sig.status==='error' ? '✗' : 'ℹ';
        // alternating row bg
        doc.setFillColor(16,17,26);
        doc.rect(margin, y-1, contentW, 6.5, 'F');
        doc.setFontSize(6.5); doc.setFont('helvetica','normal');
        doc.setTextColor(120,120,155);
        doc.text(String(sig.label||''), margin+2, y+3.5, {maxWidth:38});
        doc.setTextColor(200,200,215);
        doc.text(String(sig.value||''), margin+42, y+3.5, {maxWidth:75});
        doc.setTextColor(140,140,160);
        doc.text(String(sig.note||''), margin+120, y+3.5, {maxWidth:35});
        doc.setTextColor(statusColor[0],statusColor[1],statusColor[2]);
        doc.text(statusIcon, W-margin-4, y+3.5, {align:'right'});
        y += 6.5;
      });
      y += 3;
    }

    function auditSection(label, content) {
      if (!content) return;
      checkPage(14);
      doc.setFontSize(7); doc.setFont('helvetica','bold');
      doc.setTextColor(157,150,250);
      doc.text(label.toUpperCase(), margin, y); y += 4;
      bodyText(content, {color:[190,190,210], size:7.5, gap:3});
    }

    function priorityList(priorities) {
      if (!priorities || !priorities.length) return;
      checkPage(12);
      priorities.forEach(function(p, i) {
        if (!p) return;
        var action = typeof p === 'string' ? p : (p.action||'');
        var impact = typeof p === 'object' ? (p.impact||'') : '';
        checkPage(10);
        var impactColor = impact==='HIGH' ? [240,107,107] : impact==='MEDIUM' ? [245,166,35] : [91,163,245];
        doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(200,200,215);
        doc.text((i+1)+'.', margin, y);
        doc.setFont('helvetica','normal');
        var lines = doc.splitTextToSize(action, contentW-10);
        checkPage(lines.length*3.8+5);
        doc.text(lines, margin+6, y);
        y += lines.length*3.8+1;
        if (impact) {
          doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.setTextColor(impactColor[0],impactColor[1],impactColor[2]);
          doc.text(impact+' IMPACT', margin+6, y);
          y += 4;
        }
        y += 1;
      });
    }

    var CATEGORIES = [
      {key:'overallSEO',label:'Overall SEO'},
      {key:'localSEO',label:'Local SEO'},
      {key:'schemaStructuredData',label:'Schema'},
      {key:'geoAIReadiness',label:'GEO & AI'},
      {key:'contentQuality',label:'Content'},
      {key:'technicalSEO',label:'Technical'},
      {key:'eeAt',label:'E-E-A-T'}
    ];

    // ── SINGLE PAGE AUDIT ─────────────────────────────────
    if (type === 'singlepage' || (type === 'audit' && data.pages && data.pages.length === 1 && data.totalPagesCrawled === 1)) {
      var page = (type === 'singlepage') ? data.page : data.pages[0];
      if (!page) { alert('No page data'); return; }

      drawHeader('Page Audit Report', (page.url||'').substring(0,80) + ' · ' + new Date().toLocaleDateString());

      // Scores
      sectionTitle('Page Scores');
      drawScoreGrid(page.scores||{}, CATEGORIES);

      // Flags
      var flags = (page.flags||[]).map(function(f){return f&&f.label||'';}).filter(Boolean);
      if (flags.length) {
        bodyText('Flags: ' + flags.join(' · '), {color:[240,167,107], size:7, gap:3});
      }

      // Raw signals table
      sectionTitle('Raw Page Signals');
      var og = page.og || {};
      var twitter = page.twitter || {};
      var signals = [
        {label:'Title', value:(page.pageTitle||'(none)').substring(0,60), note:(page.titleLength||0)+' chars'+(page.titleLength>60?' — too long':page.titleLength<30?' — too short':' — good'), status:page.pageTitle?(page.titleLength>60?'warn':'ok'):'error'},
        {label:'Meta Description', value:(page.metaDescription||'(none)').substring(0,55), note:(page.metaDescLength||0)+' chars'+(page.metaDescLength>160?' — too long':page.metaDescLength<50?' — too short':' — good'), status:page.metaDescription?(page.metaDescLength>160?'warn':'ok'):'error'},
        {label:'Canonical', value:(page.canonical||'(none)').substring(0,55), note:'', status:page.canonical?'ok':'warn'},
        {label:'Robots Meta', value:page.robotsMeta||'(not set)', note:page.isNoindex?'NOINDEX!':'', status:page.isNoindex?'error':'ok'},
        {label:'H1 Tags', value:((page.h1s||[]).join(', ')||'(none)').substring(0,55), note:(page.h1s||[]).length+' found', status:!page.h1s||page.h1s.length===0?'error':page.h1s.length>1?'warn':'ok'},
        {label:'H2 Tags', value:((page.h2s||[]).slice(0,2).join(', ')||'(none)').substring(0,55), note:(page.h2s||[]).length+' found', status:(page.h2s||[]).length>0?'ok':'warn'},
        {label:'Word Count', value:(page.wordCount||0)+' words', note:(page.wordCount||0)<300?'Thin content':(page.wordCount||0)>=800?'Good':'Acceptable', status:(page.wordCount||0)>=800?'ok':(page.wordCount||0)>=300?'warn':'error'},
        {label:'HTTPS', value:page.hasHttps?'Yes':'No', note:'', status:page.hasHttps?'ok':'error'},
        {label:'Viewport Meta', value:page.hasViewport?'Present':'Missing', note:'', status:page.hasViewport?'ok':'error'},
        {label:'OG Title', value:(og.title||'(none)').substring(0,50), note:'', status:og.title?'ok':'warn'},
        {label:'OG Image', value:og.image?'Present':'Missing', note:'', status:og.image?'ok':'warn'},
        {label:'Twitter Card', value:twitter.card||'Missing', note:'', status:twitter.card?'ok':'warn'},
        {label:'Images w/o Alt', value:(page.imagesWithoutAlt||0)+' of '+(page.images||[]).length, note:'', status:(page.imagesWithoutAlt||0)===0?'ok':'warn'},
        {label:'FAQ Content', value:page.hasFAQContent?'FAQ headings detected':'Not found', note:page.hasFAQContent&&!page.hasFAQSchema?'Missing FAQPage schema!':page.hasFAQSchema?'Schema present':'', status:page.hasFAQContent?(page.hasFAQSchema?'ok':'warn'):'info'},
        {label:'FAQPage Schema', value:page.hasFAQSchema?'Present':'Missing', note:page.hasFAQContent&&!page.hasFAQSchema?'Add JSON-LD for rich snippets':'', status:page.hasFAQSchema?'ok':page.hasFAQContent?'error':'warn'},
        {label:'Phone Numbers', value:((page.phones||[]).join(', ')||'(none)').substring(0,50), note:'', status:(page.phones||[]).length>0?'ok':'warn'},
        {label:'Address Detected', value:page.hasAddress?'Yes':'No', note:'', status:page.hasAddress?'ok':'warn'},
        {label:'Hours Detected', value:page.hasHours?'Yes':'No', note:'', status:page.hasHours?'ok':'warn'}
      ];
      signalTable(signals);

      // Schema
      sectionTitle('Schema / Structured Data');
      var schemaFound = (page.schemaTypes||[]).join(', ') || 'None found';
      var schemaMissing = (page.missingSchema||[]).join(', ') || 'None';
      bodyText('Found: ' + schemaFound, {color:[31,217,160], size:7.5, gap:2});
      bodyText('Missing: ' + schemaMissing, {color:[240,107,107], size:7.5, gap:4});

      // Audit sections
      sectionTitle('Detailed Audit');
      var auditKeys = [
        {key:'urlStructure', label:'URL & Structure'},
        {key:'metadata', label:'Metadata'},
        {key:'openGraph', label:'Open Graph'},
        {key:'schema', label:'Schema / Structured Data'},
        {key:'faqSchema', label:'FAQ Schema'},
        {key:'localSEO', label:'Local SEO & NAP'},
        {key:'contentEEAT', label:'Content & E-E-A-T'},
        {key:'geoAI', label:'GEO & AI Readiness'},
        {key:'technicalSEO', label:'Technical SEO'},
        {key:'internalLinking', label:'Internal Linking'}
      ];
      auditKeys.forEach(function(ak) {
        auditSection(ak.label, page.audit && page.audit[ak.key]);
      });

      // Priority actions
      var priorities = (page.audit && page.audit.priorityActions) || [];
      if (priorities.length) {
        sectionTitle('Priority Actions', [240,107,107]);
        priorityList(priorities);
      }

      doc.save('vetseo-page-audit-' + (data.domain||'report') + '.pdf');

    // ── MULTI-PAGE AUDIT ──────────────────────────────────
    } else if (type === 'audit') {
      drawHeader('SEO Audit Report', (data.domain||'') + ' · ' + new Date().toLocaleDateString());

      sectionTitle('Site-Wide Scores');
      drawScoreGrid(data.siteAverages||{}, CATEGORIES);

      bodyText('Pages analyzed: ' + (data.totalPagesCrawled||0) + ' · Audit date: ' + new Date().toLocaleDateString(), {color:[120,120,155], size:7, gap:4});

      (data.pages||[]).forEach(function(page) {
        if (!page) return;
        doc.addPage(); y = margin;

        // Page URL bar
        doc.setFillColor(18,19,30);
        doc.roundedRect(margin, y, contentW, 8, 1, 1, 'F');
        doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(157,150,250);
        doc.text((page.url||'').substring(0,90), margin+3, y+5.5, {maxWidth:contentW-6});
        y += 11;
        doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(120,120,155);
        doc.text(page.pageTitle||'(no title)', margin, y); y += 5;

        var cols = 4;
        var sw2 = (contentW-(cols-1)*2)/cols;
        CATEGORIES.slice(0,4).forEach(function(cat,i) {
          scoreRow(cat.label, (page.scores&&page.scores[cat.key])||0, margin+i*(sw2+2), y, sw2);
        });
        y += 22;

        var auditKeys2 = [
          {key:'urlStructure',label:'URL & Structure'},
          {key:'metadata',label:'Metadata'},
          {key:'openGraph',label:'Open Graph'},
          {key:'schema',label:'Schema'},
          {key:'faqSchema',label:'FAQ Schema'},
          {key:'localSEO',label:'Local SEO'},
          {key:'contentEEAT',label:'Content & E-E-A-T'},
          {key:'geoAI',label:'GEO & AI'},
          {key:'technicalSEO',label:'Technical SEO'},
          {key:'internalLinking',label:'Internal Linking'}
        ];
        auditKeys2.forEach(function(ak) {
          auditSection(ak.label, page.audit&&page.audit[ak.key]);
        });

        var prios = (page.audit&&page.audit.priorityActions)||[];
        if (prios.length) {
          sectionTitle('Priority Actions',[240,107,107]);
          priorityList(prios);
        }

        var sf = (page.schemaTypes||[]).join(', ');
        var sm = (page.missingSchema||[]).join(', ');
        if (sf||sm) {
          sectionTitle('Schema');
          if (sf) bodyText('Found: '+sf,{color:[31,217,160],size:7,gap:2});
          if (sm) bodyText('Missing: '+sm,{color:[240,107,107],size:7,gap:2});
        }
      });

      doc.save('vetseo-audit-'+(data.domain||'report')+'.pdf');

    // ── OVERVIEW PDF ──────────────────────────────────────
    } else if (type === 'overview') {
      drawHeader('SEO Overview Report', (data.domain||'') + ' · ' + new Date().toLocaleDateString());

      sectionTitle('Site-Wide Scores');
      drawScoreGrid(data.scores||{}, CATEGORIES);

      var cs = data.crawlStats||{};
      sectionTitle('Site Signal Stats');
      var statLines = [
        'Total Pages: '+( cs.totalPages||0)+'  ·  Service Pages: '+(cs.servicePageCount||0)+'  ·  Blog Posts: '+(cs.blogPageCount||0),
        'Pages with Schema: '+(cs.pagesWithSchema||0)+'  ·  Avg Word Count: '+(cs.avgWordCount||0)+'  ·  Thin Content: '+(cs.thinContentPages||0)+' pages',
        'Orphan Pages: '+(cs.orphanPages||0)+'  ·  Missing H1: '+(cs.pagesNoH1||0)+'  ·  No Meta Desc: '+(cs.pagesNoMeta||0),
        'XML Sitemap: '+(data.hasXMLSitemap?'Found':'Missing')+'  ·  robots.txt: '+(data.hasRobotsTxt?'Found':'Missing'),
        'Schema Types Found: '+((cs.schemaTypesFound||[]).join(', ')||'None')
      ];
      statLines.forEach(function(l) { bodyText(l,{color:[160,160,190],size:7.5,gap:2}); });
      y+=3;

      sectionTitle('Overall Findings');
      bodyText(data.overallFindings,{color:[190,190,215],gap:4});

      sectionTitle('Top Priorities',[240,107,107]);
      priorityList(data.topPriorities||[]);

      var quickWins = data.quickWins||[];
      if (quickWins.length) {
        sectionTitle('Quick Wins',[31,217,160]);
        quickWins.forEach(function(w){bodyText('• '+w,{color:[31,217,160],size:7.5,gap:2});});
        y+=3;
      }

      // 30/60/90 day plan
      sectionTitle('30 / 60 / 90 Day Action Plan');
      if ((data.thirtyDayPlan||[]).length) {
        bodyText('FIRST 30 DAYS',{color:[31,217,160],size:7,bold:true,gap:2});
        (data.thirtyDayPlan||[]).forEach(function(a){bodyText('• '+a,{color:[190,190,215],size:7.5,gap:1.5});});
        y+=3;
      }
      if ((data.sixtyDayPlan||[]).length) {
        bodyText('DAYS 31–60',{color:[245,166,35],size:7,bold:true,gap:2});
        (data.sixtyDayPlan||[]).forEach(function(a){bodyText('• '+a,{color:[190,190,215],size:7.5,gap:1.5});});
        y+=3;
      }
      if ((data.ninetyDayPlan||[]).length) {
        bodyText('DAYS 61–90',{color:[91,163,245],size:7,bold:true,gap:2});
        (data.ninetyDayPlan||[]).forEach(function(a){bodyText('• '+a,{color:[190,190,215],size:7.5,gap:1.5});});
        y+=3;
      }

      sectionTitle('Local SEO Strategy',[91,163,245]);
      bodyText(data.localSEOFindings,{color:[190,190,215],gap:4});

      sectionTitle('Content Strategy',[31,217,160]);
      bodyText(data.contentStrategy,{color:[190,190,215],gap:4});

      sectionTitle('Schema Strategy',[245,166,35]);
      bodyText(data.schemaStrategy,{color:[190,190,215],gap:4});

      sectionTitle('GEO & AI Strategy',[220,100,220]);
      bodyText(data.geoAIStrategy,{color:[190,190,215],gap:4});

      doc.save('vetseo-overview-'+(data.domain||'report')+'.pdf');

    // ── SITEMAP PDF ───────────────────────────────────────
    } else if (type === 'sitemap') {
      drawHeader('Sitemap Report', (data.domain||'') + ' · ' + new Date().toLocaleDateString());

      sectionTitle('Sitemap Overview');
      var cs2 = Math.round((data.crawlability&&data.crawlability.score)||0);
      bodyText('Total Pages: '+(data.totalPages||0)+'  ·  Crawl Depth: '+(data.maxDepth||0)+'  ·  Crawlability Score: '+cs2+'/100',{color:[160,160,190],size:8,gap:2});
      bodyText('XML Sitemap: '+(data.hasXMLSitemap?'Found ('+( data.xmlSitemapUrlCount||0)+' URLs)':'Missing')+'  ·  robots.txt: '+(data.hasRobotsTxt?'Found':'Missing'),{color:[160,160,190],size:8,gap:4});

      var strengths = (data.urlAnalysis&&data.urlAnalysis.strengths)||[];
      var issues = (data.urlAnalysis&&data.urlAnalysis.issues)||[];
      var recs = (data.urlAnalysis&&data.urlAnalysis.recommendations)||[];

      if (strengths.length) {
        sectionTitle('URL Strengths',[31,217,160]);
        strengths.forEach(function(s){bodyText('✓ '+s,{color:[31,217,160],size:7.5,gap:2});});
        y+=2;
      }
      if (issues.length) {
        sectionTitle('URL Issues',[240,107,107]);
        issues.forEach(function(s){bodyText('⚠ '+s,{color:[240,107,107],size:7.5,gap:2});});
        y+=2;
      }
      if (recs.length) {
        sectionTitle('Recommendations');
        recs.forEach(function(s){bodyText('• '+s,{color:[190,190,215],size:7.5,gap:2});});
        y+=2;
      }
      if (data.overallReport) {
        sectionTitle('Full Analysis');
        bodyText(data.overallReport,{color:[190,190,215],gap:3});
      }

      // Pages with issues
      var issuePages = (data.pages||[]).filter(function(p){return p&&(p.status!=='ok'||p.isOrphan);});
      if (issuePages.length) {
        sectionTitle('Pages With Issues ('+ issuePages.length+')');
        issuePages.forEach(function(p) {
          if (!p) return;
          checkPage(18);
          doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(157,150,250);
          doc.text((p.url||'').substring(0,90), margin, y); y+=4;
          var st = p.isOrphan?'ORPHAN':(p.status||'').toUpperCase();
          bodyText('Status: '+st+( p.issue?' — '+p.issue:''),{color:[240,107,107],size:7,gap:1.5});
          if (p.recommendation) bodyText('Fix: '+p.recommendation,{color:[31,217,160],size:7,gap:3});
        });
      }

      doc.save('vetseo-sitemap-'+(data.domain||'report')+'.pdf');
    }

  } catch(e) {
    alert('PDF error: ' + e.message);
    console.error('PDF error:', e);
  }
}
