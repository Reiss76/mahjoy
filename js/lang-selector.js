/**
 * Mahjoy — Language selector
 * Injects EN|ES toggle with globe icon into nav bar
 */
(function() {
  var isEnglish = window.location.pathname.indexOf('/en/') === 0;
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  var globe = '<svg style="width:14px;height:14px;opacity:0.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  
  var enLink = isEnglish ? currentPage : '/en/' + currentPage;
  var esLink = isEnglish ? '/' + currentPage : currentPage;
  
  var html = '<div id="mj-lang-sel" style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fff;font-family:Plus Jakarta Sans,sans-serif;">' +
    globe +
    '<a href="' + enLink + '" style="color:' + (isEnglish ? '#fff' : 'rgba(255,255,255,0.6)') + ';text-decoration:none;">EN</a>' +
    '<span style="color:rgba(255,255,255,0.4);">|</span>' +
    '<a href="' + esLink + '" style="color:' + (isEnglish ? 'rgba(255,255,255,0.6)' : '#fff') + ';text-decoration:none;">ES</a>' +
    '</div>';
  
  // Find cell-slogan and inject
  var slogan = document.querySelector('.cell-slogan');
  if (slogan && !document.getElementById('mj-lang-sel')) {
    slogan.innerHTML = html;
    slogan.style.visibility = 'visible';
    slogan.style.display = 'flex';
    slogan.style.alignItems = 'center';
    slogan.style.paddingLeft = '12px';
  }
})();
