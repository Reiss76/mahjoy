/**
 * MAH JOY — Unified Mobile Navigation
 * Single script for hamburger menu across all pages
 */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.querySelector('.w-nav-button, .menu-button');
    var menu = document.querySelector('.nav-menu');
    var overlay = document.querySelector('.overlay-menu');
    
    if (!btn || !menu) {
      console.warn('Mobile nav: button or menu not found');
      return;
    }
    
    function openNav() {
      menu.classList.add('w--nav-menu-open');
      menu.style.display = 'flex';
      btn.classList.add('w--open');
      document.body.classList.add('mj-nav-open', 'w-nav-open');
      if (overlay) overlay.style.display = 'block';
    }
    
    function closeNav() {
      menu.classList.remove('w--nav-menu-open');
      menu.style.display = '';
      btn.classList.remove('w--open');
      document.body.classList.remove('mj-nav-open', 'w-nav-open');
      if (overlay) overlay.style.display = 'none';
    }
    
    function toggleNav(e) {
      e.stopPropagation();
      if (document.body.classList.contains('mj-nav-open')) {
        closeNav();
      } else {
        openNav();
      }
    }
    
    // Button click
    btn.addEventListener('click', toggleNav);
    
    // Overlay click to close
    if (overlay) {
      overlay.addEventListener('click', closeNav);
    }
    
    // Click outside to close
    document.addEventListener('click', function(e) {
      if (document.body.classList.contains('mj-nav-open') && 
          !menu.contains(e.target) && 
          !btn.contains(e.target)) {
        closeNav();
      }
    });
    
    // Escape key to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.body.classList.contains('mj-nav-open')) {
        closeNav();
      }
    });
  });
})();
