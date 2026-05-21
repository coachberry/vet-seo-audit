// ═══════════════════════════════════════════════════
//  app.js — VetSEO Auditor Frontend
// ═══════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig, FUNCTIONS_BASE_URL } from "./firebase-config.js";

// ── Init Firebase ──────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── State ──────────────────────────────────────────
let lastAuditData = null;
let lastSitemapData = null;
let lastCompareData = null;

// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
window.showView = function(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view' + capitalize(name)).classList.add('active');
  document.getElementById('nav' + capitalize(name)).classList.add('active');
  if (name === 'history') loadHistory();
};

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ══════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════
function getVal(id) { return document.getElementById(id)?.value.trim() || ''; }

function validUrl(v) {
  try { new URL(v); return v; } catch { return null; }
}

function scoreColor(n) {
  if (n >= 80) return 'var(--green)';
  if (n >= 55) return 'var(--amber)';
  return 'var(--red)';
}

function scoreClass(n) {
  if (n >= 80) return 'green';
  if (n >= 55) return 'amber';
  return 'red';
}

function scoreGrade(n) {
  if (n >= 90) return 'A+';
  if (n >= 80) return 'A';
  if (n >= 70) return 'B';
  if (n >= 60) return 'C';
  if (n >= 50) return 'D';
  return 'F';
}

function setDisabled(ids, d) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = d; });
}

function setLoading(outputId, label, steps) {
  let si = 0;
  document.getElementById(outputId).innerHTML = `
    <div class="loader-wrap">
      <div class="loader-spinner"></div>
      <div class="loader-label">${label}</div>
      <div class="loader-step" id="loadStep">${steps[0]}</div>
      <div class="loader-progress"><div class="loader-progress-fill" id="loadProgress" style="width:5%"></div></div>
      <div class="loader-pages" id="loadPages"></div>
    </div>`;
  const iv = setInterval(() => {
    si = (si + 1) % steps.length;
    const el = document.getElementById('loadStep');
    const prog = document.getElementById('loadProgress');
    if (el) el.textContent = steps[si];
    if (prog) prog.style.width = Math.min(90, 5 + (si / steps.length) * 85) + '%';
    else clearInterval(iv);
  }, 2800);
  return iv;
}

function finishLoading(iv) {
  clearInterval(iv);
  const prog = document.getElementById('loadProgress');
  if (prog) prog.style.width = '100%';
}

window.toggleCard = function(header) {
  const body = header.nextElementSibling;
  if (!body) return;
  body.classList.toggle('open');
  header.classList.toggle('expanded');
};

// ══════════════════════════════════════════════════
//  CALL CLOUD FUNCTION
// ══════════════════════════════════════════════════
async function callFunction(endpoint, payload) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Function error ${res.status}`);
  }
  return res.json();
}

// ══════════════════════════════════════════════════
//  FIRESTORE — SAVE & LOAD
// ══════════════════════════════════════════════════
async function saveToFirestore(type, domain, data) {
  try {
    await addDoc(collection(db, 'audits'), {
      type,
      domain,
      createdAt: new Date().toISOString(),
      data
    });
  } catch (e) {
    console.warn('Firestore save failed:', e.message);
  }
}

async function loadHistory() {
  const out = document.getElementById('historyOutput');
  try {
    const q = query(collection(db, 'audits'), orderBy('createdAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    if (snap.empty) {
      out.innerHTML = '<div class="empty-state">No audit history yet. Run your first audit above.</div>';
      return;
    }
    const cards = snap.docs.map(d => {
      const item = d.data();
      const date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="history-card" onclick="loadHistoryItem('${d.id}','${item.type}')">
        <div class="history-domain">${item.domain}</div>
        <span class="history-type">${item.type}</span>
        <div class="history-date">${date}</div>
        <span style="color:var(--muted);font-size:.75rem">→</span>
      </div>`;
    }).join('');
    out.innerHTML = `<div class="section-title">Recent Audits</div>${cards}`;
  } catch (e) {
    out.innerHTML = `<div class="error-msg">Could not load history: ${e.message}</div>`;
  }
}

window.loadHistoryItem = async function(id, type) {
  try {
    const snap = await getDoc(doc(db, 'audits', id));
    if (!snap.exists()) return;
    const item = snap.data();
    if (type === 'audit') { lastAuditData = item.data; showView('audit'); renderAudit(item.data); }
    else if (type === 'sitemap') { lastSitemapData = item.data; showView('sitemap'); renderSitemap(item.data); }
    else if (type === 'compare') { lastCompareData = item.data; showView('compare'); renderCompare(item.data); }
  } catch (e) {
    alert('Could not load audit: ' + e.message);
  }
};

// ══════════════════════════════════════════════════
//  SEO AUDIT
// ══════════════════════════════════════════════════
const SCORE_KEYS = [
  { key: 'overallSEO', label: 'Overall SEO' },
  { key: 'localSEO', label: 'Local SEO' },
  { key: 'schemaStructuredData', label: 'Schema / Structured Data' },
  { key: 'geoAIReadiness', label: 'GEO & AI Readiness' },
  { key: 'contentQuality', label: 'Content Quality' },
  { key: 'technicalSEO', label: 'Technical SEO' },
  { key: 'eeAt', label: 'E-E-A-T' }
];

const AUDIT_KEYS = [
  { key: 'urlStructure', label: 'URL & Structure' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'openGraph', label: 'Open Graph' },
  { key: 'schema', label: 'Schema / Structured Data' },
  { key: 'faqSchema', label: 'FAQ Schema' },
  { key: 'localSEO', label: 'Local SEO & NAP' },
  { key: 'contentEEAT', label: 'Content & E-E-A-T' },
  { key: 'geoAI', label: 'GEO & AI Readiness' },
  { key: 'technicalSEO', label: 'Technical SEO' },
  { key: 'internalLinking', label: 'Internal Linking' }
];

window.runAudit = async function() {
  const url = validUrl(getVal('auditUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  const pageLimit = parseInt(getVal('pageLimit')) || 50;
  const crawlSubpages = document.getElementById('crawlSubpages')?.checked ?? true;

  setDisabled(['auditBtn'], true);
  const iv = setLoading('auditOutput', 'CRAWLING & AUDITING', [
    'Fetching homepage HTML...',
    'Discovering all pages...',
    'Crawling internal links...',
    'Parsing meta tags & schema...',
    'Analyzing Open Graph data...',
    'Checking structured data...',
    'Evaluating content & E-E-A-T...',
    'Scoring GEO & AI readiness...',
    'Building recommendations...',
    'Generating full report...'
  ]);

  try {
    const data = await callFunction('auditSite', { url, pageLimit, crawlSubpages });
    finishLoading(iv);
    lastAuditData = data;
    await saveToFirestore('audit', data.domain, data);
    renderAudit(data);
  } catch (e) {
    finishLoading(iv);
    document.getElementById('auditOutput').innerHTML = `<div class="error-msg">❌ ${e.message}</div>`;
  }
  setDisabled(['auditBtn'], false);
};

function renderAudit(data, sortBy = 'overallSEO', sortDir = 'desc', minScore = 0, filterKey = 'all') {
  const avg = data.siteAverages || {};

  const avgCards = SCORE_KEYS.map(({ key, label }) => {
    const v = Math.round(avg[key] || 0);
    return `<div class="score-card">
      <div class="score-label">${label}</div>
      <div class="score-num" style="color:${scoreColor(v)}">${v}</div>
      <div class="score-bar"><div class="score-fill" style="width:${v}%;background:${scoreColor(v)}"></div></div>
      <div class="score-grade ${scoreClass(v)}">${scoreGrade(v)}</div>
    </div>`;
  }).join('');

  let pages = [...(data.pages || [])];
  if (filterKey !== 'all') pages = pages.filter(p => (p.scores?.[filterKey] || 0) < 70);
  pages = pages.filter(p => (p.scores?.overallSEO || 0) >= minScore);
  if (sortDir === 'desc') pages.sort((a, b) => (b.scores?.[sortBy] || 0) - (a.scores?.[sortBy] || 0));
  else pages.sort((a, b) => (a.scores?.[sortBy] || 0) - (b.scores?.[sortBy] || 0));

  const sortOpts = SCORE_KEYS.map(({ key, label }) => `<option value="${key}" ${sortBy === key ? 'selected' : ''}>${label}</option>`).join('');
  const filterOpts = `<option value="all">All pages</option>` + SCORE_KEYS.map(({ key, label }) => `<option value="${key}" ${filterKey === key ? 'selected' : ''}>Low ${label}</option>`).join('');

  const pageCards = pages.map(page => buildPageCard(page)).join('');

  document.getElementById('auditOutput').innerHTML = `
    <div class="info-msg">✓ Real crawl complete — ${data.totalPagesCrawled || 0} pages analyzed from ${data.domain}</div>
    <div class="top-actions">
      <button class="btn btn-export" onclick="exportAuditPDF()">↓ EXPORT PDF</button>
      <div class="spacer"></div>
    </div>
    <div class="section-title">Site-Wide Score Summary — ${data.domain}</div>
    <div class="score-grid">${avgCards}</div>
    <div class="section-title">Page-by-Page Audit</div>
    <div class="filter-bar">
      <span class="filter-label">SORT BY</span>
      <select class="filter-select" onchange="applyAuditFilters()" id="sortKey">${sortOpts}</select>
      <select class="filter-select" onchange="applyAuditFilters()" id="sortDir">
        <option value="desc" ${sortDir === 'desc' ? 'selected' : ''}>High → Low</option>
        <option value="asc" ${sortDir === 'asc' ? 'selected' : ''}>Low → High</option>
      </select>
      <div class="filter-sep"></div>
      <span class="filter-label">SHOW</span>
      <select class="filter-select" onchange="applyAuditFilters()" id="filterKey">${filterOpts}</select>
      <div class="filter-sep"></div>
      <div class="score-range-wrap">
        <span>Min score:</span>
        <input type="range" min="0" max="100" step="5" value="${minScore}" id="minScore"
          oninput="document.getElementById('minScoreVal').textContent=this.value;applyAuditFilters()"/>
        <span id="minScoreVal">${minScore}</span>
      </div>
      <div class="filter-sep"></div>
      <span class="page-count-badge">${pages.length} / ${data.pages?.length || 0} pages</span>
      <button class="btn btn-ghost btn-sm" onclick="resetAuditFilters()">RESET</button>
    </div>
    ${pageCards || '<div class="empty-state">No pages match current filters.</div>'}
  `;
}

function buildPageCard(page) {
  const s = page.scores || {};
  const miniScores = SCORE_KEYS.slice(0, 4).map(({ key, label }) => {
    const v = Math.round(s[key] || 0);
    const short = label.split(' ')[0];
    return `<span class="mini-score ${scoreClass(v)}" style="border-color:${scoreColor(v)};background:${scoreColor(v)}15">${short}: ${v}</span>`;
  }).join('');

  const flags = (page.flags || []).map(f => `<span class="flag flag-${f.type}">${f.label}</span>`).join('');
  const schemaFound = (page.schemaTypes || []).map(s => `<span class="schema-badge">${s}</span>`).join('');
  const schemaMissing = (page.missingSchema || []).map(s => `<span class="schema-badge missing">Missing: ${s}</span>`).join('');

  const auditSections = AUDIT_KEYS.map(({ key, label }) => {
    const val = page.audit?.[key] || '';
    return `<div class="audit-section">
      <div class="audit-section-title">${label}</div>
      <div class="audit-section-body">${val}</div>
    </div>`;
  }).join('');

  const priorities = page.audit?.priorityActions || [];
  const priorityHTML = priorities.length ? `
    <div class="priority-box">
      <div class="priority-box-title">⚡ Priority Actions</div>
      ${priorities.map((a, i) => `
        <div class="priority-item">
          <span class="priority-num">${i + 1}.</span>
          <div>
            <div class="priority-text">${a.action}</div>
            <span class="priority-impact impact-${a.impact?.toLowerCase() || 'med'}">${a.impact || 'MEDIUM'} IMPACT</span>
          </div>
        </div>`).join('')}
    </div>` : '';

  const schemaSection = (schemaFound || schemaMissing) ? `
    <div class="audit-section" style="grid-column:1/-1">
      <div class="audit-section-title">Schema Found / Missing</div>
      <div class="schema-badges">${schemaFound}${schemaMissing}</div>
    </div>` : '';

  return `<div class="page-card">
    <div class="page-card-header" onclick="toggleCard(this)">
      <div class="page-meta">
        <div class="page-url">${page.url}</div>
        <div class="page-title-sub">${page.pageTitle || '(no title)'}</div>
        <div class="page-flags">${flags}</div>
      </div>
      <div class="page-scores-mini">${miniScores}</div>
      <span class="arrow-icon">▸</span>
    </div>
    <div class="page-card-body">
      <div class="audit-grid">
        ${auditSections}
        ${schemaSection}
      </div>
      ${priorityHTML}
    </div>
  </div>`;
}

window.applyAuditFilters = function() {
  if (!lastAuditData) return;
  renderAudit(
    lastAuditData,
    document.getElementById('sortKey')?.value || 'overallSEO',
    document.getElementById('sortDir')?.value || 'desc',
    parseInt(document.getElementById('minScore')?.value || 0),
    document.getElementById('filterKey')?.value || 'all'
  );
};

window.resetAuditFilters = function() {
  if (lastAuditData) renderAudit(lastAuditData);
};

// ══════════════════════════════════════════════════
//  SITEMAP
// ══════════════════════════════════════════════════
window.runSitemap = async function() {
  const url = validUrl(getVal('sitemapUrl'));
  if (!url) { alert('Please enter a valid URL'); return; }
  setDisabled(['sitemapBtn'], true);
  const iv = setLoading('sitemapOutput', 'BUILDING SITEMAP', [
    'Fetching root page...',
    'Following internal links...',
    'Checking robots.txt & XML sitemap...',
    'Detecting noindex / nofollow pages...',
    'Identifying orphaned pages...',
    'Mapping URL hierarchy...',
    'Analyzing structure...',
    'Building recommendations...'
  ]);
  try {
    const data = await callFunction('buildSitemap', { url });
    finishLoading(iv);
    lastSitemapData = data;
    await saveToFirestore('sitemap', data.domain, data);
    renderSitemap(data);
  } catch (e) {
    finishLoading(iv);
    document.getElementById('sitemapOutput').innerHTML = `<div class="error-msg">❌ ${e.message}</div>`;
  }
  setDisabled(['sitemapBtn'], false);
};

function renderSitemap(data) {
  const cs = Math.round(data.crawlability?.score || 0);
  const pagesWithIssues = (data.pages || []).filter(p => p.status !== 'ok');

  function renderTree(nodes, depth = 0) {
    if (!nodes?.length) return '';
    return nodes.map(n => {
      const indent = '  '.repeat(depth);
      const prefix = depth === 0 ? '' : indent + (n.children?.length ? '├─ ' : '└─ ');
      const statusCls = `status-${n.status || 'ok'}`;
      const statusLabel = {
        ok: 'OK', noindex: 'NOINDEX', orphan: 'ORPHAN',
        redirect: 'REDIRECT', error: 'ERROR'
      }[n.status || 'ok'] || n.status?.toUpperCase();

      return `<div class="sitemap-node" style="padding-left:${depth * 14}px">
        <span class="node-prefix" style="font-size:.7rem">${prefix}</span>
        <a class="node-url" href="${n.url}" target="_blank" rel="noopener">${n.label || n.url}</a>
        <span class="node-status ${statusCls}">${statusLabel}</span>
        ${n.type ? `<span class="node-type flag flag-info">${n.type}</span>` : ''}
      </div>` + (n.children ? renderTree(n.children, depth + 1) : '');
    }).join('');
  }

  const issueCards = pagesWithIssues.length ? `
    <div class="section-title">Pages Requiring Attention (${pagesWithIssues.length})</div>
    ${pagesWithIssues.map(p => `
      <div class="page-card">
        <div class="page-card-header" onclick="toggleCard(this)">
          <div class="page-meta">
            <div class="page-url">${p.url}</div>
            <div class="page-title-sub">${p.pageTitle || ''}</div>
          </div>
          <span class="flag flag-${p.status === 'noindex' ? 'warn' : p.status === 'error' ? 'error' : 'info'}">${p.status?.toUpperCase()}</span>
          <span class="arrow-icon">▸</span>
        </div>
        <div class="page-card-body">
          <div class="prose"><p>${p.issue || 'Review this page for crawlability and indexation issues.'}</p></div>
          <div class="priority-box">
            <div class="priority-box-title">Recommendation</div>
            <div class="prose"><p>${p.recommendation || ''}</p></div>
          </div>
        </div>
      </div>`).join('')}` : '';

  document.getElementById('sitemapOutput').innerHTML = `
    <div class="info-msg">✓ Real crawl complete — ${data.totalPages || 0} pages discovered on ${data.domain}</div>
    <div class="top-actions">
      <button class="btn btn-export" onclick="exportSitemapPDF()">↓ EXPORT PDF</button>
    </div>
    <div class="section-title">Sitemap Overview — ${data.domain}</div>
    <div class="score-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="score-card"><div class="score-label">Total Pages</div><div class="score-num" style="color:var(--accent2)">${data.totalPages || 0}</div></div>
      <div class="score-card"><div class="score-label">Crawl Depth</div><div class="score-num" style="color:var(--blue)">${data.maxDepth || 0}</div></div>
      <div class="score-card"><div class="score-label">Crawlability</div><div class="score-num" style="color:${scoreColor(cs)}">${cs}</div><div class="score-bar"><div class="score-fill" style="width:${cs}%;background:${scoreColor(cs)}"></div></div></div>
      <div class="score-card"><div class="score-label">Issues Found</div><div class="score-num" style="color:${pagesWithIssues.length > 0 ? 'var(--red)' : 'var(--green)'}">${pagesWithIssues.length}</div></div>
    </div>

    <div class="page-card" style="margin-bottom:.75rem">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--accent2)">🗺 FULL SITEMAP TREE — Visitor & Crawler View</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open">
        <div style="font-family:'DM Mono',monospace;font-size:.7rem;color:var(--muted);margin-bottom:.65rem">
          <span class="flag flag-ok">OK</span> Indexed &nbsp;
          <span class="flag flag-warn">NOINDEX</span> Hidden from search &nbsp;
          <span class="flag flag-info">ORPHAN</span> No inbound links &nbsp;
          <span class="flag flag-error">ERROR</span> Broken &nbsp;
          <span class="flag flag-warn">REDIRECT</span> Redirected
        </div>
        <div class="sitemap-wrapper"><div class="sitemap-tree">${renderTree(data.sitemapTree || [])}</div></div>
      </div>
    </div>

    ${issueCards}

    <div class="page-card" style="margin-bottom:.75rem">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--green)">✦ URL STRENGTHS</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open">
        <ul style="padding-left:1.1rem;font-size:.86rem;line-height:2.1">
          ${(data.urlAnalysis?.strengths || []).map(s => `<li class="green">${s}</li>`).join('')}
        </ul>
      </div>
    </div>

    <div class="page-card" style="margin-bottom:.75rem">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--red)">⚠ URL ISSUES</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open">
        <ul style="padding-left:1.1rem;font-size:.86rem;line-height:2.1">
          ${(data.urlAnalysis?.issues || []).map(s => `<li class="red">${s}</li>`).join('')}
        </ul>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--blue)">📊 FULL ANALYSIS REPORT</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open">
        <div class="prose">${(data.overallReport || '').split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  COMPARE
// ══════════════════════════════════════════════════
window.runCompare = async function() {
  const u1 = validUrl(getVal('compare1Url'));
  const u2 = validUrl(getVal('compare2Url'));
  if (!u1 || !u2) { alert('Please enter two valid URLs'); return; }
  setDisabled(['compareBtn'], true);
  const iv = setLoading('compareOutput', 'COMPARING SITES', [
    `Crawling ${u1}...`,
    `Crawling ${u2}...`,
    'Parsing schema & metadata for both...',
    'Scoring all categories...',
    'Building competitive analysis...'
  ]);
  try {
    const data = await callFunction('compareSites', { url1: u1, url2: u2 });
    finishLoading(iv);
    lastCompareData = data;
    await saveToFirestore('compare', `${data.site1?.domain} vs ${data.site2?.domain}`, data);
    renderCompare(data);
  } catch (e) {
    finishLoading(iv);
    document.getElementById('compareOutput').innerHTML = `<div class="error-msg">❌ ${e.message}</div>`;
  }
  setDisabled(['compareBtn'], false);
};

function renderCompare(data) {
  const s1 = data.site1 || {}, s2 = data.site2 || {}, cmp = data.comparison || {};
  const w = cmp.overallWinner;

  const scoreRows = SCORE_KEYS.map(({ key, label }) => {
    const v1 = Math.round(s1.siteAverages?.[key] || 0);
    const v2 = Math.round(s2.siteAverages?.[key] || 0);
    const winner = cmp.categoryWinners?.[key];
    return `<div class="cst-row ${winner === 'site1' ? 'winner-col' : ''}">
      <span class="cst-key">${label}</span>
      <span class="cst-val" style="color:${scoreColor(v1)}">${v1}${winner === 'site1' ? '<span class="winner-badge">WINNER</span>' : ''}</span>
      <span class="cst-val" style="color:${scoreColor(v2)}">${v2}${winner === 'site2' ? '<span class="winner-badge">WINNER</span>' : ''}</span>
    </div>`;
  }).join('');

  const s1Pages = (s1.pages || []).map(p => buildPageCard(p)).join('');
  const s2Pages = (s2.pages || []).map(p => buildPageCard(p)).join('');

  document.getElementById('compareOutput').innerHTML = `
    <div class="top-actions">
      <button class="btn btn-export" onclick="exportComparePDF()">↓ EXPORT PDF</button>
    </div>

    <div class="compare-header-grid">
      <div class="compare-col-label">${s1.domain || 'Site 1'} ${w === 'site1' ? '🏆' : ''}</div>
      <div class="compare-vs">VS</div>
      <div class="compare-col-label">${s2.domain || 'Site 2'} ${w === 'site2' ? '🏆' : ''}</div>
    </div>

    <div class="compare-score-table">
      <div class="cst-header">
        <span>Category</span>
        <span>${s1.domain || 'Site 1'}</span>
        <span>${s2.domain || 'Site 2'}</span>
      </div>
      ${scoreRows}
    </div>

    <div class="audit-grid" style="margin-bottom:1.5rem">
      <div class="page-card" style="margin:0">
        <div class="page-card-header expanded" onclick="toggleCard(this)">
          <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--green)">✦ ${s1.domain} Advantages</span>
          <span class="arrow-icon" style="margin-left:auto">▾</span>
        </div>
        <div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">${(cmp.site1Advantages || []).map(a => `<li class="green">${a}</li>`).join('')}</ul></div>
      </div>
      <div class="page-card" style="margin:0">
        <div class="page-card-header expanded" onclick="toggleCard(this)">
          <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--blue)">✦ ${s2.domain} Advantages</span>
          <span class="arrow-icon" style="margin-left:auto">▾</span>
        </div>
        <div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">${(cmp.site2Advantages || []).map(a => `<li class="blue">${a}</li>`).join('')}</ul></div>
      </div>
    </div>

    <div class="page-card" style="margin-bottom:.75rem">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--accent2)">📊 Competitive Analysis</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open"><div class="prose">${(cmp.summary || '').split('\n\n').map(p => `<p>${p}</p>`).join('')}</div></div>
    </div>

    <div class="page-card" style="margin-bottom:1.75rem">
      <div class="page-card-header expanded" onclick="toggleCard(this)">
        <span style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--accent2)">🔧 Recommendations to Close the Gap</span>
        <span class="arrow-icon" style="margin-left:auto">▾</span>
      </div>
      <div class="page-card-body open"><ul style="padding-left:1.1rem;font-size:.86rem;line-height:2">${(cmp.recommendations || []).map(r => `<li style="color:var(--text)">${r}</li>`).join('')}</ul></div>
    </div>

    <div class="audit-grid" style="align-items:start">
      <div><div class="section-title" style="font-size:1rem">${s1.domain} — Page Audits</div>${s1Pages}</div>
      <div><div class="section-title" style="font-size:1rem">${s2.domain} — Page Audits</div>${s2Pages}</div>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  PDF EXPORTS
// ══════════════════════════════════════════════════
function loadJsPDF() {
  return new Promise((resolve) => {
    if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    document.head.appendChild(s);
  });
}

async function pdfBase(title, subtitle) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(7, 8, 15); doc.rect(0, 0, W, 34, 'F');
  doc.setTextColor(157, 150, 250); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('🐾 VetSEO AUDITOR', W / 2, 11, { align: 'center' });
  doc.setTextColor(232, 233, 245); doc.setFontSize(17); doc.setFont('helvetica', 'bold');
  doc.text(title, W / 2, 22, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(126, 128, 160);
  doc.text(subtitle, W / 2, 30, { align: 'center' });
  return { doc, W, H: doc.internal.pageSize.getHeight(), y: 42, margin: 13 };
}

function pdfScoreCard(doc, x, y, w, label, score) {
  const c = score >= 80 ? [31, 217, 160] : score >= 55 ? [245, 166, 35] : [240, 107, 107];
  doc.setFillColor(15, 16, 24); doc.roundedRect(x, y, w, 18, 2, 2, 'F');
  doc.setFontSize(6); doc.setTextColor(126, 128, 160); doc.setFont('helvetica', 'normal');
  doc.text(label.toUpperCase(), x + w / 2, y + 5.5, { align: 'center', maxWidth: w - 2 });
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...c);
  doc.text(String(score), x + w / 2, y + 14, { align: 'center' });
}

function pdfCheckPage(doc, y, H, margin) {
  if (y > H - margin - 10) { doc.addPage(); return margin + 10; }
  return y;
}

function pdfText(doc, x, y, text, W, margin, color = [200, 200, 210], size = 8) {
  doc.setFontSize(size); doc.setTextColor(...color); doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(text, W - margin * 2 - x + margin);
  doc.text(lines, x, y);
  return y + lines.length * (size * 0.42) + 3;
}

window.exportAuditPDF = async function() {
  if (!lastAuditData) { alert('Run an audit first'); return; }
  const d = lastAuditData;
  let { doc, W, H, y, margin } = await pdfBase('SEO Audit Report', d.domain + ' · ' + new Date().toLocaleDateString());
  const cw = (W - margin * 2 - (SCORE_KEYS.length - 1) * 2) / SCORE_KEYS.length;
  SCORE_KEYS.forEach(({ key, label }, i) => pdfScoreCard(doc, margin + i * (cw + 2), y, cw, label, Math.round(d.siteAverages?.[key] || 0)));
  y += 22;
  for (const page of (d.pages || [])) {
    doc.addPage(); y = margin + 10;
    doc.setFillColor(15, 16, 24); doc.roundedRect(margin, y, W - margin * 2, 9, 1, 1, 'F');
    doc.setFontSize(7.5); doc.setTextColor(157, 150, 250); doc.setFont('helvetica', 'bold');
    doc.text(page.url, margin + 2, y + 6, { maxWidth: W - margin * 2 - 4 }); y += 12;
    const pcw = (W - margin * 2 - 6) / 4;
    SCORE_KEYS.slice(0, 4).forEach(({ key, label }, i) => pdfScoreCard(doc, margin + i * (pcw + 2), y, pcw, label, Math.round(page.scores?.[key] || 0)));
    y += 22;
    for (const { key, label } of AUDIT_KEYS) {
      y = pdfCheckPage(doc, y, H, margin);
      doc.setFontSize(7); doc.setTextColor(157, 150, 250); doc.setFont('helvetica', 'bold');
      doc.text(label.toUpperCase(), margin, y); y += 4;
      y = pdfText(doc, margin, y, page.audit?.[key] || 'N/A', W, margin);
    }
    if (page.audit?.priorityActions?.length) {
      y = pdfCheckPage(doc, y, H, margin);
      doc.setFontSize(7); doc.setTextColor(157, 150, 250); doc.setFont('helvetica', 'bold');
      doc.text('PRIORITY ACTIONS', margin, y); y += 4;
      page.audit.priorityActions.forEach((a, i) => {
        y = pdfCheckPage(doc, y, H, margin);
        y = pdfText(doc, margin, y, `${i + 1}. ${a.action} [${a.impact} IMPACT]`, W, margin);
      });
    }
  }
  doc.save(`vetseo-audit-${d.domain}.pdf`);
};

window.exportSitemapPDF = async function() {
  if (!lastSitemapData) { alert('Run a sitemap analysis first'); return; }
  const d = lastSitemapData;
  let { doc, W, H, y, margin } = await pdfBase('Sitemap Report', d.domain);
  pdfScoreCard(doc, margin, y, (W - margin * 2 - 8) / 3, 'Total Pages', d.totalPages || 0);
  pdfScoreCard(doc, margin + (W - margin * 2 - 8) / 3 + 4, y, (W - margin * 2 - 8) / 3, 'Max Depth', d.maxDepth || 0);
  pdfScoreCard(doc, margin + ((W - margin * 2 - 8) / 3 + 4) * 2, y, (W - margin * 2 - 8) / 3, 'Crawlability', Math.round(d.crawlability?.score || 0));
  y += 22;
  doc.setFontSize(9); doc.setTextColor(157, 150, 250); doc.setFont('helvetica', 'bold');
  doc.text('Strengths', margin, y); y += 5;
  for (const s of (d.urlAnalysis?.strengths || [])) { y = pdfCheckPage(doc, y, H, margin); y = pdfText(doc, margin, y, '+ ' + s, W, margin, [31, 217, 160]); }
  y += 3; doc.text('Issues', margin, y); y += 5;
  for (const s of (d.urlAnalysis?.issues || [])) { y = pdfCheckPage(doc, y, H, margin); y = pdfText(doc, margin, y, '! ' + s, W, margin, [240, 107, 107]); }
  y += 3; doc.text('Recommendations', margin, y); y += 5;
  for (const s of (d.urlAnalysis?.recommendations || [])) { y = pdfCheckPage(doc, y, H, margin); y = pdfText(doc, margin, y, '→ ' + s, W, margin); }
  if (d.overallReport) { doc.addPage(); y = margin + 10; y = pdfText(doc, margin, y, d.overallReport, W, margin); }
  doc.save(`vetseo-sitemap-${d.domain}.pdf`);
};

window.exportComparePDF = async function() {
  if (!lastCompareData) { alert('Run a comparison first'); return; }
  const { site1: s1, site2: s2, comparison: cmp } = lastCompareData;
  let { doc, W, H, y, margin } = await pdfBase('Competitor Comparison', `${s1.domain} vs ${s2.domain}`);
  const hw = (W - margin * 2 - 6) / 2;
  doc.setFontSize(7); doc.setTextColor(157, 150, 250); doc.setFont('helvetica', 'bold');
  doc.text(s1.domain + (cmp?.overallWinner === 'site1' ? ' 🏆' : ''), margin + hw / 2, y, { align: 'center' });
  doc.text(s2.domain + (cmp?.overallWinner === 'site2' ? ' 🏆' : ''), margin + hw + 6 + hw / 2, y, { align: 'center' });
  y += 6;
  for (const { key, label } of SCORE_KEYS) {
    const v1 = Math.round(s1.siteAverages?.[key] || 0), v2 = Math.round(s2.siteAverages?.[key] || 0);
    pdfScoreCard(doc, margin, y, hw, label + ' — ' + s1.domain, v1);
    pdfScoreCard(doc, margin + hw + 6, y, hw, label + ' — ' + s2.domain, v2);
    y += 21;
    y = pdfCheckPage(doc, y, H, margin);
  }
  y += 4; y = pdfText(doc, margin, y, cmp?.summary || '', W, margin);
  doc.save(`vetseo-compare-${s1.domain}-vs-${s2.domain}.pdf`);
};
