'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_booking_momentum !== true) return null;
  const b = ctx?.business;
  if (!b || typeof b.name !== 'string' || !b.name.trim() || !Number.isSafeInteger(b.bookingsThisWeek) || b.bookingsThisWeek < 0) return null;
  return {
    name: b.name,
    count: b.bookingsThisWeek,
    asOf: typeof b.bookingsAsOf === 'string' && b.bookingsAsOf.trim() ? b.bookingsAsOf : ''
  };
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="booking-momentum">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="booking-momentum"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-booking-momentum__body')) return;
          const body = document.createElement('div'); body.className = 'wss-booking-momentum__body';
          const copy = document.createElement('p'); copy.className = 'wss-booking-momentum__copy';
          copy.textContent = d.name + ' has ' + String(d.count) + (d.count === 1 ? ' booking recorded this week.' : ' bookings recorded this week.');
          body.appendChild(copy);
          if (d.asOf) {
            const stamp = document.createElement('p'); stamp.className = 'wss-booking-momentum__stamp';
            stamp.textContent = 'As of ' + d.asOf; body.appendChild(stamp);
          }
          root.replaceChildren(body); root.classList.add('wss-booking-momentum');
          root.setAttribute('data-wss-kit-booking-momentum-done', '1'); root.setAttribute('data-wss-kit-class', 'urgency');
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
  name: 'booking-momentum',
  version: 1,
  class: 'urgency',
  composesWith: Object.freeze(['reviews', 'badges']),
  activation: 'flag:kit_booking_momentum',
  budget: Object.freeze({ family: "booking-stamp", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-booking-momentum { color:var(--wss-text); background:var(--wss-surface); max-block-size:20svh; overflow:auto; }
.wss-booking-momentum__body { padding:1rem 1.25rem; border:1px solid var(--wss-border); border-radius:1.25rem; }
.wss-booking-momentum__copy { margin:0; line-height:1.65; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.wss-booking-momentum__stamp { margin:.5rem 0 0; font-size:.8125rem; line-height:1.5; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-booking-momentum, .wss-booking-momentum__body, .wss-booking-momentum__copy, .wss-booking-momentum__stamp {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'The only permitted momentum fact is the upstream-verified current-week integer bookingsThisWeek, including an honest zero. The integration must supply a current-week count, not an old snapshot renamed as current; an optional supplied bookingsAsOf label is retained. No schedule is synthesized from hours, no customers are named, and no remaining-slot, nearly-full, demand trend or live-availability claim is generated. Missing counts emit nothing, and the display never animates.'
});
