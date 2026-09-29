'use strict';

function enabled(ctx) {
  return ctx?.donor?.flags?.kit_speed_vitals_guard === true &&
    typeof ctx?.business?.name === 'string' && Boolean(ctx.business.name.trim());
}

function emit() {
  return '<script data-wss-kit="speed-vitals-guard">(' + function () {
    'use strict';
    try {
      if (!window.IntersectionObserver) return;
      const tracked = new Map();
      const reduced = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      function safe(root) {
        return !root.closest('form,footer,[role="contentinfo"],[data-wss-chat-launcher],.wss-chat') &&
          !root.querySelector('form,footer,[role="contentinfo"],video,h1,[data-wss-chat-launcher],.wss-chat');
      }

      function refresh(root, visible) {
        try {
          if (!root.isConnected) { observer.unobserve(root); tracked.delete(root); return; }
          root.classList.toggle('wss-speed-vitals-guard--paused', document.hidden || !visible);
          if (reduced()) root.classList.add('wss-speed-vitals-guard--reduced');
          else root.classList.remove('wss-speed-vitals-guard--reduced');
        } catch {}
      }

      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          tracked.set(entry.target, entry.isIntersecting);
          refresh(entry.target, entry.isIntersecting);
        }
      }, { rootMargin: '100px', threshold: 0 });

      function arm() {
        try {
          for (const root of document.querySelectorAll('.wss-kit-slot[data-wss-vitals-guard="true"]')) {
            if (tracked.has(root) || !safe(root)) continue;
            root.classList.add('wss-speed-vitals-guard');
            root.setAttribute('data-wss-kit-speed-vitals-guard-done', '1');
            const box = root.getBoundingClientRect();
            const visible = box.bottom >= -100 && box.top <= innerHeight + 100;
            tracked.set(root, visible); refresh(root, visible); observer.observe(root);
          }
        } catch {}
      }

      const refreshAll = () => {
        try { for (const [root, visible] of tracked) refresh(root, visible); } catch {}
      };

      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
      else arm();
      window.addEventListener('load', arm, { once: true });
      document.addEventListener('visibilitychange', refreshAll);
      window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', refreshAll);

      const hydration = new MutationObserver(arm);
      hydration.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => hydration.disconnect(), 6000);
      window.addEventListener('pagehide', () => { hydration.disconnect(); }, { once: true });
    } catch {}
  }.toString() + ')();<\/script>';
}

module.exports = Object.freeze({
  name: 'speed-vitals-guard',
  version: 1,
  class: 'ambient',
  composesWith: Object.freeze(['reviews', 'badges', 'showcase']),
  activation: 'flag:kit_speed_vitals_guard',
  budget: Object.freeze({ family: "none-invisible-guard", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),
  css(ctx) {
    if (!enabled(ctx)) return '';
    return `
.wss-speed-vitals-guard--paused,
.wss-speed-vitals-guard--paused :is([class^="wss-"],[class*=" wss-"]),
.wss-speed-vitals-guard--paused::before,
.wss-speed-vitals-guard--paused::after,
.wss-speed-vitals-guard--paused :is([class^="wss-"],[class*=" wss-"])::before,
.wss-speed-vitals-guard--paused :is([class^="wss-"],[class*=" wss-"])::after {
  animation-play-state:paused!important;
}
.wss-speed-vitals-guard--reduced,
.wss-speed-vitals-guard--reduced :is([class^="wss-"],[class*=" wss-"]),
.wss-speed-vitals-guard--reduced::before,
.wss-speed-vitals-guard--reduced::after,
.wss-speed-vitals-guard--reduced :is([class^="wss-"],[class*=" wss-"])::before,
.wss-speed-vitals-guard--reduced :is([class^="wss-"],[class*=" wss-"])::after {
  animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
}
@media (prefers-reduced-motion:reduce) {
  .wss-speed-vitals-guard,
  .wss-speed-vitals-guard :is([class^="wss-"],[class*=" wss-"]),
  .wss-speed-vitals-guard::before,
  .wss-speed-vitals-guard::after,
  .wss-speed-vitals-guard :is([class^="wss-"],[class*=" wss-"])::before,
  .wss-speed-vitals-guard :is([class^="wss-"],[class*=" wss-"])::after {
    animation:none!important; transition:none!important; -webkit-mask:none!important; mask:none!important; filter:none!important;
  }
}`.trim();
  },
  js(ctx) { return enabled(ctx) ? emit() : null; },
  notes:
    'Flag-only invisible guard with zero visual alpha and no animation family. ' +
    'Only explicitly opted-in, kit-owned slots are observed; forms, footers, ' +
    'chat, headlines and video-containing regions are excluded. Offscreen or ' +
    'background-tab CSS animations pause without removing verified content, ' +
    'changing media sources, delaying images, introducing fonts or altering ' +
    'layout. This does not claim measured Core Web Vitals, sixty frames per ' +
    'second, zero layout shift or search-ranking improvement, and it does not ' +
    'pretend to suspend arbitrary JavaScript timers. The ambient classification ' +
    'reserves the page’s single ambient slot without adding visible decoration.'
});
