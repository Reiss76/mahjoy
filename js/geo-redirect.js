/**
 * Geo Redirect - Redirects Mexican visitors to ES, others to EN
 * Respects manual language selection
 */
(function() {
  // If user manually selected a language, respect it
  if (localStorage.getItem('mj_lang_manual')) return;
  
  // Check current path
  var isEN = window.location.pathname.includes('/en/');
  var isRoot = window.location.pathname === '/' || window.location.pathname === '/index.html';
  
  // Detect country
  fetch('https://ipapi.co/json/')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var country = data.country_code || data.country;
      var isMexico = (country === 'MX');
      
      if (isMexico && isEN) {
        // Mexican visitor on EN page → redirect to ES
        var esPath = window.location.pathname.replace('/en/', '/');
        window.location.href = esPath + window.location.search + window.location.hash;
      } else if (!isMexico && (isRoot || (!isEN && window.location.pathname !== '/'))) {
        // Non-Mexico visitor on ES page → redirect to EN
        var enPath = '/en' + window.location.pathname;
        if (isRoot) enPath = '/en/index.html';
        window.location.href = enPath + window.location.search + window.location.hash;
      }
    })
    .catch(function() {
      // On error, do nothing
    });
})();
