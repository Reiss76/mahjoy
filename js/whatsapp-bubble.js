/**
 * Mahjoy — WhatsApp Floating Bubble
 * Adds a floating WhatsApp contact button to all pages
 */
(function() {
  const WA_NUMBER = '525530395891';
  const WA_MESSAGE = '¡Hola! Me interesa saber más sobre Mahjoy 🀄';
  
  // Detect language
  const isEN = window.location.pathname.includes('/en/');
  const messageEN = 'Hi! I\'d like to know more about Mahjoy 🀄';
  const message = isEN ? messageEN : WA_MESSAGE;

  // Create the bubble
  const bubble = document.createElement('a');
  bubble.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
  bubble.target = '_blank';
  bubble.rel = 'noopener noreferrer';
  bubble.id = 'mj-wa-bubble';
  bubble.setAttribute('aria-label', isEN ? 'Contact us on WhatsApp' : 'Contáctanos por WhatsApp');
  
  bubble.innerHTML = `
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16.003 2.667C8.64 2.667 2.67 8.637 2.67 16c0 2.347.613 4.627 1.78 6.64L2.667 29.333l6.907-1.813A13.26 13.26 0 0016.003 29.333c7.364 0 13.334-5.97 13.334-13.333S23.367 2.667 16.003 2.667zm0 24.4a11.04 11.04 0 01-5.627-1.54l-.4-.24-4.147 1.087 1.107-4.04-.267-.413a10.973 10.973 0 01-1.693-5.92c0-6.094 4.96-11.054 11.054-11.054 6.093 0 11.053 4.96 11.053 11.053 0 6.094-4.96 11.054-11.08 11.054v.013zm6.067-8.28c-.334-.167-1.96-.967-2.267-1.08-.306-.113-.526-.167-.747.167-.22.333-.86 1.08-1.053 1.3-.193.22-.387.247-.72.08-.334-.167-1.407-.52-2.68-1.66-.99-.887-1.66-1.98-1.853-2.313-.193-.334-.02-.513.147-.68.147-.147.333-.387.5-.58.167-.193.22-.333.333-.553.113-.22.053-.413-.027-.58-.08-.167-.747-1.8-1.02-2.467-.267-.647-.54-.56-.747-.573h-.64c-.22 0-.58.08-.88.413-.3.333-1.153 1.127-1.153 2.747 0 1.62 1.18 3.187 1.347 3.407.167.22 2.32 3.54 5.627 4.967.787.34 1.4.54 1.88.693.79.253 1.507.22 2.073.133.633-.093 1.96-.8 2.24-1.573.28-.773.28-1.433.193-1.573-.087-.14-.307-.22-.64-.387z" fill="currentColor"/>
    </svg>
  `;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #mj-wa-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      background: #25D366;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
      z-index: 9999;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      text-decoration: none;
    }
    #mj-wa-bubble:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(37, 211, 102, 0.5);
    }
    #mj-wa-bubble svg {
      width: 32px;
      height: 32px;
      color: white;
    }
    @media (max-width: 768px) {
      #mj-wa-bubble {
        bottom: 16px;
        right: 16px;
        width: 54px;
        height: 54px;
      }
      #mj-wa-bubble svg {
        width: 28px;
        height: 28px;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(bubble);
})();
