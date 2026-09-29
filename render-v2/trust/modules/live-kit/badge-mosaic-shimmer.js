'use strict';

/*
 * badge-mosaic-shimmer.js — wave 1 reference module #1 (AUTHORITY-KIT-PORT-PLAN
 * §5.1.1), restored to its pinned contract (test/kit-badge-mosaic-shimmer.test.js).
 *
 * Pure CSS, presentation-only upgrade of the engine's verified trust-badge
 * rail: a one-shot entrance stagger (wssTbMosaicIn, 0.55s, visible-safe
 * opacity 0.4 start) that COMPOSES with the engine's own wssTileFloat — the
 * float owns translate forever, the entrance never touches it, and every
 * entrance delay rule re-states the float's delay so the longhand never
 * blanks it. A gold hover overlay (armed only on hover/focus, parked at rest)
 * and a static every-5th feature chip complete the mosaic. No markup
 * generation, copied badges, invented claims, or external assets; the chip
 * count itself stays the engine's business.
 */

module.exports = Object.freeze({
  name: 'badge-mosaic-shimmer',
  version: 1,

  activation: 'flag:kit_badge_mosaic_shimmer',

  // §3 restraint law: the module's own family is a one-time entrance; the
  // 8s float loop that keeps running is the engine's own, not ours.
  budget: Object.freeze({
    family: 'entrance',
    ambientLoop: null,
    dwell: '0.55s one-shot entrance, settles to rest',
    stagger: '0.15s per chip, cap 4',
    maxPerViewport: 4
  }),

  css(ctx) {
    const accent = (ctx && ctx.palette && ctx.palette.accent) || '#3b82f6';
    const border = (ctx && ctx.palette && ctx.palette.border) || '#2a2f38';
    return `
/* wss-kit badge-mosaic-shimmer: entrance stagger over the engine trust chips; wssTileFloat keeps running. */
#trust-badges .wss-tb__floatchip {
  position: relative;
  min-inline-size: 64px;
  min-block-size: 40px;
  border-color: color-mix(in srgb, var(--wss-accent, ${accent}) 35%, var(--wss-border, ${border}));
}
#trust-badges .wss-tb__floatchip::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(105deg, transparent 42%, hsl(var(--wss-gold, 42 95% 54%)) 46%, transparent 54%);
  -webkit-mask-image: linear-gradient(105deg, transparent 40%, #fff 50%, transparent 60%);
  mask-image: linear-gradient(105deg, transparent 40%, #fff 50%, transparent 60%);
  -webkit-mask-size: 250% 100%;
  mask-size: 250% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: 100% 0;
  mask-position: 100% 0;
}
#trust-badges .wss-tb__floatchip:hover::after,
#trust-badges .wss-tb__floatchip:focus-visible::after {
  -webkit-mask-position: 0% 0;
  mask-position: 0% 0;
  opacity: 1;
}
#trust-badges .wss-tb__floatchip:nth-of-type(5n+1) {
  scale: 1.06;
  border-image: linear-gradient(120deg, hsl(var(--wss-gold, 42 95% 54%)) 46%, transparent 54%) 1;
}
@media (prefers-reduced-motion: no-preference) {
#trust-badges .wss-tb__floatchip {
  animation: wssTbMosaicIn 0.55s cubic-bezier(0.2, 0.75, 0.3, 1.3) both, wssTileFloat 8s ease-in-out infinite;
  animation-delay: 0s, calc(var(--wss-tf-i, 0) * 1.7s);
}
#trust-badges .wss-tb__floatchip:nth-child(4n+2) {
  animation-delay: 0.15s, calc(var(--wss-tf-i, 0) * 1.7s);
}
#trust-badges .wss-tb__floatchip:nth-child(4n+3) {
  animation-delay: 0.3s, calc(var(--wss-tf-i, 0) * 1.7s);
}
#trust-badges .wss-tb__floatchip:nth-child(4n+4) {
  animation-delay: 0.45s, calc(var(--wss-tf-i, 0) * 1.7s);
}
#trust-badges .wss-tb__floatchip::after {
  transition: opacity 0.25s ease, -webkit-mask-position 0.25s ease, mask-position 0.25s ease;
}
}
@keyframes wssTbMosaicIn {
  from {
    opacity: 0.4;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
#trust-badges .wss-tb__floatchip,
#trust-badges .wss-tb__floatchip::after {
  animation: none !important;
  transition: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  content: none !important;
}
}
`.trim();
  },

  js() {
    return null; // pure CSS module — no script payload ever
  },

  notes:
    'Presentation-only upgrade of the engine\'s verified trust-badge rail: a ' +
    'one-shot 0.55s entrance (visible-safe 0.4 opacity start) staggered ' +
    '0/.15/.3/.45 across at most four chips, composited with the engine\'s ' +
    'own wssTileFloat 8s loop — the float owns translate; every entrance ' +
    'delay rule re-states the float delay. A gold hover overlay is armed ' +
    'only on hover/focus (parked, opacity 0, mask 250% at rest) and the ' +
    'every-5th chip is static emphasis. No markup generation, no copied ' +
    'badges, no invented claims; the reduce twin kills the entrance, the ' +
    'masks, and the overlay content.'
});
