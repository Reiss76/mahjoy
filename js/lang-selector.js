/**
 * Mahjoy — Language selector
 * Injects EN|ES toggle with globe icon into nav bar
 * Sets cookie to remember preference
 */
(function() {
  var isEnglish = window.location.pathname.indexOf('/en/') === 0;
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  // Set cookie to remember language preference
  function setLangCookie(lang) {
    document.cookie = 'mj_lang=' + lang + ';path=/;max-age=' + (365*24*60*60);
  }
  
  var globe = '<svg style="width:14px;height:14px;opacity:0.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  
  var enLink = isEnglish ? currentPage : '/en/' + currentPage;
  var esLink = isEnglish ? '/' + currentPage : currentPage;
  
  var html = '<div id="mj-lang-sel" style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fff;font-family:Plus Jakarta Sans,sans-serif;">' +
    globe +
    '<a href="' + enLink + '" onclick="localStorage.setItem(\'mj_lang_manual\',\'1\');document.cookie=\'mj_lang=en;path=/;max-age=31536000\'" style="color:' + (isEnglish ? '#fff' : 'rgba(255,255,255,0.6)') + ';text-decoration:none;">EN</a>' +
    '<span style="color:rgba(255,255,255,0.4);">|</span>' +
    '<a href="' + esLink + '" onclick="localStorage.setItem(\'mj_lang_manual\',\'1\');document.cookie=\'mj_lang=es;path=/;max-age=31536000\'" style="color:' + (isEnglish ? 'rgba(255,255,255,0.6)' : '#fff') + ';text-decoration:none;">ES</a>' +
    '</div>';
  
  // Find navmenu and inject as first child
  var navmenu = document.querySelector('.navmenu');
  if (navmenu && !document.getElementById('mj-lang-sel')) {
    navmenu.insertAdjacentHTML('afterbegin', html);
  }
})();
