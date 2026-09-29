'use strict';

function input(ctx) {
  const flags = ctx?.donor?.flags;
  if (flags?.kit_liquid_morph_slider !== true || !ctx?.donor?.name ||
      flags.kit_liquid_morph_slider_trial_donor !== ctx.donor.name || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="liquid-morph-slider">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="liquid-morph-slider"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-liquid-morph-slider__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-liquid-morph-slider__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), frame = make('div', 'frame'), controls = make('div', 'controls');
          const cards = reviews.map((review, i) => {
            const card = make('figure', 'card'); card.hidden = i !== 0;
            card.appendChild(make('blockquote', 'quote', review.quote));
            if (review.author) card.appendChild(make('figcaption', 'author', review.author));
            frame.appendChild(card); return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next'), status = make('span', 'status');
          prev.type = next.type = 'button'; let index = 0;
          function show(step) {
            try {
              index = (index + step + cards.length) % cards.length;
              cards.forEach((card, i) => { card.hidden = i !== index; });
              frame.setAttribute('data-wss-shape', String(index % 3));
              status.textContent = String(index + 1) + ' / ' + String(cards.length);
            } catch {}
          }
          prev.addEventListener('click', () => show(-1)); next.addEventListener('click', () => show(1));
          controls.append(prev, status, next); body.append(frame, controls); show(0);
          root.replaceChildren(body); root.classList.add('wss-liquid-morph-slider');
          root.setAttribute('data-wss-kit-liquid-morph-slider-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'liquid-morph-slider',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'stats']),
  activation: 'flag:kit_liquid_morph_slider',
  budget: Object.freeze({ family: "liquid-morph", ambientLoop: null, dwell: "1.6s shape morph per advance", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-liquid-morph-slider { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-liquid-morph-slider__body { max-inline-size:45rem; margin-inline:auto; }
.wss-liquid-morph-slider__frame { padding:1rem; border:2px solid var(--wss-text); border-radius:2rem 4rem 2rem 4rem; background:var(--wss-surface); }
.wss-liquid-morph-slider__frame[data-wss-shape="1"] { border-radius:4rem 2rem 4rem 2rem; }
.wss-liquid-morph-slider__frame[data-wss-shape="2"] { border-radius:3rem; }
.wss-liquid-morph-slider__card { margin:0; padding:1.25rem; }
.wss-liquid-morph-slider__card[hidden] { display:none; }
.wss-liquid-morph-slider__quote { margin:0; font:inherit; font-size:1.125rem; line-height:1.65; overflow-wrap:anywhere; }
.wss-liquid-morph-slider__author { margin-block-start:1rem; }
.wss-liquid-morph-slider__controls { display:flex; gap:.75rem; justify-content:center; align-items:center; margin-block-start:1rem; }
.wss-liquid-morph-slider__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:1rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-liquid-morph-slider__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@media (prefers-reduced-motion:no-preference) {
  .wss-liquid-morph-slider__frame { transition:border-radius 1.6s ease; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-liquid-morph-slider, .wss-liquid-morph-slider__body, .wss-liquid-morph-slider__frame,
  .wss-liquid-morph-slider__card, .wss-liquid-morph-slider__quote, .wss-liquid-morph-slider__author,
  .wss-liquid-morph-slider__controls, .wss-liquid-morph-slider__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Single-donor trial only: the explicit trial-donor flag must equal ctx.donor.name. Preserves the soft morphing silhouette but removes the reference goo filter, moving blobs and autoplay. One frame changes shape only after manual review selection; readable quotes are never filtered. This replaces the complete review presentation and uses no other review module.'
});
