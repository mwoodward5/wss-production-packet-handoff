'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_coverflow_carousel !== true || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="coverflow-carousel">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="coverflow-carousel"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-coverflow-carousel__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-coverflow-carousel__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('div', 'body'), track = make('div', 'track'), controls = make('div', 'controls');
          const cards = reviews.map(r => {
            const card = make('figure', 'card');
            card.appendChild(make('blockquote', 'quote', r.quote));
            if (r.author) card.appendChild(make('figcaption', 'author', r.author));
            track.appendChild(card); return card;
          });
          const prev = make('button', 'button', 'Previous'), next = make('button', 'button', 'Next'), status = make('span', 'status');
          prev.type = next.type = 'button';
          let index = 0;
          function select(i, scroll) {
            try {
              index = Math.max(0, Math.min(cards.length - 1, i));
              cards.forEach((card, j) => {
                card.setAttribute('data-wss-active', j === index ? 'true' : 'false');
                card.style.setProperty('--wss-coverflow-angle', j < index ? '6deg' : '-6deg');
              });
              prev.disabled = index === 0; next.disabled = index === cards.length - 1;
              status.textContent = String(index + 1) + ' / ' + String(cards.length);
              if (scroll) track.scrollLeft = cards[index].offsetLeft;
            } catch {}
          }
          prev.addEventListener('click', () => select(index - 1, true));
          next.addEventListener('click', () => select(index + 1, true));
          let queued = false;
          track.addEventListener('scroll', () => {
            if (queued) return; queued = true;
            requestAnimationFrame(() => {
              try {
                queued = false;
                let closest = 0, distance = Infinity;
                cards.forEach((card, i) => {
                  const delta = Math.abs(card.offsetLeft - track.scrollLeft);
                  if (delta < distance) { distance = delta; closest = i; }
                });
                select(closest, false);
              } catch { queued = false; }
            });
          }, { passive: true });
          controls.append(prev, status, next); body.append(track, controls); select(0, false);
          root.replaceChildren(body); root.classList.add('wss-coverflow-carousel');
          root.setAttribute('data-wss-kit-coverflow-carousel-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'coverflow-carousel',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'stats']),
  activation: 'flag:kit_coverflow_carousel',
  budget: Object.freeze({ family: "coverflow", ambientLoop: null, dwell: "1.6s rotate settle per advance", stagger: null, maxPerViewport: 3 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-coverflow-carousel { color:var(--wss-text); background:var(--wss-surface); animation:none; }
.wss-coverflow-carousel__track { position:relative; display:flex; gap:1rem; overflow-x:auto; scroll-snap-type:x mandatory; perspective:1000px; padding-block:1rem; }
.wss-coverflow-carousel__card { flex:0 0 84%; min-inline-size:0; box-sizing:border-box; margin:0; padding:1.5rem; border:1px solid var(--wss-border); border-radius:1.5rem; background:var(--wss-surface); color:var(--wss-text); scroll-snap-align:start; rotate:y var(--wss-coverflow-angle,-6deg); }
.wss-coverflow-carousel__card[data-wss-active="true"] { rotate:y 0deg; border-color:var(--wss-text); }
.wss-coverflow-carousel__quote { margin:0; font:inherit; line-height:1.65; overflow-wrap:anywhere; }
.wss-coverflow-carousel__author { margin-block-start:1rem; font-size:.875rem; }
.wss-coverflow-carousel__controls { display:flex; align-items:center; justify-content:center; gap:.75rem; }
.wss-coverflow-carousel__button { min-block-size:44px; padding:.5rem 1rem; border:1px solid var(--wss-border); border-radius:.875rem; color:var(--wss-text); background:var(--wss-surface); font:inherit; cursor:pointer; }
.wss-coverflow-carousel__button:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
@media (prefers-reduced-motion:no-preference) {
  .wss-coverflow-carousel__card { transition:rotate 1.6s ease; }
}
@media (max-width:767px) {
  .wss-coverflow-carousel__card { flex-basis:92%; rotate:none; transition:none; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-coverflow-carousel, .wss-coverflow-carousel__body, .wss-coverflow-carousel__track,
  .wss-coverflow-carousel__card, .wss-coverflow-carousel__quote, .wss-coverflow-carousel__author,
  .wss-coverflow-carousel__controls, .wss-coverflow-carousel__button {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important; rotate:none!important; scroll-behavior:auto!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'A native, manually navigated snap rail retains the coverflow depth language while limiting neighboring card angles to six degrees. No autoplay, blurred quotes, cloned cards, fixed card heights, drag dependency or hidden overflow removes review content. The existing review presentation is replaced, and mobile receives a flat rail. Rotation is confined to newly created module cards, never donor parallax elements.'
});
