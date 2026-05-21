// Shared utilities
var SCORE_KEYS = [
  { key: 'overallSEO', label: 'Overall SEO' },
  { key: 'localSEO', label: 'Local SEO' },
  { key: 'schemaStructuredData', label: 'Schema / Structured Data' },
  { key: 'geoAIReadiness', label: 'GEO & AI Readiness' },
  { key: 'contentQuality', label: 'Content Quality' },
  { key: 'technicalSEO', label: 'Technical SEO' },
  { key: 'eeAt', label: 'E-E-A-T' }
];

var AUDIT_KEYS = [
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

function scoreColor(n) {
  if (n >= 80) return 'var(--green)';
  if (n >= 55) return 'var(--amber)';
  return 'var(--red)';
}
function scoreClass(n) { return n >= 80 ? 'green' : n >= 55 ? 'amber' : 'red'; }
function scoreGrade(n) {
  if (n >= 90) return 'A+'; if (n >= 80) return 'A';
  if (n >= 70) return 'B'; if (n >= 60) return 'C';
  if (n >= 50) return 'D'; return 'F';
}
function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function validUrl(v) { try { new URL(v); return v; } catch(e) { return null; } }
function setDisabled(ids, d) {
  ids.forEach(function(id) { var el = document.getElementById(id); if (el) el.disabled = d; });
}
function toggleCard(header) {
  var body = header.nextElementSibling;
  if (!body) return;
  body.classList.toggle('open');
  header.classList.toggle('expanded');
}
function showLoading(outputId, label, steps) {
  var si = 0;
  document.getElementById(outputId).innerHTML =
    '<div class="loader-wrap"><div class="loader-spinner"></div>' +
    '<div class="loader-label">' + label + '</div>' +
    '<div class="loader-step" id="loadStep">' + steps[0] + '</div>' +
    '<div class="loader-progress"><div class="loader-progress-fill" id="loadProgress" style="width:5%"></div></div>' +
    '</div>';
  var iv = setInterval(function() {
    si = (si + 1) % steps.length;
    var el = document.getElementById('loadStep');
    var prog = document.getElementById('loadProgress');
    if (el) { el.textContent = steps[si]; prog.style.width = Math.min(90, 5 + (si/steps.length)*85) + '%'; }
    else clearInterval(iv);
  }, 3000);
  return iv;
}
function openUrl(url) { window.open(url, '_blank', 'noopener'); }
