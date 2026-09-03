/**
 * Geo Banner - Shows "Coming Soon to USA" banner for non-Mexico visitors
 * Only loads on EN pages
 */
(function() {
  // Only run on EN pages
  if (!window.location.pathname.includes('/en/')) return;
  
  // Check if already dismissed
  if (localStorage.getItem('mj_geo_banner_dismissed')) return;
  
  // Detect country via free IP API
  fetch('https://ipapi.co/json/')
    .then(r => r.json())
    .then(data => {
      const country = data.country_code || data.country;
      
      // If Mexico, don't show banner
      if (country === 'MX') return;
      
      // Create and show banner
      showBanner(country);
    })
    .catch(() => {
      // On error, don't show banner (fail silently)
    });
  
  function showBanner(country) {
    const banner = document.createElement('div');
    banner.id = 'mj-geo-banner';
    banner.innerHTML = `
      <div class="mj-geo-content">
        <span class="mj-geo-flag">🇺🇸</span>
        <span class="mj-geo-text">
          <strong>Coming Soon to the USA!</strong> 
          We're working hard to bring Mahjoy to your doorstep. 
          Stay tuned for international shipping!
        </span>
        <button class="mj-geo-close" aria-label="Close">&times;</button>
      </div>
    `;
    
    // Styles
    const style = document.createElement('style');
    style.textContent = `
      #mj-geo-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, var(--burgundy, #6B0F2A) 0%, var(--orchid-mid, #9B3E7A) 100%);
        color: #fff;
        padding: 12px 20px;
        z-index: 99999;
        font-family: 'Plus Jakarta Sans', sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        animation: mj-slide-down 0.4s ease-out;
      }
      @keyframes mj-slide-down {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .mj-geo-content {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .mj-geo-flag {
        font-size: 1.5rem;
      }
      .mj-geo-text {
        font-size: 0.9rem;
        line-height: 1.4;
        text-align: center;
      }
      .mj-geo-text strong {
        display: block;
        font-size: 1rem;
        margin-bottom: 2px;
      }
      .mj-geo-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        font-size: 1.5rem;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .mj-geo-close:hover {
        background: rgba(255,255,255,0.3);
      }
      @media (max-width: 600px) {
        #mj-geo-banner { padding: 10px 15px; }
        .mj-geo-text { font-size: 0.8rem; }
        .mj-geo-text strong { font-size: 0.9rem; }
        .mj-geo-flag { font-size: 1.2rem; }
      }
    `;
    
    document.head.appendChild(style);
    document.body.prepend(banner);
    
    // Add padding to body so content isn't hidden
    document.body.style.paddingTop = banner.offsetHeight + 'px';
    
    // Close button
    banner.querySelector('.mj-geo-close').addEventListener('click', function() {
      banner.style.animation = 'none';
      banner.style.transform = 'translateY(-100%)';
      banner.style.transition = 'transform 0.3s ease-in';
      localStorage.setItem('mj_geo_banner_dismissed', '1');
      setTimeout(() => {
        banner.remove();
        document.body.style.paddingTop = '';
      }, 300);
    });
  }
})();
