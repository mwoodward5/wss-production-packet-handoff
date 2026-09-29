"use strict";

// test/fixtures/mirror-xray.js — a page shaped like a live mirror.
//
// Geometry taken from the real thing: a 72px fixed header carrying a 56px flex
// row, the logo wrapped in an <a> that hugs it EXACTLY (which is what broke the
// first fit check), a tel: CTA on the right, a full-bleed hero with a video and
// an h1, a social block far down the page, and a SECOND logo in the footer —
// the two-logo case that made "the logo" ambiguous.
//
// Zones and folds are computed the way lib/page-xray.js computes them, so a
// test that passes here is testing the shape the real capture produces.

const VW = 1280;
const VH = 800;

function el(overrides) {
  const rect = overrides.rect;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const col = cx < VW / 3 ? "left" : cx > (VW * 2) / 3 ? "right" : "centre";
  let zone;
  if (cy > VH) {
    const screens = Math.max(1, Math.round(cy / VH));
    zone = screens <= 1 ? `just below the fold, ${col}` : `${screens} screens down, ${col}`;
  } else {
    const row = cy < VH / 3 ? "top" : cy > (VH * 2) / 3 ? "bottom" : "middle";
    zone = `${row} ${col}`;
  }
  return {
    index: 0, depth: 0, tag: "div", role: "", name: "", nameable: false, clipped_out: false,
    synonyms: [], hints: [], cropPriority: 99, text: "", selector: null, selector_stable: false,
    visible: { w: rect.w, h: rect.h }, view: { x: rect.x, y: rect.y }, fixed: false,
    zone, fold: rect.y < VH ? "above" : "below",
    z: { index: "auto", stacking_context: false, document_order: 0 },
    topmost: true, covered_by: "", contrast: null, image: null, media: null,
    overflow: { viewport_px: 0, viewport_side: "", clipped_px: 0, parent_overflow: "", clipped_by: "" },
    src: "", alt: "", href: "",
    style: {
      display: "block", position: "static", fontSize: "16px", color: "rgb(20,20,20)",
      backgroundColor: "rgba(0,0,0,0)", objectFit: "", flexDirection: "", overflow: "visible visible",
    },
    ...overrides,
  };
}

function mirrorXray() {
  const elements = [
    el({ index: 0, depth: 0, tag: "div", selector: "#root", rect: { x: 0, y: 0, w: 1280, h: 2100 } }),
    el({
      index: 1, depth: 1, tag: "header", role: "banner", name: "header", nameable: true,
      synonyms: ["top bar", "nav bar", "the top of the page", "menu bar"], hints: ["header"],
      selector: "header", selector_stable: true, fixed: true,
      style: { display: "flex", position: "fixed", fontSize: "16px", flexDirection: "row", objectFit: "" },
      rect: { x: 0, y: 0, w: 1280, h: 72 },
    }),
    el({
      index: 2, depth: 2, tag: "div", selector: 'header div:has(> a > img[src*="client-logo"])',
      selector_stable: true, hints: ["nav"],
      style: { display: "flex", position: "static", fontSize: "16px", flexDirection: "row", objectFit: "" },
      rect: { x: 24, y: 8, w: 1232, h: 56 },
    }),
    el({
      index: 3, depth: 3, tag: "a", role: "link", href: "#top",
      selector: 'header a:has(img[src*="client-logo"])', selector_stable: true,
      rect: { x: 24, y: 14, w: 132, h: 44 },
    }),
    el({
      index: 4, depth: 4, tag: "img", role: "img", name: "logo", nameable: true,
      synonyms: ["brand", "mark", "wordmark", "brand mark", "company logo"],
      hints: ["logo"], cropPriority: 1,
      selector: 'header img[src*="client-logo"]', selector_stable: true,
      src: "/assets/client-logo.png", alt: "Rimrock Plumbing",
      image: {
        natural: { w: 512, h: 171 }, displayed: { w: 132, h: 44 }, fit: "contain",
        scale: 0.26, distortion: 1.0, hidden_fraction: null, verdicts: [],
      },
      rect: { x: 24, y: 14, w: 132, h: 44 },
    }),
    el({
      index: 5, depth: 3, tag: "a", role: "link", name: "call button", nameable: true,
      synonyms: ["phone", "phone number", "call us", "the number", "call button"],
      hints: ["cta", "call"], cropPriority: 2, text: "CALL (520) 555-0142",
      href: "tel:5205550142", selector: 'header a[href^="tel:"]', selector_stable: true,
      rect: { x: 1060, y: 16, w: 196, h: 40 },
    }),
    el({
      index: 6, depth: 1, tag: "section", role: "region", name: "hero", nameable: true,
      synonyms: ["hero section", "the big image at the top", "top section", "banner"],
      hints: ["hero"], cropPriority: 3, selector: "section#top", selector_stable: true,
      rect: { x: 0, y: 72, w: 1280, h: 800 },
    }),
    el({
      index: 7, depth: 2, tag: "video", role: "video", name: "background video", nameable: true,
      synonyms: ["hero video", "video", "clip"], cropPriority: 4,
      selector: "section#top video", selector_stable: true,
      media: { paused: false, muted: true, loop: true, currentSrc: "/assets/hero.mp4" },
      image: {
        natural: { w: 1920, h: 1080 }, displayed: { w: 1280, h: 800 }, fit: "cover",
        scale: 0.67, distortion: 1.08, hidden_fraction: 0.07, verdicts: [],
      },
      style: { display: "block", position: "absolute", fontSize: "16px", objectFit: "cover", flexDirection: "" },
      rect: { x: 0, y: 72, w: 1280, h: 800 },
    }),
    el({
      index: 8, depth: 2, tag: "h1", role: "heading", name: "main headline", nameable: true,
      synonyms: ["headline", "the big text", "title", "heading"], cropPriority: 3,
      text: "WE HOLD THE LINE", selector: "h1", selector_stable: true,
      style: {
        display: "block", position: "relative", fontSize: "56px",
        color: "rgb(245,245,240)", flexDirection: "", objectFit: "",
      },
      rect: { x: 120, y: 300, w: 700, h: 120 },
    }),
    el({
      index: 9, depth: 1, tag: "section", role: "region", name: "section", nameable: true,
      synonyms: ["block", "part of the page"], selector: "main > section:nth-of-type(2)",
      rect: { x: 0, y: 872, w: 1280, h: 600 },
    }),
    el({
      index: 10, depth: 2, tag: "h2", role: "heading", name: "section heading", nameable: true,
      synonyms: ["heading", "subheading"], text: "What we do",
      selector: "main > section:nth-of-type(2) h2",
      rect: { x: 120, y: 940, w: 500, h: 60 },
    }),
    el({
      index: 11, depth: 1, tag: "section", role: "region", name: "section", nameable: true,
      synonyms: ["block", "part of the page"], hints: ["social"],
      selector: "main > section:nth-of-type(3)", selector_stable: true,
      rect: { x: 0, y: 1472, w: 1280, h: 220 },
    }),
    el({
      index: 12, depth: 2, tag: "a", role: "link", href: "https://facebook.com/rimrock",
      name: 'link "Facebook"', nameable: true, synonyms: ["link"], text: "Facebook",
      selector: 'a[href*="facebook.com"]',
      rect: { x: 500, y: 1520, w: 48, h: 48 },
    }),
    el({
      index: 13, depth: 2, tag: "a", role: "link", href: "https://instagram.com/rimrock",
      name: 'link "Instagram"', nameable: true, synonyms: ["link"], text: "Instagram",
      selector: 'a[href*="instagram.com"]',
      rect: { x: 560, y: 1520, w: 48, h: 48 },
    }),
    el({
      index: 14, depth: 1, tag: "footer", role: "contentinfo", name: "footer", nameable: true,
      synonyms: ["the bottom", "bottom of the page"], selector: "footer", selector_stable: true,
      rect: { x: 0, y: 1692, w: 1280, h: 300 },
    }),
    el({
      index: 15, depth: 2, tag: "img", role: "img", name: "logo image", nameable: true,
      synonyms: ["brand", "mark", "wordmark", "brand mark", "company logo"], hints: ["logo"],
      selector: 'footer img[src*="client-logo"]', selector_stable: true,
      src: "/assets/client-logo.png",
      image: {
        natural: { w: 512, h: 171 }, displayed: { w: 120, h: 40 }, fit: "contain",
        scale: 0.23, distortion: 1.0, hidden_fraction: null, verdicts: [],
      },
      rect: { x: 580, y: 1750, w: 120, h: 40 },
    }),
  ];
  return {
    ok: true,
    url: "https://wss-test-rimrock-plumbing-billings.wss-ai.com/",
    status: 200,
    title: "Rimrock Plumbing",
    desktop: { label: "1280", viewport: { width: VW, height: VH }, elements, crops: [], defects: [] },
    elements,
    crops: [],
    defects: [],
  };
}

module.exports = { mirrorXray, el, VW, VH };
