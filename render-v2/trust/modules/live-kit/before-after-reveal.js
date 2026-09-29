'use strict';

function input(ctx) {
  if (ctx?.donor?.flags?.kit_before_after_reveal !== true) return null;
  const pairs = ctx?.business?.beforeAfter;
  if (!Array.isArray(pairs)) return null;
  const pair = pairs.find(p => p && [p.title, p.before, p.after].every(v => typeof v === 'string' && v.trim()) && p.before !== p.after);
  return pair ? { title: pair.title, before: pair.before, after: pair.after } : null;
}

function emit(data) {
  const payload = JSON.stringify(JSON.stringify(data)).replace(/[<>&{}\[\]\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<script data-wss-kit="before-after-reveal">(' + function (d) {
    'use strict';
    try {
      function arm() {
        try {
          const root = document.querySelector('.wss-kit-slot[data-wss-module="before-after-reveal"]');
          if (!root || root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') ||
              root.querySelector('form,video,h1') || root.querySelector('.wss-before-after-reveal__body')) return;
          const inline = value => /^data:image\/(?:png|jpeg|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value);
          function obtain(value) {
            if (inline(value)) {
              const image = document.createElement('img'); image.src = value; return image;
            }
            let wanted;
            try { wanted = new URL(value, document.baseURI).href; } catch { return null; }
            return Array.from(root.querySelectorAll('img')).find(image =>
              image.complete && image.naturalWidth > 0 && (image.currentSrc === wanted || image.src === wanted)
            ) || null;
          }
          const before = obtain(d.before), after = obtain(d.after);
          if (!before || !after || before === after) return;
          const make = (tag, suffix, text) => {
            const n = document.createElement(tag); n.className = 'wss-before-after-reveal__' + suffix;
            if (text != null) n.textContent = text; return n;
          };
          const body = make('figure', 'body'), stage = make('div', 'stage'), title = make('figcaption', 'title', d.title);
          before.classList.add('wss-before-after-reveal__before'); after.classList.add('wss-before-after-reveal__after');
          before.alt = 'Before — ' + d.title; after.alt = 'After — ' + d.title;
          before.setAttribute('data-wss-kit-before-after-reveal-done', '1'); after.setAttribute('data-wss-kit-before-after-reveal-done', '1');
          const labels = make('div', 'labels');
          labels.append(make('span', 'label', 'Before'), make('span', 'label', 'After'));
          const control = make('label', 'control', 'Compare before and after');
          const range = make('input', 'range'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '50'; range.step = '1';
          const update = () => {
            const value = Math.max(0, Math.min(100, Number(range.value)));
            stage.style.setProperty('--wss-before-after-split', String(value) + '%');
            range.setAttribute('aria-valuetext', String(value) + ' percent before image');
          };
          range.addEventListener('input', update); control.appendChild(range);
          stage.append(before, after); body.append(stage, labels, control, title); update();
          root.replaceChildren(body); root.classList.add('wss-before-after-reveal');
          root.setAttribute('data-wss-kit-before-after-reveal-done', '1'); root.setAttribute('data-wss-kit-class', 'showcase');
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
  name: 'before-after-reveal',
  version: 1,
  class: 'showcase',
  composesWith: Object.freeze(['reviews', 'cta-accent']),
  activation: 'flag:kit_before_after_reveal',
  budget: Object.freeze({ family: "before-after", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!input(ctx)) return '';
    return `
.wss-before-after-reveal { color:var(--wss-text); background:var(--wss-surface); }
.wss-before-after-reveal__body { margin:0; padding:1rem; border:1px solid var(--wss-border); border-radius:1.5rem; }
.wss-before-after-reveal__stage { position:relative; overflow:hidden; border-radius:1rem; background:var(--wss-surface-alt); }
.wss-before-after-reveal__before { display:block; inline-size:100%; block-size:auto; }
.wss-before-after-reveal__after { position:absolute; inset:0; display:block; inline-size:100%; block-size:100%; object-fit:contain; clip-path:inset(0 0 0 var(--wss-before-after-split,50%)); background:var(--wss-surface-alt); }
.wss-before-after-reveal__labels { display:flex; justify-content:space-between; gap:1rem; margin-block:.5rem; }
.wss-before-after-reveal__label { font-size:.875rem; }
.wss-before-after-reveal__control { display:flex; flex-direction:column; gap:.5rem; margin-block:1rem; }
.wss-before-after-reveal__range { inline-size:100%; min-block-size:44px; accent-color:var(--wss-text); }
.wss-before-after-reveal__range:focus-visible { outline:2px solid var(--wss-text); outline-offset:3px; }
.wss-before-after-reveal__title { line-height:1.5; overflow-wrap:anywhere; }
@media (prefers-reduced-motion:reduce) {
  .wss-before-after-reveal, .wss-before-after-reveal__body, .wss-before-after-reveal__stage,
  .wss-before-after-reveal__before, .wss-before-after-reveal__after, .wss-before-after-reveal__labels,
  .wss-before-after-reveal__control, .wss-before-after-reveal__range, .wss-before-after-reveal__title {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { const d = input(ctx); return d ? emit(d) : null; },
  notes: 'Requires both verified client images from an explicit ctx.business.beforeAfter pair. To honor zero requests, images must either be supplied raster data URIs or already-loaded matching image nodes inside the assigned replacement slot; remote or local URLs are never newly assigned. Existing loaded nodes are moved, not cloned. A native keyboard-accessible range changes clipping directly with no autoplay or transition. One image, the same image twice, stock fallback or missing image bytes omits the reveal.'
});
