"use strict";

// lib/mirror-engine/project-gallery.js — FEATURE 4: the before/after project
// gallery, as a self-contained build feature of the Mirror Engine.
//
// facts.project_photos (optional, validated at the facts boundary in
// facts.js) is an array of { before_url, after_url, caption? }. When at least
// one COMPLETE pair survives validation, this module renders a paired
// before/after section on the generated site's home page: side-by-side panes
// labelled BEFORE and AFTER, the client's caption under each pair, lazy-loaded
// imagery, and the fleet polish design language (--wss-a accent token,
// color-mix hairlines, clamp() type, 12-14px radii). When the field is absent
// — or holds no complete pair — the section is absent. Conditional by
// construction, never by a default that invents a project.
//
// The section is one self-contained block with its own scoped stylesheet and
// an idempotence marker (data-wss-gallery), wired into the engine's per-page
// emit AFTER edit replay and legal hygiene so the stage-10 scans measure the
// shipped bytes. A gallery failure never fails a build — it skips and the
// site ships as-built (the same contract fleet-polish carries).

const GALLERY_MARKER = "data-wss-gallery";
const GALLERY_VERSION = "v1";

// The engines' shared escaper discipline (content-inject.js): attribute-safe
// text everywhere a fact or URL reaches markup.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * The validated, renderable pairs. Mirrors the facts.js boundary's honesty
 * rules one last time at render: only entries with BOTH urls present count.
 * validateFacts already 422s junk shapes, so reaching this module with a
 * malformed entry means an unvalidated caller — the render simply skips the
 * entry rather than shipping a broken pane.
 */
function completePairs(facts = {}) {
  const raw = facts && Array.isArray(facts.project_photos) ? facts.project_photos : [];
  const pairs = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const before = String(item.before_url || "").trim();
    const after = String(item.after_url || "").trim();
    if (!/^https:\/\//i.test(before) || !/^https:\/\//i.test(after)) continue;
    const caption = String(item.caption || "").trim();
    pairs.push({ before_url: before, after_url: after, caption });
  }
  return pairs;
}

/**
 * The section's own stylesheet. Scoped to .wss-ba (before/after), speaking
 * the fleet polish tokens: --wss-a from the build's accent, color-mix
 * hairlines over currentColor so it reads correctly on light AND dark donor
 * canvases, clamp() display type, the shared 12-14px radius scale. The panes
 * carry a fixed 4/3 aspect-ratio so the rows reserve their height before the
 * (lazy) images decode — a gallery that loads late must not shift the page.
 */
function galleryCss() {
  return [
    // Accent chain: the theme's triplet first (see content-inject.js
    // CONTENT_CSS — generic blue is banned), then a shadcn donor's own
    // --accent, then a warm brick constant.
    ".wss-ba{--wss-a:var(--wss-accent-hsl,var(--accent,8 61% 40%));padding:clamp(3rem,7vw,6rem) 1.25rem;font-family:inherit}",
    ".wss-ba__inner{max-width:1160px;margin:0 auto}",
    ".wss-ba__eyebrow{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;opacity:.62;margin:0 0 .6rem}",
    ".wss-ba h2{font-size:clamp(1.6rem,3.4vw,2.5rem);line-height:1.1;margin:0 0 1.6rem;font-family:var(--font-display,inherit);letter-spacing:-.02em}",
    ".wss-ba__rule{height:3px;width:56px;border-radius:2px;background:hsl(var(--wss-a));margin:0 0 1.6rem}",
    ".wss-ba__grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}",
    ".wss-ba__pair{margin:0 0 1.6rem}",
    ".wss-ba__panes{display:grid;gap:.75rem;grid-template-columns:1fr}",
    "@media(min-width:640px){.wss-ba__panes{grid-template-columns:1fr 1fr}}",
    ".wss-ba__pane{position:relative;margin:0;border-radius:14px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 3%,transparent)}",
    ".wss-ba__pane img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}",
    ".wss-ba__tag{position:absolute;top:.6rem;left:.6rem;z-index:1;font-size:.66rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:.3rem .6rem;border-radius:999px;color:#fff;background:color-mix(in srgb,currentColor 55%,transparent);backdrop-filter:blur(2px)}",
    ".wss-ba__tag--before{background:color-mix(in srgb,#111827 72%,transparent)}",
    ".wss-ba__tag--after{background:hsl(var(--wss-a))}",
    ".wss-ba__cap{margin:.7rem .15rem 0;font-size:.92rem;line-height:1.55;opacity:.86}",
    "@media(prefers-reduced-motion:reduce){.wss-ba *{transition:none!important;animation:none!important}}",
  ].join("\n");
}

/**
 * The section markup for the given pairs. Returns "" when there is nothing
 * honest to show — absence is the feature working, not a failure.
 */
function buildProjectGallery({ facts = {} } = {}) {
  const pairs = completePairs(facts);
  if (!pairs.length) return "";
  const business = String((facts && facts.business_name) || "").trim();

  const pairHtml = pairs.map((p, i) => {
    const cap = p.caption
      ? `<figcaption class="wss-ba__cap">${esc(p.caption)}</figcaption>`
      : "";
    const altBase = p.caption || (business ? `${business} project ${i + 1}` : `Project ${i + 1}`);
    return [
      `<figure class="wss-ba__pair" data-wss-gallery-pair="${i + 1}">`,
      `<div class="wss-ba__panes">`,
      `<figure class="wss-ba__pane"><span class="wss-ba__tag wss-ba__tag--before" aria-hidden="true">Before</span>`,
      `<img src="${esc(p.before_url)}" alt="${esc(altBase)} — before, ${esc(business || "the project as it was")}" loading="lazy" decoding="async">`,
      `</figure>`,
      `<figure class="wss-ba__pane"><span class="wss-ba__tag wss-ba__tag--after" aria-hidden="true">After</span>`,
      `<img src="${esc(p.after_url)}" alt="${esc(altBase)} — after, ${esc(business ? `completed by ${business}` : "the completed project")}" loading="lazy" decoding="async">`,
      `</figure>`,
      `</div>`,
      cap,
      `</figure>`,
    ].join("");
  }).join("\n");

  return [
    `<section class="wss-c wss-ba" id="before-after" aria-labelledby="wss-ba-h" ${GALLERY_MARKER}="${GALLERY_VERSION}">`,
    `<style>${galleryCss()}</style>`,
    `<div class="wss-ba__inner">`,
    `<p class="wss-ba__eyebrow">Recent work</p>`,
    `<h2 id="wss-ba-h">Before &amp; After${business ? ` — ${esc(business)}` : ""}</h2>`,
    `<div class="wss-ba__rule" aria-hidden="true"></div>`,
    pairHtml,
    `</div>`,
    `</section>`,
  ].join("\n");
}

/**
 * Per-page emit: inject the section into the site's home page, following the
 * same placement law as the content block — before a static footer that is
 * NOT inside a hydration root (the React #418 lesson from content-inject.js),
 * else straight before </body> where nothing can unmount it.
 *
 * Idempotent by marker: a page already carrying data-wss-gallery is returned
 * unchanged. Never throws; a page without an anchor is skipped with a reason.
 */
function injectProjectGallery({ files = {}, facts = {} } = {}) {
  const out = { ...files };
  const report = { present: false, pairs: 0, pages: 0, bytes: 0, reason: "" };
  const pairs = completePairs(facts);
  report.pairs = pairs.length;

  if (!pairs.length) {
    report.reason = facts && facts.project_photos != null
      ? "project_photos_supplied_but_no_complete_pair"
      : "no_project_photos";
    return { files: out, report };
  }

  // The engine's file map carries Buffers; direct callers may pass strings.
  // Output keeps the entry's original kind, so the map stays consistent.
  const raw = out["index.html"];
  const html = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : "";
  if (html) {
    const asBuffer = Buffer.isBuffer(raw);
    const already = html.includes(`${GALLERY_MARKER}="${GALLERY_VERSION}"`);
    if (!already) {
      const section = buildProjectGallery({ facts });
      if (/<\/body>/i.test(html)) {
        // Static footer outside a hydration root: the section reads in
        // document order right above it. A prerendered app (the footer React
        // is about to hydrate) gets the </body> anchor instead — outside the
        // root, present with JS disabled.
        const rootTag = /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>/i.exec(html);
        const nonEmptyRoot = !!rootTag
          && !new RegExp(`${rootTag[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</div>`, "i").test(html);
        const ssrMarker = /<!--\$-->|\$_TSR|__NEXT_DATA__|data-reactroot|self\.__next_f/.test(html);
        const footerIdx = !nonEmptyRoot && !ssrMarker && /<footer[\s>]/i.test(html)
          ? html.search(/<footer[\s>]/i)
          : -1;
        const next = footerIdx > -1
          ? html.slice(0, footerIdx) + section + "\n" + html.slice(footerIdx)
          : html.replace(/<\/body>/i, `${section}\n</body>`);
        out["index.html"] = asBuffer ? Buffer.from(next, "utf8") : next;
        report.present = true;
        report.pages = 1;
        report.bytes = section.length;
      } else {
        report.reason = "no_body_close_tag_to_anchor_gallery";
      }
    } else {
      report.present = true;
      report.pages = 1;
      report.reason = "already_present";
    }
  } else {
    report.reason = "index_html_not_seen";
  }

  return { files: out, report };
}

module.exports = {
  GALLERY_MARKER,
  GALLERY_VERSION,
  completePairs,
  galleryCss,
  buildProjectGallery,
  injectProjectGallery,
};

// -------------------------------------------------------------------------
// Self-test: node lib/mirror-engine/project-gallery.js --test
// -------------------------------------------------------------------------
if (require.main === module && process.argv.includes("--test")) {
  const assert = require("node:assert/strict");
  const facts = {
    business_name: "Harbor Line Contracting",
    project_photos: [
      { before_url: "https://cdn.example.com/deck-before.jpg", after_url: "https://cdn.example.com/deck-after.jpg", caption: "Cedar deck rebuild" },
      { before_url: "https://cdn.example.com/wall-before.jpg", after_url: "https://cdn.example.com/wall-after.jpg" },
    ],
  };
  const html = buildProjectGallery({ facts });
  assert.ok(html.includes("wss-ba__tag--before") && html.includes("Before"));
  assert.ok(html.includes("wss-ba__tag--after") && html.includes("After"));
  assert.ok((html.match(/loading="lazy"/g) || []).length === 4);
  assert.ok(html.includes("Cedar deck rebuild"));
  assert.ok(html.includes("data-wss-gallery=\"v1\""));
  assert.equal(buildProjectGallery({ facts: {} }), "");
  assert.equal(buildProjectGallery({ facts: { project_photos: [{ before_url: "https://x/a.jpg" }] } }), "");
  const files = { "index.html": "<html><body><footer>f</footer></body></html>" };
  const one = injectProjectGallery({ files, facts });
  assert.equal(one.report.present, true);
  const twice = injectProjectGallery({ files: one.files, facts });
  assert.equal(twice.report.reason, "already_present");
  assert.equal(twice.files["index.html"], one.files["index.html"]);
  console.log("project-gallery self-test: OK");
}
