(function () {
  const english = location.pathname.startsWith('/en/');
  const message = english ? 'Enter a valid phone number with country code before paying.' : 'Ingresa un teléfono válido con código de país antes de pagar.';
  let input;
  function mount() {
    const container = document.getElementById('paypal-cart-container') || document.getElementById('paypal-express-container');
    if (!container || input) return;
    const field = document.createElement('div');
    field.style.cssText = 'margin:0 0 16px;text-align:left;';
    field.innerHTML = '<label for="paypal-contact-phone" style="display:block;font-weight:600;margin-bottom:6px;">' + (english ? 'Phone / WhatsApp (required)' : 'Teléfono / WhatsApp (obligatorio)') + '</label><input id="paypal-contact-phone" type="tel" autocomplete="tel" required maxlength="40" placeholder="' + (english ? '+1 555 123 4567' : '+52 55 1234 5678') + '" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #9d647c;border-radius:8px;font-size:16px;"><small style="display:block;margin-top:6px;">' + (english ? 'Used to contact you about delivery.' : 'Lo usaremos para contactarte sobre la entrega.') + '</small><span id="paypal-phone-error" role="alert" style="display:block;color:#a71930;margin-top:6px;"></span>';
    container.before(field);
    input = field.querySelector('input');
    const formPhones = Array.from(document.querySelectorAll('input[name="phone"], input[name="ship_phone"]'));
    input.value = (formPhones.find(phone => phone.value.trim()) || {}).value || '';
    input.addEventListener('input', () => { formPhones.forEach(phone => { phone.value = input.value; }); });
    formPhones.forEach(phone => phone.addEventListener('input', () => {
      input.value = phone.value; input.setCustomValidity('');
      document.getElementById('paypal-phone-error').textContent = '';
    }));
    input.addEventListener('input', () => { input.setCustomValidity(''); document.getElementById('paypal-phone-error').textContent = ''; });
  }
  function requirePhone() {
    mount();
    const value = input ? input.value.trim() : '';
    const digits = value.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]+$/.test(value) || digits.length < 8 || digits.length > 15 || /^0|^(\d)\1+$/.test(digits)) {
      if (input) {
        input.setCustomValidity(message);
        document.getElementById('paypal-phone-error').textContent = message;
        input.focus(); input.reportValidity();
      }
      throw new Error(message);
    }
    return value;
  }
  function onClick(_data, actions) {
    try { requirePhone(); return actions.resolve(); }
    catch (_) { return actions.reject(); }
  }
  window.MJPayPalPhone = {requirePhone, onClick};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
