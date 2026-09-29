'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_tap_to_call_rail !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || typeof b.phone !== 'string' ||
      !/^\+?[\d().\s-]{7,30}$/.test(b.phone)) return null;
  const digits = b.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return { name: b.name, display: b.phone, phone: (b.phone.trim().startsWith('+') ? '+' : '') + digits };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="tap-to-call-rail">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="tap-to-call-rail"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-tap-to-call-rail__body')) return;
          const body = document.createElement('div'); body.className = 'wss-tap-to-call-rail__body';
          const name = document.createElement('p'); name.className = 'wss-tap-to-call-rail__name'; name.textContent = d.name;
          const call = document.createElement('a'); call.className = 'wss-tap-to-call-rail__call';
          call.href = 'tel:' + d.phone; call.textContent = 'Call ' + d.display; call.setAttribute('aria-label', 'Call ' + d.name + ' at ' + d.display);
          body.append(name, call);
          root.replaceChildren(body); root.classList.add('wss-tap-to-call-rail');
          root.setAttribute('data-wss-kit-tap-to-call-rail-done', '1'); root.setAttribute('data-wss-kit-class', 'cta-accent');
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
  name: 'tap-to-call-rail',
  version: 1,
  class: 'cta-accent',
  composesWith: Object.freeze(['reviews', 'showcase']),
  activation: 'flag:kit_tap_to_call_rail',
  budget: Object.freeze({ family: "tap-to-call", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-tap-to-call-rail { color:var(--wss-text); background:var(--wss-surface); }
.wss-tap-to-call-rail__body { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding:1rem; border:1px solid var(--wss-border); border-radius:1.25rem; }
.wss-tap-to-call-rail__name { margin:0; min-inline-size:0; overflow-wrap:anywhere; }
.wss-tap-to-call-rail__call { display:inline-flex; align-items:center; justify-content:center; min-block-size:44px; padding:.5rem 1rem; border:2px solid var(--wss-text); border-radius:999px; color:var(--wss-text); background:var(--wss-surface); text-decoration:none; font-weight:600; }
.wss-tap-to-call-rail__call:focus-visible { outline:2px solid var(--wss-text); outline-offset:4px; }
@media (prefers-reduced-motion:reduce) {
  .wss-tap-to-call-rail, .wss-tap-to-call-rail__body, .wss-tap-to-call-rail__name, .wss-tap-to-call-rail__call {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'A thumb-sized verified call action replaces the assigned CTA treatment. It stays in document flow instead of covering the chat launcher, footer or forms. No guessed country code, SMS capability, directions URL or extra action is created. A missing or invalid business phone emits no CSS or script and cannot resurrect a phone-less call path.'
});
