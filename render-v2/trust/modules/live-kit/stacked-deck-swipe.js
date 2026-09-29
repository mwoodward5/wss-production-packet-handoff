'use strict';

function input(ctx) {
  const flags = ctx?.donor?.flags;
  if (flags?.kit_stacked_deck_swipe !== true || !ctx?.donor?.name ||
      flags.kit_stacked_deck_swipe_trial_donor !== ctx.donor.name || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="stacked-deck-swipe">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="stacked-deck-swipe"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-stacked-deck-swipe__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-stacked-deck-swipe__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), stage = make('div', 'stage'), controls = make('div', 'controls');
          stage.tabIndex = 0; stage.setAttribute('aria-label', 'Review deck; use previous and next buttons or arrow keys');
          const cards = reviews.map((review, i) => {
            const card = make('figure', 'card'); card.hidden = i !== 0;
            card.appendChild(make('blockquote', 'quote', review.quote));
            if (review.author) card.appendChild(make('figcaption', 'author', review.author));
            stage.appendChild(card); return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next'), status = make('span', 'status');
          prev.type = next.type = 'button';
          let index = 0, gesture = null;
          const reduced = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const reset = () => { gesture = null; stage.style.removeProperty('--wss-deck-offset'); stage.removeAttribute('data-wss-dragging'); };
          function show(step) {
            try {
              reset(); index = (index + step + cards.length) % cards.length;
              cards.forEach((card, i) => { card.hidden = i !== index; });
              status.textContent = String(index + 1) + ' / ' + String(cards.length);
            } catch {}
          }
          stage.addEventListener('pointerdown', e => {
            try {
              if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
              gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: false };
            } catch { reset(); }
          }, { passive: true });
          stage.addEventListener('pointermove', e => {
            try {
              if (!gesture || gesture.id !== e.pointerId) return;
              const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
              if (!gesture.horizontal && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) return reset();
              if (!gesture.horizontal && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                gesture.horizontal = true; stage.setPointerCapture?.(e.pointerId);
              }
              if (!gesture.horizontal) return;
              gesture.dx = dx;
              if (!reduced()) {
                stage.setAttribute('data-wss-dragging', 'true');
                stage.style.setProperty('--wss-deck-offset', Math.max(-40, Math.min(40, dx * .35)).toFixed(2) + 'px');
              }
            } catch { reset(); }
          }, { passive: true });
          stage.addEventListener('pointerup', e => {
            try {
              if (!gesture || gesture.id !== e.pointerId) return;
              const step = gesture.horizontal && Math.abs(gesture.dx) >= 48 ? (gesture.dx < 0 ? 1 : -1) : 0;
              reset(); if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId);
              if (step) show(step);
            } catch { reset(); }
          });
          stage.addEventListener('pointercancel', reset); stage.addEventListener('lostpointercapture', reset);
          stage.addEventListener('keydown', e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(e.key === 'ArrowLeft' ? -1 : 1); }
          });
          prev.addEventListener('click', () => show(-1)); next.addEventListener('click', () => show(1));
          controls.append(prev, status, next); body.append(stage, controls); show(0);
          root.replaceChildren(body); root.classList.add('wss-stacked-deck-swipe');
          root.setAttribute('data-wss-kit-stacked-deck-swipe-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'stacked-deck-swipe',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'stats']),
  activation: 'flag:kit_stacked_deck_swipe',
  budget: Object.freeze({ family: "stack-swipe", ambientLoop: null, dwell: "1.6s settle per swipe", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-stacked-deck-swipe { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-stacked-deck-swipe__body { max-inline-size:40rem; margin-inline:auto; padding-inline:.75rem; }
.wss-stacked-deck-swipe__stage { position:relative; isolation:isolate; touch-action:pan-y; }
.wss-stacked-deck-swipe__stage::before { content:""; position:absolute; inset:.5rem; translate:0 10px; rotate:-2deg; border:1px solid var(--wss-border); border-radius:1.5rem; background:var(--wss-surface-alt); z-index:-1; }
.wss-stacked-deck-swipe__card { margin:0; padding:1.5rem; border:1px solid var(--wss-text); border-radius:1.5rem; background:var(--wss-surface); color:var(--wss-text); translate:var(--wss-deck-offset,0px) 0; }
.wss-stacked-deck-swipe__card[hidden] { display:none; }
.wss-stacked-deck-swipe__quote { margin:0; font:inherit; line-height:1.65; overflow-wrap:anywhere; }
.wss-stacked-deck-swipe__author { margin-block-start:1rem; }
.wss-stacked-deck-swipe__controls { display:flex; justify-content:center; align-items:center; gap:.75rem; margin-block-start:1.25rem; }
.wss-stacked-deck-swipe__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:1rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-stacked-deck-swipe__button:focus-visible, .wss-stacked-deck-swipe__stage:focus-visible { outline:2px solid var(--wss-text); outline-offset:4px; }
@media (prefers-reduced-motion:no-preference) {
  .wss-stacked-deck-swipe__card { transition:translate 1.6s ease-out; }
  .wss-stacked-deck-swipe__stage[data-wss-dragging="true"] .wss-stacked-deck-swipe__card { transition:none; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-stacked-deck-swipe, .wss-stacked-deck-swipe__body, .wss-stacked-deck-swipe__stage,
  .wss-stacked-deck-swipe__stage::before, .wss-stacked-deck-swipe__card, .wss-stacked-deck-swipe__quote,
  .wss-stacked-deck-swipe__author, .wss-stacked-deck-swipe__controls, .wss-stacked-deck-swipe__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; translate:none!important; rotate:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Single-donor trial with explicit donor-name binding. A horizontal gesture changes the selected real review, while vertical gestures remain native page scrolling. Drag displacement is bounded to forty pixels; no card flies across the page, no review is consumed or relabeled, and no all-five-stars completion claim is generated. Buttons and arrow keys provide equivalent control. Reduced motion removes drag displacement while preserving selection.'
});
