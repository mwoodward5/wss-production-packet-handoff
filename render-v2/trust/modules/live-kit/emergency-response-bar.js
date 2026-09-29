'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_emergency_response_bar !== true) return null;
  const b = ctx?.business;
  if (!b || b.emergencyService !== true || typeof b.name !== 'string' || !b.name.trim() ||
      typeof b.phone !== 'string' || !/^\+?[\d().\s-]{7,30}$/.test(b.phone) || !Array.isArray(b.hours)) return null;
  const digits = b.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (!days.every(day => {
    const entries = b.hours.filter(h => h?.day === day);
    return entries.length === 1 && entries[0].closed !== true && entries[0].open === '00:00' && entries[0].close === '24:00';
  })) return null;
  return { name: b.name, display: b.phone, phone: (b.phone.trim().startsWith('+') ? '+' : '') + digits };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="emergency-response-bar">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="emergency-response-bar"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-emergency-response-bar__body')) return;
          const body = document.createElement('div'); body.className = 'wss-emergency-response-bar__body';
          const copy = document.createElement('p'); copy.className = 'wss-emergency-response-bar__copy';
          copy.textContent = d.name + ' lists emergency service and 24-hour opening hours, seven days a week.';
          const call = document.createElement('a'); call.className = 'wss-emergency-response-bar__call';
          call.href = 'tel:' + d.phone; call.textContent = 'Call ' + d.display;
          body.append(copy, call);
          root.replaceChildren(body); root.classList.add('wss-emergency-response-bar');
          root.setAttribute('data-wss-kit-emergency-response-bar-done', '1'); root.setAttribute('data-wss-kit-class', 'urgency');
        } catch {}
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
      else arm();
      window.addEventListener('load', arm, { once: true });
      const observer = new MutationObserver(arm);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 6000);
    } catch {}
  }.toString() + ')(JSON.parse(' + payload + '));<\/script>';
}

module.exports = Object.freeze({
  name: 'emergency-response-bar',
  version: 1,
  class: 'urgency',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_emergency_response_bar',
  budget: Object.freeze({ family: "emergency-bar", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-emergency-response-bar { color:var(--wss-text); background:var(--wss-surface); max-block-size:20svh; overflow:auto; border-block:1px solid var(--wss-border); }
.wss-emergency-response-bar__body { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.75rem; padding:.875rem; }
.wss-emergency-response-bar__copy { margin:0; flex:1 1 16rem; line-height:1.5; overflow-wrap:anywhere; }
.wss-emergency-response-bar__call { display:inline-flex; align-items:center; min-block-size:44px; padding:.5rem 1rem; border:2px solid var(--wss-text); border-radius:999px; color:var(--wss-text); background:var(--wss-surface); text-decoration:none; }
.wss-emergency-response-bar__call:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@media (prefers-reduced-motion:reduce) {
  .wss-emergency-response-bar, .wss-emergency-response-bar__body, .wss-emergency-response-bar__copy, .wss-emergency-response-bar__call {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Flag-only, honest emergency contact bar. Opening hours alone do not prove emergency capability, so both explicit emergencyService=true and seven unambiguous 00:00–24:00 days are required. Equal 00:00 endpoints are not interpreted as twenty-four-hour service. No crew availability, dispatch status, response time or guaranteed answer is invented. The static in-flow bar occupies at most twenty percent of viewport height.'
});
