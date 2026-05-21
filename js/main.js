function showView(name) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  var viewEl = document.getElementById('view' + name.charAt(0).toUpperCase() + name.slice(1));
  var navEl = document.getElementById('nav' + name.charAt(0).toUpperCase() + name.slice(1));
  if (viewEl) viewEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  if (name === 'history') loadHistory();
}
