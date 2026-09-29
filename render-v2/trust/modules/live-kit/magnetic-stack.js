'use strict';

function input(ctx) {
  const flags = ctx?.donor?.flags;
  if (flags?.kit_magnetic_stack !== true || !ctx?.donor?.name ||
      flags.kit_magnetic_stack_trial_donor !== ctx.donor.name || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="magnetic-stack">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="magnetic-stack"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-magnetic-stack__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-magnetic-stack__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), stack = make('div', 'stack'), controls = make('div', 'controls');
          const cards = reviews.map((review, i) => {
            const card = make('figure', 'card'); card.hidden = i !== 0;
            card.appendChild(make('blockquote', 'quote', review.quote));
            if (review.author) card.appendChild(make('figcaption', 'author', review.author));
            stack.appendChild(card); return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next'), status = make('span', 'status');
          prev.type = next.type = 'button'; let index = 0;
          function reset() { stack.style.removeProperty('--wss-magnetic-stack-angle'); }
          function show(step) {
            try {
              reset(); index = (index + step + cards.length) % cards.length;
              cards.forEach((card, i) => { card.hidden = i !== index; });
              status.textContent = String(index + 1) + ' / ' + String(cards.length);
            } catch {}
          }
          stack.addEventListener('pointermove', event => {
            try {
              if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
                  !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return reset();
              const box = stack.getBoundingClientRect();
              if (box.width <= 0) return;
              const x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
              stack.style.setProperty('--wss-magnetic-stack-angle', (x * 4).toFixed(2) + 'deg');
            } catch { reset(); }
          }, { passive: true });
          stack.addEventListener('pointerleave', reset, { passive: true });
          window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', reset);
          prev.addEventListener('click', () => show(-1)); next.addEventListener('click', () => show(1));
          controls.append(prev, status, next); body.append(stack, controls); show(0);
          root.replaceChildren(body); root.classList.add('wss-magnetic-stack');
          root.setAttribute('data-wss-kit-magnetic-stack-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'magnetic-stack',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'stats']),
  activation: 'flag:kit_magnetic_stack',
  budget: Object.freeze({ family: "magnetic-stack", ambientLoop: null, dwell: "1.6s settle per advance", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-magnetic-stack { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-magnetic-stack__body { max-inline-size:40rem; margin-inline:auto; }
.wss-magnetic-stack__stack { position:relative; isolation:isolate; padding:.75rem; perspective:900px; }
.wss-magnetic-stack__stack::before, .wss-magnetic-stack__stack::after { content:""; position:absolute; inset:1rem .75rem .2rem; border:1px solid var(--wss-border); border-radius:1.5rem; background:var(--wss-surface-alt); z-index:-1; }
.wss-magnetic-stack__stack::before { rotate:2deg; }
.wss-magnetic-stack__stack::after { rotate:-2deg; }
.wss-magnetic-stack__card { margin:0; padding:1.5rem; border:1px solid var(--wss-text); border-radius:1.5rem; background:var(--wss-surface); color:var(--wss-text); }
.wss-magnetic-stack__card[hidden] { display:none; }
.wss-magnetic-stack__quote { margin:0; font:inherit; line-height:1.65; overflow-wrap:anywhere; }
.wss-magnetic-stack__author { margin-block-start:1rem; }
.wss-magnetic-stack__controls { display:flex; align-items:center; justify-content:center; gap:.75rem; margin-block-start:1rem; }
.wss-magnetic-stack__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:1rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-magnetic-stack__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference) {
  .wss-magnetic-stack__card:not([hidden]) { rotate:y var(--wss-magnetic-stack-angle,0deg); transition:rotate 1.6s ease-out; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-magnetic-stack, .wss-magnetic-stack__body, .wss-magnetic-stack__stack,
  .wss-magnetic-stack__stack::before, .wss-magnetic-stack__stack::after, .wss-magnetic-stack__card,
  .wss-magnetic-stack__quote, .wss-magnetic-stack__author, .wss-magnetic-stack__controls, .wss-magnetic-stack__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; rotate:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Single-donor trial with explicit donor-name binding. The active module-owned card follows a fine pointer by at most four degrees; touch gets the same manual stack without tilt. Backplates are empty decoration, not fabricated reviews. Every real quote is stored once, selection has accessible previous/next controls, and no donor transform, device sensor or idle loop is used.'
});
