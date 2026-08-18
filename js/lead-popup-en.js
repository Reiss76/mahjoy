/**
 * Mahjoy — Lead capture popup
 * Shows 3s after load; once per session (localStorage flag).
 * Sends email + whatsapp to Proax API.
 */
(function () {
  const API = 'https://api-production-b888.up.railway.app/public/shop/mahjoy/leads';
  const KEY = 'mj_lead_submitted';

  if (localStorage.getItem(KEY)) return;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #mj-lead-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,.55); display: flex;
      align-items: center; justify-content: center;
      padding: 16px; animation: mj-fade-in .3s ease;
    }
    @keyframes mj-fade-in { from { opacity:0 } to { opacity:1 } }
    #mj-lead-modal {
      background: #fff; border-radius: 20px; max-width: 400px; width: 100%;
      padding: 36px 32px 32px; position: relative; text-align: center;
      box-shadow: 0 24px 80px rgba(107,15,42,.25);
    }
    #mj-lead-close {
      position: absolute; top: 14px; right: 16px;
      background: none; border: none; font-size: 22px; cursor: pointer;
      color: #999; line-height: 1;
    }
    #mj-lead-modal .mj-popup-eyebrow {
      font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
      color: #9B3E7A; font-weight: 700; margin-bottom: 10px;
    }
    #mj-lead-modal h2 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 28px; line-height: 1.2; color: #1a1a1a; margin: 0 0 8px;
    }
    #mj-lead-modal h2 em { color: #C76BA4; font-style: italic; }
    #mj-lead-modal p {
      font-size: 13.5px; color: #666; margin: 0 0 22px; line-height: 1.5;
    }
    .mj-lead-input {
      width: 100%; box-sizing: border-box;
      border: 1.5px solid #e0d0e8; border-radius: 10px;
      padding: 11px 14px; font-size: 14px; color: #333;
      margin-bottom: 10px; outline: none; transition: border .2s;
    }
    .mj-lead-input:focus { border-color: #C76BA4; }
    #mj-lead-submit {
      width: 100%; background: #6B0F2A; color: #fff;
      border: none; border-radius: 10px; padding: 13px;
      font-size: 14px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; cursor: pointer; transition: background .2s;
      margin-top: 4px;
    }
    #mj-lead-submit:hover { background: #9B3E7A; }
    #mj-lead-submit:disabled { opacity: .6; cursor: not-allowed; }
    .mj-lead-skip {
      display: block; margin-top: 14px; font-size: 12px;
      color: #bbb; cursor: pointer; text-decoration: underline;
    }
    #mj-lead-success { display: none; }
    #mj-lead-success.show { display: block; }
    #mj-lead-form.hide { display: none; }
  `;
  document.head.appendChild(style);

  // Build HTML
  const overlay = document.createElement('div');
  overlay.id = 'mj-lead-overlay';
  overlay.innerHTML = `
    <div id="mj-lead-modal" role="dialog" aria-modal="true" aria-label="Únete a la comunidad Mahjoy">
      <button id="mj-lead-close" aria-label="Cerrar">✕</button>
      <div id="mj-lead-form">
        <h2><em>Únete a la comunidad</em></h2>
        <p>News, beginner tips and early access to new sets — direct to your email and WhatsApp.</p>
        <input class="mj-lead-input" id="mj-name" type="text" placeholder="Your name (optional)" autocomplete="name" />
        <input class="mj-lead-input" id="mj-email" type="email" placeholder="Email" autocomplete="email" />
        <input class="mj-lead-input" id="mj-wa" type="tel" placeholder="WhatsApp (optional, e.g. 8112345678)" autocomplete="tel" />
        <button id="mj-lead-submit">Únete ahora</button>
        <span class="mj-lead-skip" id="mj-lead-skip">No thanks, maybe later</span>
      </div>
      <div id="mj-lead-success">
        <div style="font-size:48px;margin-bottom:12px">🀄</div>
        <h2 style="font-size:22px;margin-bottom:8px">¡Bienvenida a la mesa!</h2>
        <p>Te mantendremos al tanto de todo lo mahjoy.</p>
      </div>
    </div>
  `;

  function dismiss() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity .25s';
    setTimeout(() => overlay.remove(), 300);
  }

  overlay.querySelector('#mj-lead-close').addEventListener('click', dismiss);
  overlay.querySelector('#mj-lead-skip').addEventListener('click', dismiss);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) dismiss();
  });

  overlay.querySelector('#mj-lead-submit').addEventListener('click', async function () {
    const name = document.getElementById('mj-name').value.trim();
    const email = document.getElementById('mj-email').value.trim();
    const whatsapp = document.getElementById('mj-wa').value.trim();

    if (!email && !whatsapp) {
      document.getElementById('mj-email').style.borderColor = '#C76BA4';
      document.getElementById('mj-wa').style.borderColor = '#C76BA4';
      return;
    }

    const btn = overlay.querySelector('#mj-lead-submit');
    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, whatsapp, source: 'popup' })
      });
      localStorage.setItem(KEY, '1');
      document.getElementById('mj-lead-form').classList.add('hide');
      document.getElementById('mj-lead-success').classList.add('show');
      setTimeout(dismiss, 2500);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Únete ahora';
    }
  });

  setTimeout(function () {
    document.body.appendChild(overlay);
  }, 3000);
})();
