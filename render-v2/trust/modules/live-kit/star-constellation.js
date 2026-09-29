'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_star_constellation !== true || !Array.isArray(ctx?.data?.reviews)) return null;
  const reviews = ctx.data.reviews.filter(r => r && typeof (r.quote ?? r.text) === 'string' && (r.quote ?? r.text).trim())
    .slice(0, 6).map(r => ({ quote: r.quote ?? r.text, author: typeof (r.name ?? r.author) === 'string' ? (r.name ?? r.author) : '' }));
  return reviews.length >= 3 ? reviews : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="star-constellation">(' + function (reviews) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="star-constellation"]') || document.querySelector('#reviews .wss-rvm');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video') || root.querySelector('.wss-star-constellation__body')) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-star-constellation__' + suffix;
            if (text != null) n.textContent = text;
            return n;
          };
          const body = make('div', 'body'), sky = make('div', 'sky'), stage = make('div', 'stage');
          sky.setAttribute('role', 'group'); sky.setAttribute('aria-label', 'Choose a review');
          const cards = [], buttons = [];
          const positions = [12, 27, 42, 58, 73, 88];
          reviews.forEach((review, i) => {
            const button = make('button', 'star', '✦');
            button.type = 'button';
            button.style.setProperty('--wss-star-x', positions[i] + '%');
            button.style.setProperty('--wss-star-y', (i % 2 ? 64 : 30) + '%');
            button.setAttribute('aria-label', review.author ? 'Read review by ' + review.author : 'Read review ' + String(i + 1));
            const card = make('figure', 'card');
            card.appendChild(make('blockquote', 'quote', review.quote));
            if (review.author) card.appendChild(make('figcaption', 'author', review.author));
            card.hidden = i !== 0;
            button.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
            button.addEventListener('click', () => {
              try {
                cards.forEach((node, j) => { node.hidden = j !== i; });
                buttons.forEach((node, j) => node.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
              } catch {}
            });
            buttons.push(button); cards.push(card); sky.appendChild(button); stage.appendChild(card);
          });
          body.append(sky, stage);
          root.replaceChildren(body); root.classList.add('wss-star-constellation');
          root.setAttribute('data-wss-kit-star-constellation-done', '1'); root.setAttribute('data-wss-kit-class', 'reviews');
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
  name: 'star-constellation',
  version: 1,
  class: 'reviews',
  composesWith: Object.freeze(['badges', 'showcase']),
  activation: 'flag:kit_star_constellation',
  budget: Object.freeze({ family: "star-scale", ambientLoop: null, dwell: "1.6s scale transition", stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-star-constellation { background:var(--wss-surface); color:var(--wss-text); animation:none; }
.wss-star-constellation__sky { position:relative; block-size:10rem; border-block-end:1px solid var(--wss-border); }
.wss-star-constellation__star { position:absolute; left:var(--wss-star-x); top:var(--wss-star-y); translate:-50% -50%; inline-size:44px; block-size:44px; border:1px solid var(--wss-border); border-radius:50%; font-size:1.5rem; color:var(--wss-text); background:var(--wss-surface); cursor:pointer; }
.wss-star-constellation__star[aria-pressed="true"] { border-color:var(--wss-text); scale:1.12; }
.wss-star-constellation__star:focus-visible { outline:2px solid var(--wss-text); outline-offset:4px; }
.wss-star-constellation__card { margin:0; padding:1.5rem; }
.wss-star-constellation__card[hidden] { display:none; }
.wss-star-constellation__quote { margin:0; font:inherit; font-size:1.125rem; line-height:1.65; overflow-wrap:anywhere; }
.wss-star-constellation__author { margin-block-start:1rem; font-size:.875rem; }
@media (prefers-reduced-motion:no-preference) {
  .wss-star-constellation__star { transition:scale 1.6s ease; }
}
@media (prefers-reduced-motion:reduce) {
  .wss-star-constellation, .wss-star-constellation__body, .wss-star-constellation__sky,
  .wss-star-constellation__star, .wss-star-constellation__stage, .wss-star-constellation__card,
  .wss-star-constellation__quote, .wss-star-constellation__author {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'A manual constellation navigator replaces the review carousel; it is never appended below another review treatment. The first six supplied usable reviews are retained once in the DOM, with one visible at a time. Star positions are decorative navigation, not locations, ratings or relationships. Forty-four-pixel controls supply the premium interaction without ping loops, invented authors, review rewriting or autoplay.'
});
