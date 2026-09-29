"use strict";
// lib/seo-page-edit.js — the "seo-page" edit kind.
//
// WHY THIS FILE EXISTS
// api/admin/run-edit-job.js used to hand EVERY instruction to
// lib/site-editor.js runSiteEdit(), which asks an LLM to return every changed
// file in full. Measured against the live Flint site that path cannot add a
// page to the nav at all: index.html alone is 58,848 bytes (~17k output
// tokens) and runSiteEdit caps the model at max_tokens 16000, so the one file
// that carries the nav can never be returned complete. The model's output is
// truncated mid-file, the `<file path=...>` regex drops the unterminated
// block, and the job still reports "done" — a new page ships with no nav link
// and nothing in the sitemap. There is also no rule in that prompt about
// sitemap.xml at all.
//
// So this kind is DETERMINISTIC, not generative:
//   - the page is assembled from facts the site already publishes about
//     itself (llms.txt + the index.html data-* block), never from a model,
//   - the nav and sitemap edits are surgical string inserts, so index.html
//     never has to be regenerated,
//   - the page is refused unless the requested topic is a service the
//     business ALREADY lists, and
//   - the finished HTML is scanned for invented-claim language before it is
//     allowed anywhere near a deploy.
//
// Fabrication is the recurring failure in this system (donor PII leaks,
// invented services, fake reviews). A page nobody can prove came from the
// client's own facts is worse than no page, so every string on it traces back
// to the archive.

const { listAll, download, upload } = require("./site-editor");
const { vercelDeploy } = require("./forge");

// ---------------------------------------------------------------------------
// Kind classification
// ---------------------------------------------------------------------------
// ghost_agency_edit_jobs has no `kind` column (id, job_id, site_slug,
// instruction, status, result, created_at, updated_at), and adding one would
// need a migration on a table Riley already writes to in production. The kind
// is therefore derived from the instruction, conservatively: anything that is
// not clearly "make me a new page" falls through to the existing generic
// editor, which is the pre-existing behaviour.
const SEO_PAGE_PATTERNS = [
  /\b(seo|landing|service|location)\s+page\b/i,
  /\b(add|create|build|make|write|publish)\s+(me\s+)?(a|an|another|new)?\s*(seo|landing|service|location)?\s*page\b/i,
  /\bnew page\b/i,
];

// The GRID, as distinct from ONE page. A grid request is a PLURAL page request
// with a scope: "pages for every town we serve", "service pages for all my
// cities". The plural noun is the load-bearing word — "add an SEO page for
// water heaters" is the single-page kind and must stay that way, so these
// patterns require either the strict plural "pages" beside a scope word, or
// the word "grid" itself. An optional "up to N / max N" phrase is read as the
// caller's own cap; the grid re-caps it server-side regardless.
const SEO_GRID_SCOPE = /\b(all|every|each|bulk|batch|multiple|towns|cities|areas?|grid|coverage)\b/i;
const SEO_GRID_PAGES = /\bpages\b/i;
const SEO_GRID_CAP = /\b(?:up\s+to|max(?:imum)?|cap(?:ped)?(?:\s+at)?|limit(?:\s+of)?|top)\s+(\d{1,2})\b/i;

/** True when an instruction asks for a bounded GRID of pages, not one page. */
function isSeoGridRequest(instruction) {
  const text = String(instruction || "");
  if (!text) return false;
  if (/\bgrid\b/i.test(text)) return true;
  return SEO_GRID_PAGES.test(text) && SEO_GRID_SCOPE.test(text);
}

/** -> { grid: true, cap: n|null } for a grid request, else { grid: false }. */
function classifySeoGridRequest(instruction) {
  const text = String(instruction || "");
  if (!isSeoGridRequest(text)) return { grid: false };
  const m = text.match(SEO_GRID_CAP);
  const cap = m ? Math.max(1, Math.min(25, parseInt(m[1], 10))) : null;
  return { grid: true, cap };
}

function classifyEditKind(instruction) {
  const text = String(instruction || "");
  if (isSeoGridRequest(text)) return "seo-grid";
  return SEO_PAGE_PATTERNS.some((re) => re.test(text)) ? "seo-page" : "generic";
}

// ---------------------------------------------------------------------------
// Facts — everything the page is allowed to say about the business
// ---------------------------------------------------------------------------
/**
 * Parse the site's own published facts out of its archived files. llms.txt is
 * the canonical source (the mirror engine writes it from the verified business
 * record); index.html's root data-* block supplies the geo fields.
 */
function parseSiteFacts({ llms = "", index = "" } = {}) {
  const facts = { services: [] };
  const line = (label) => {
    const m = llms.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : "";
  };
  facts.businessName = line("Business");
  facts.trade = line("Trade");
  facts.serves = line("Serves");
  facts.locatedIn = line("Located in");
  facts.address = line("Address");
  facts.phone = line("Phone");
  facts.website = line("Website");

  // THE BLOCK ENDS AT THE NEXT HEADER. The split used to take everything
  // after "## Services" to EOF — and llms.txt writes "## Service area" (and
  // "## Questions and answers") AFTER the services, so every town and FAQ
  // bullet after it leaked into facts.services as a "service". Harmless-looking
  // on a single page (the topic matcher needs instruction overlap), fatal on a
  // grid: the towns would grid against THEMSELVES as services. The section
  // bound is the same convention the reader above uses for every other
  // llms.txt section.
  const servicesBlock = (llms.split(/^##\s*Services\s*$/im)[1] || "").split(/^##\s/m)[0] || "";
  facts.services = servicesBlock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);

  const attr = (name) => {
    const m = index.match(new RegExp(`\\bdata-${name}="([^"]*)"`, "i"));
    return m ? m[1].trim() : "";
  };
  facts.city = attr("city") || (facts.serves.split(",")[0] || "").trim();
  facts.state = attr("region") || (facts.serves.split(",")[1] || "").trim();
  facts.postal = attr("postal");
  facts.addressCity = attr("address-city");

  const host = String(facts.website || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  facts.host = host;
  facts.origin = host ? `https://${host}` : "";
  return facts;
}

/** Every fact the page needs must be present; a half-known business gets no page. */
function assertFactsComplete(facts) {
  const missing = ["businessName", "city", "state", "phone", "origin"].filter((k) => !facts[k]);
  if (missing.length) throw new Error(`seo-page: site facts incomplete (${missing.join(", ")})`);
  if (!facts.services.length) throw new Error("seo-page: site publishes no service list to ground a page on");
}

// ---------------------------------------------------------------------------
// Topic — must be a service the business ALREADY lists
// ---------------------------------------------------------------------------
const STOP = new Set([
  "a", "an", "the", "add", "create", "build", "make", "write", "publish", "new", "page", "seo",
  "landing", "service", "services", "location", "for", "about", "on", "to", "our", "my", "me",
  "please", "site", "website", "and", "in", "with", "of", "put", "it", "nav", "menu", "sitemap",
]);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/** Singular/plural-tolerant token compare ("heaters" ~ "heater"). */
function stem(t) {
  return t.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
}

/**
 * Pick which of the business's OWN listed services the caller asked about.
 * Returns null when nothing matches — the caller must then be refused rather
 * than shipped a page for a service this business does not offer.
 */
function chooseTopic(instruction, services = []) {
  const want = tokens(instruction).map(stem);
  if (!want.length) return null;
  let best = null;
  for (const service of services) {
    const have = tokens(service).map(stem);
    if (!have.length) continue;
    const overlap = have.filter((t) => want.includes(t)).length;
    if (!overlap) continue;
    // Require the match to cover the service name, not just brush it: a
    // one-word hit on a multi-word service ("commercial" in "Commercial &
    // Multi-Family") is not a request for that page.
    const coverage = overlap / have.length;
    const score = overlap * 100 + Math.round(coverage * 10);
    if (coverage < 0.5) continue;
    if (!best || score > best.score) best = { service, score, overlap };
  }
  return best ? best.service : null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Page body — general-knowledge copy, never a claim about the client
// ---------------------------------------------------------------------------
// Each entry is keyed to a service the mirror engine actually emits. The copy
// is trade knowledge, phrased in the third person and hedged, plus a public
// reference. It never asserts anything about how THIS business works, what it
// charges, how fast it responds, or what it is licensed to do.
const TOPIC_COPY = {
  "water heaters": {
    description: (f) => `How residential water heaters age and fail, which symptoms point to a repair and which point to a replacement, and what to have ready before calling about a water heater in ${f.city}, ${f.state}.`,
    lede: (f) => `Water heaters are one of the few appliances in a house that fail wet. This page covers how residential units age, which symptoms usually point to a repair and which point to a replacement, and what information is worth having in hand before calling a plumber in ${f.city}.`,
    sections: [
      {
        h: "How a water heater ages",
        p: [
          "A conventional tank heater has a sacrificial anode rod inside it. The rod is designed to corrode so the steel tank does not, and once it is spent, corrosion moves to the tank wall. That is why a tank that has never been serviced tends to fail suddenly rather than gradually.",
          "Sediment is the other half of the story. Minerals settle out of heated water and collect on the bottom of the tank, insulating the burner from the water above it. The unit works longer for the same amount of hot water, and the trapped steam escaping through that layer is the rumbling or popping some tanks develop.",
          "Rusty water from the hot side only, water that runs out sooner than it used to, a longer recovery between showers, or any moisture around the base are the signals worth acting on early. The US Department of Energy publishes maintenance and efficiency guidance for both tank and tankless systems.",
        ],
      },
      {
        h: "Repair or replace",
        table: {
          caption: "General guidance for household water heaters — not a diagnosis, an estimate, or a service promise.",
          head: ["What you are seeing", "Usually points to", "Why"],
          rows: [
            ["No hot water, tank otherwise dry", "A repair", "Thermostats, heating elements and gas control valves are serviceable parts"],
            ["Temperature and pressure valve weeping", "A repair, promptly", "The T&P valve is a safety device — it is replaced, never plugged or capped"],
            ["Rumbling or popping while heating", "A service, then a decision", "Usually sediment; flushing may recover efficiency on a younger tank"],
            ["Rusty water only on the hot side", "An inspection", "Often anode depletion; the tank itself may still be sound"],
            ["Standing water under the tank", "A replacement", "A breached tank cannot be patched safely"],
            ["A major part failing on an old unit", "A replacement decision", "Repair cost is weighed against remaining service life"],
          ],
        },
      },
      {
        h: "Worth having ready when you call",
        list: [
          "Whether the unit is gas or electric, and tank or tankless",
          "The capacity and model number from the label on the side of the unit",
          "Roughly how old it is — the manufacture date is usually encoded in the serial number",
          "What you are actually observing: no hot water, not enough of it, discolored water, noise, or moisture",
          "Whether you can reach the cold-water shutoff above the tank, and the gas or breaker shutoff",
        ],
        note: "If there is water on the floor and the shutoff above the tank is safely reachable, closing it stops the supply while you wait.",
      },
    ],
    reference: { label: "US Department of Energy — Water Heating", href: "https://www.energy.gov/energysaver/water-heating" },
  },
  // GRID DEPTH (2026-09-02): drains are on nearly every plumbing mirror's own
  // service list, so a service×town grid hits the topic constantly. Same
  // discipline as the entry above — trade-general, hedged, third person, one
  // public reference, nothing about how THIS business works.
  drains: {
    description: (f) => `Why household drains slow down, which symptoms point at a fixture and which point further down the line, and what to have ready before calling about a drain in ${f.city}, ${f.state}.`,
    lede: (f) => `A slow drain is a symptom, and one symptom can have several causes: a clogged trap, scale narrowing the pipe, a venting fault, or trouble well past the fixture. This page covers how drains fail and what is worth knowing before booking drain work in ${f.city}.`,
    sections: [
      {
        h: "How drains fail",
        p: [
          "Most fixture drains narrow gradually. Fats cooled inside a kitchen line, soap and hair snagging in a bath or shower trap, and mineral scale on older pipe all build the same way: layer on layer, until what carried away a full basin barely manages a trickle. Because the narrowing is gradual, the first real slowdown usually understates how far along the blockage is.",
          "Not every slow drain is a clog, though. A vent that has lost its airway makes a fixture drain in gulps; a sag or belly in a run under the slab collects solids forever; and roots find a hairline joint in an older sewer line and widen it from the outside in. Those are line problems wearing a fixture problem's clothes, which is why a recurring blockage on the same fixture is worth a proper look rather than a fourth bottle of drain opener.",
          "Chemical openers deserve a caution of their own. They can clear the soft middle of a clog while leaving the pipe walls coated, and a line that then still runs slow has both the original blockage and a dose of caustic sitting in it. The US Environmental Protection Agency's WaterSense program publishes general guidance on household leaks and drain maintenance.",
        ],
      },
      {
        h: "Symptoms and what they usually point to",
        table: {
          caption: "General drain guidance — not a diagnosis, an estimate, or a service promise.",
          head: ["What you are seeing", "Usually points to", "Why"],
          rows: [
            ["One fixture slow, others fine", "A local clog", "Trap or branch line serving that fixture alone"],
            ["Several fixtures slow at once", "A shared branch or the main line", "Downstream of the point where the fixtures join"],
            ["Gurgling when another fixture drains", "A venting or partial-blockage symptom", "Air is being pulled through the water in the trap"],
            ["Water backs up in a low fixture when a washer drains", "A main-line restriction", "The surge has nowhere to go past the narrowing"],
            ["The same fixture blocks again and again", "A line problem, not a fresh clog", "Scale, a sag, or roots rarely clear with a cable alone"],
          ],
        },
      },
      {
        h: "Worth having ready when you call",
        list: [
          "Which fixtures are slow, and whether they started together or one at a time",
          "Whether anything backs up elsewhere in the building when water runs",
          "How long the symptom has been building, and what has already been tried",
          "Whether the line has been cleared before, and how long ago",
        ],
        note: "If a fixture is overflowing, stop using the water in that part of the building and keep people and pets away from the water until it is handled.",
      },
    ],
    reference: null,
  },
};

// A generic, trade-neutral fallback so this kind is not limited to the one
// topic above. It says less, because saying more without trade-specific
// grounding is exactly how invented claims get on a page.
function genericCopy(topic) {
  return {
    lede: (f) => `${topic} is one of the services ${f.businessName} lists. This page explains what the work generally involves and what is worth knowing before booking it in ${f.city}.`,
    sections: [
      {
        h: `What ${topic.toLowerCase()} work usually involves`,
        p: [
          `${topic} is diagnostic work before it is repair work: the visible symptom is often the end of a longer chain, and a fair question to ask any contractor is what they measure, not only what they replace.`,
          "Getting a written scope before work starts — what is being replaced, what is being left alone, and what happens if the diagnosis changes once things are open — keeps the job comparable between providers.",
        ],
      },
      {
        h: "Worth having ready when you call",
        list: [
          "What you are observing, and when it started",
          "Anything that changed in the building recently",
          "Photographs of the area, if it is safe to take them",
          "Where the relevant shutoff is, if there is one",
        ],
      },
    ],
    reference: null,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Lift the site's own <style> block off an existing sub-page so the new page
 * is visually the same page. Generating fresh CSS would produce a page that
 * looks like a different site wearing the same logo.
 */
function extractStyleBlock(aboutHtml) {
  const m = String(aboutHtml || "").match(/<style>[\s\S]*?<\/style>/i);
  if (!m) throw new Error("seo-page: no existing style block to inherit from (expected about.html)");
  return m[0];
}

// The static sub-page stylesheet colours everything from --accent, and NOTHING
// on these mirrors ever defines it — so about.html has been rendering with the
// stylesheet's generic blue fallback (199 89% 48%) while the homepage runs on
// the brand palette. A new page inheriting that would ship the client a page in
// a colour that is not theirs. The accent is therefore read back out of the
// homepage's own custom properties; the value is the site's, not a guess, and
// when nothing parses the page falls through to the previous behaviour.
const BRAND_ACCENT_VARS = ["--accent", "--brand", "--primary", "--aqua-bright", "--aqua"];
const BRAND_INK_VARS = ["--accent-ink", "--ink"];

function hexToHslTriple(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function readCssVarHex(css, name) {
  const m = String(css || "").match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{3,8})`, "i"));
  return m ? m[1] : null;
}

/** -> "<style>:root{--accent:...}</style>" or "" when the site publishes no palette. */
function brandAccentOverride(indexHtml) {
  const accentHex = BRAND_ACCENT_VARS.map((v) => readCssVarHex(indexHtml, v)).find(Boolean);
  const accent = accentHex ? hexToHslTriple(accentHex) : null;
  if (!accent) return "";
  const inkHex = BRAND_INK_VARS.map((v) => readCssVarHex(indexHtml, v)).find(Boolean);
  const ink = inkHex ? hexToHslTriple(inkHex) : null;
  return `<style>/* brand palette, read from the site's own custom properties */\n:root{--accent:${accent}${ink ? `;--accent-ink:${ink}` : ""}}\n</style>`;
}

function renderSeoPage({ facts, topic, route, copy, today }) {
  const title = `${topic} in ${facts.city}, ${facts.state} — ${facts.businessName}`;
  const description = typeof copy.description === "function"
    ? copy.description(facts)
    : `What ${topic.toLowerCase()} work involves, and what to have ready before calling about it in ${facts.city}, ${facts.state}.`;
  const url = `${facts.origin}${route}`;
  const telHref = `tel:${String(facts.phone).replace(/[^\d+]/g, "")}`;
  const related = facts.services.filter((s) => s !== topic).slice(0, 6);

  const body = (copy.sections || []).map((s) => {
    const parts = [`<h2>${esc(s.h)}</h2>`];
    for (const p of s.p || []) parts.push(`<p>${esc(p)}</p>`);
    if (s.table) {
      parts.push(
        `<table class="wss-c__table"><caption>${esc(s.table.caption)}</caption>`
        + `<thead><tr>${s.table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>`
        + s.table.rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
        + `</tbody></table>`
      );
    }
    if (s.list) parts.push(`<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`);
    if (s.note) parts.push(`<p>${esc(s.note)}</p>`);
    return parts.join("\n");
  }).join("\n");

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${facts.origin}/` },
          { "@type": "ListItem", position: 2, name: topic, item: url },
        ],
      },
      {
        "@type": "Service",
        name: `${topic} — ${facts.city}, ${facts.state}`,
        serviceType: topic,
        areaServed: { "@type": "City", name: facts.city },
        provider: {
          "@type": "LocalBusiness",
          name: facts.businessName,
          telephone: facts.phone,
          ...(facts.address ? { address: { "@type": "PostalAddress", streetAddress: facts.address } } : {}),
          url: `${facts.origin}/`,
        },
        mainEntityOfPage: url,
        isPartOf: { "@type": "WebSite", url: `${facts.origin}/`, name: facts.businessName },
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${esc(url)}" />
<meta name="twitter:card" content="summary_large_image" />

${extractStyleBlock(facts.__style)}
${brandAccentOverride(facts.__index || "")}
</head>
<body>
<a href="#main" style="position:absolute;left:-9999px;top:auto" onfocus="this.style.left='8px';this.style.top='8px';this.style.background='#fff';this.style.color='#000';this.style.padding='8px';this.style.zIndex=99">Skip to content</a>
<header class="wss-p__bar">
  <a href="/">${esc(facts.businessName)}</a>
  <nav><a href="/">Home</a><a href="/about">About</a><a href="${esc(route)}">${esc(topic)}</a><a href="${esc(telHref)}">${esc(facts.phone)}</a></nav>
</header>
<main id="main">
<p class="wss-p__crumbs"><a href="/" style="color:inherit">Home</a> › ${esc(topic)}</p>
<section class="wss-c"><div class="wss-c__inner">
<p class="wss-c__eyebrow">${esc(topic)}</p><div class="wss-c__rule"></div>
<h1>${esc(topic)} in ${esc(facts.city)}, ${esc(facts.state)}</h1>

<p>${esc(copy.lede(facts))}</p>
${body}

${related.length ? `<h2>Other services ${esc(facts.businessName)} lists</h2>\n<ul class="wss-c__areas">${related.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}

<h2>Contact</h2>
<p>${esc(facts.businessName)}${facts.address ? ` · ${esc(facts.address)}` : ""} · serving ${esc(facts.serves || `${facts.city}, ${facts.state}`)}.</p>
<a class="wss-p__cta" href="${esc(telHref)}">Call ${esc(facts.phone)}</a>
</div></section>
<p class="wss-p__meta">Last updated ${esc(today)}</p>${copy.reference ? `<p class="wss-p__cite">Reference: <a href="${esc(copy.reference.href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(copy.reference.label)}</a></p>` : ""}
</main>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Truth gate — run BEFORE anything is uploaded or deployed
// ---------------------------------------------------------------------------
// Phrases a page may not contain because the archive cannot substantiate them.
// Any one of these is a claim about the client, and the whole point of a
// deterministic builder is that it cannot make one.
const BANNED = [
  [/\blicen[sc]ed\b/i, "licensing claim"],
  [/\binsured\b|\bbonded\b/i, "insurance claim"],
  [/\bcertified\b|\baccredited\b/i, "credential claim"],
  [/\b24\s*\/\s*7\b|\b24 hours\b|\baround the clock\b/i, "availability claim"],
  [/\bsame[- ]day\b|\bnext[- ]day\b|\bemergency service\b/i, "response-time claim"],
  [/\bfree (estimate|quote|inspection)/i, "pricing claim"],
  [/\bguarantee|\bwarrant(y|ied|ies)\b/i, "guarantee claim"],
  [/\baward|\btop[- ]rated\b|\bvoted\b|\bnumber one\b|\B#1\b/i, "ranking claim"],
  [/\byears of experience\b|\bsince (19|20)\d\d\b/i, "tenure claim"],
  [/\bfamily[- ]owned\b|\blocally owned\b|\bveteran[- ]owned\b/i, "ownership claim"],
  [/\bfinancing\b|\bdiscount\b|\bcoupon\b|\bspecial offer\b/i, "offer claim"],
  [/\$\s?\d/, "price figure"],
  // Deliberately CASE-SENSITIVE: the page must never speak as the business
  // ("we replace...", "our technicians..."), but "US Department of Energy" is
  // a citation, not a first-person claim, and an /i flag would refuse it.
  [/\b(We|we|Our|our|us)\b/, "first-person claim (the page speaks for the business)"],
];

/**
 * Refuse to publish a page that asserts anything the archive cannot support.
 * Throws on the first violation; the job then fails loudly instead of the
 * site quietly gaining a sentence nobody can back up.
 */
function assertNoInventedClaims(html, facts) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (const [re, label] of BANNED) {
    const m = text.match(re);
    if (m) throw new Error(`seo-page refused: ${label} — found "${m[0].trim()}"`);
  }
  // Any phone-shaped run on the page must be the business's own number.
  const wantDigits = String(facts.phone).replace(/\D/g, "").slice(-10);
  // The boundaries are load-bearing. Without them this matched the FIRST TEN
  // DIGITS of a 15-16 digit Meta pixel ID, decided they were a phone number
  // that is not the client's, and refused the page — so every customer running
  // a Meta pixel would have been told their privacy page could not be built.
  // A phone number is not a prefix of a longer digit run.
  for (const m of text.matchAll(/(?<!\d)\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g)) {
    const got = m[0].replace(/\D/g, "").slice(-10);
    if (got !== wantDigits) throw new Error(`seo-page refused: page carries a phone number that is not the business's (${m[0]})`);
  }
  for (const need of [facts.businessName, facts.city, facts.phone]) {
    if (need && !text.includes(need)) throw new Error(`seo-page refused: page omits a required fact (${need})`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Surgical inserts — nav + sitemap, never a full-file regeneration
// ---------------------------------------------------------------------------
/**
 * Add the page to the homepage's primary nav, immediately before the call
 * button so the CTA stays last. Idempotent: an existing link for the route is
 * left alone.
 */
function insertNavLink(indexHtml, { route, label }) {
  const html = String(indexHtml);
  // `present` (the link is there) is the contract the caller enforces;
  // `changed` only says whether THIS run wrote it. A caller who phones back and
  // asks for the same page again must get the page refreshed, not an error.
  if (new RegExp(`href="${route}"`).test(html)) return { html, changed: false, present: true, reason: "already linked" };
  const navMatch = html.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return { html, changed: false, present: false, reason: "no primary nav found" };
  const nav = navMatch[0];
  const link = `<a href="${route}">${label}</a>`;
  const buttonIdx = nav.search(/<a[^>]*class="[^"]*\bbutton\b/i);
  const updatedNav = buttonIdx >= 0
    ? `${nav.slice(0, buttonIdx)}${link}\n        ${nav.slice(buttonIdx)}`
    : nav.replace(/<\/nav>/i, `${link}</nav>`);
  return { html: html.replace(nav, updatedNav), changed: true, present: true, reason: "inserted before CTA" };
}

/** Add a <url> entry to sitemap.xml. Idempotent on <loc>. */
function insertSitemapEntry(sitemapXml, { loc, priority = "0.8", changefreq = "monthly" }) {
  const xml = String(sitemapXml);
  if (xml.includes(`<loc>${loc}</loc>`)) return { xml, changed: false, present: true, reason: "already listed" };
  if (!/<\/urlset>/i.test(xml)) return { xml, changed: false, present: false, reason: "no <urlset> to extend" };
  const entry = `  <url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>\n`;
  return { xml: xml.replace(/<\/urlset>/i, `${entry}</urlset>`), changed: true, present: true, reason: "appended" };
}

/** Link the new page from the other static sub-pages' simple nav bar. */
function insertSubPageNavLink(pageHtml, { route, label }) {
  const html = String(pageHtml);
  if (new RegExp(`href="${route}"`).test(html)) return { html, changed: false };
  const m = html.match(/<nav>([\s\S]*?)<\/nav>/i);
  if (!m) return { html, changed: false };
  const telIdx = m[0].search(/<a href="tel:/i);
  const link = `<a href="${route}">${label}</a>`;
  const updated = telIdx >= 0
    ? `${m[0].slice(0, telIdx)}${link}${m[0].slice(telIdx)}`
    : m[0].replace(/<\/nav>/i, `${link}</nav>`);
  return { html: html.replace(m[0], updated), changed: true };
}

// ---------------------------------------------------------------------------
// Live verification — a deploy that returns a URL is not a page that renders
// ---------------------------------------------------------------------------
async function verifyLive({ origin, route, expectH1, expectLoc, attempts = 10, waitMs = 3000, fetchImpl = fetch, sleep }) {
  const rest = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const pageRes = await fetchImpl(`${origin}${route}`);
      const pageHtml = pageRes.ok ? await pageRes.text() : "";
      const mapRes = await fetchImpl(`${origin}/sitemap.xml`);
      const mapXml = mapRes.ok ? await mapRes.text() : "";
      last = {
        route,
        status: pageRes.status,
        hasH1: pageHtml.includes(expectH1),
        inSitemap: mapXml.includes(`<loc>${expectLoc}</loc>`),
      };
      if (last.status === 200 && last.hasH1 && last.inSitemap) return { ok: true, ...last, attempts: i + 1 };
    } catch (error) {
      last = { route, error: String(error.message || error) };
    }
    if (i < attempts - 1) await rest(waitMs);
  }
  return { ok: false, ...(last || {}), attempts };
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------
/**
 * Execute a "seo-page" edit end to end.
 * Returns the same shape runSiteEdit does ({ deployUrl, alias, changedFiles })
 * plus the evidence this kind is judged on: route, and a live verification
 * result read back off the deployed host.
 */
async function runSeoPageEdit({ siteSlug, instruction, projectName, aliasHost, now = new Date() }) {
  const rels = await listAll(siteSlug);
  if (!rels.length) throw new Error(`no archived source for site '${siteSlug}'`);

  const files = {};
  for (const rel of rels) files[rel] = await download(siteSlug, rel);

  const text = (rel) => (files[rel] ? files[rel].toString("utf8") : "");
  const facts = parseSiteFacts({ llms: text("llms.txt"), index: text("index.html") });
  assertFactsComplete(facts);

  const topic = chooseTopic(instruction, facts.services);
  if (!topic) {
    throw new Error(
      `seo-page refused: "${String(instruction).slice(0, 80)}" does not name a service this business lists `
      + `(${facts.services.slice(0, 8).join(", ")}). Refusing to publish a page for work it may not do.`
    );
  }

  const route = `/${slugify(topic)}-${slugify(facts.city)}-${slugify(facts.state)}`;
  const pageRel = `${route.slice(1)}.html`;
  const copy = TOPIC_COPY[topic.toLowerCase()] || genericCopy(topic);

  facts.__style = text("about.html") || text("index.html");
  facts.__index = text("index.html");
  const today = now.toISOString().slice(0, 10);
  const pageHtml = renderSeoPage({ facts, topic, route, copy, today });
  delete facts.__style;
  delete facts.__index;
  assertNoInventedClaims(pageHtml, facts);

  const changedFiles = [];
  files[pageRel] = Buffer.from(pageHtml, "utf8");
  changedFiles.push(pageRel);

  const navLabel = topic.length > 18 ? topic.split(/\s+/)[0] : topic;
  const nav = insertNavLink(text("index.html"), { route, label: navLabel });
  if (nav.changed) {
    files["index.html"] = Buffer.from(nav.html, "utf8");
    changedFiles.push("index.html");
  }

  const loc = `${facts.origin}${route}`;
  const map = insertSitemapEntry(text("sitemap.xml"), { loc });
  if (map.changed) {
    files["sitemap.xml"] = Buffer.from(map.xml, "utf8");
    changedFiles.push("sitemap.xml");
  }

  if (files["about.html"]) {
    const about = insertSubPageNavLink(text("about.html"), { route, label: navLabel });
    if (about.changed) {
      files["about.html"] = Buffer.from(about.html, "utf8");
      changedFiles.push("about.html");
    }
  }

  // A page that is not reachable from the nav and not in the sitemap is not an
  // SEO page, it is an orphan. Fail before deploying rather than report success.
  // The gate is on PRESENCE, not on having written it this run — a repeat
  // request refreshes the page instead of erroring out on its own past work.
  if (!nav.present) throw new Error(`seo-page refused: could not add the page to the nav (${nav.reason})`);
  if (!map.present) throw new Error(`seo-page refused: could not add the page to sitemap.xml (${map.reason})`);

  for (const rel of changedFiles) {
    await upload(siteSlug, rel, files[rel], rel.endsWith(".html") ? "text/html" : rel.endsWith(".xml") ? "application/xml" : undefined);
  }

  const deployed = await vercelDeploy({ files, projectName, aliasHost });
  const origin = deployed.alias || deployed.deployUrl || deployed.url;
  const verified = await verifyLive({
    origin: String(origin).replace(/\/+$/, ""),
    route,
    expectH1: `${topic} in ${facts.city}, ${facts.state}`,
    expectLoc: loc,
  });
  if (!verified.ok) {
    throw new Error(`seo-page deployed but did not verify live: ${JSON.stringify(verified)}`);
  }

  return {
    kind: "seo-page",
    topic,
    route,
    deployUrl: deployed.url,
    alias: deployed.alias,
    changedFiles,
    verified,
  };
}

module.exports = {
  classifyEditKind,
  runSeoPageEdit,
  // exported for tests
  parseSiteFacts,
  chooseTopic,
  slugify,
  renderSeoPage,
  assertNoInventedClaims,
  insertNavLink,
  insertSitemapEntry,
  insertSubPageNavLink,
  verifyLive,
  TOPIC_COPY,
  // Exported for lib/seo-grid.js, which composes many pages per run from the
  // same facts, copy table, render and gates — the grid is this file's
  // contract scaled up, not a second implementation of it.
  assertFactsComplete,
  genericCopy,
  // Grid-kind classification, so edit-job-runner can label a grid job
  // "seo-grid" on the job row and runSiteChange can route it to the grid lane.
  isSeoGridRequest,
  classifySeoGridRequest,
  // Also consumed by lib/site-change-plan.js restyle_site: a whole-site
  // recolour writes each palette token back in the FORMAT the site declared
  // it in, and hex -> HSL triple is exactly this conversion.
  hexToHslTriple,
};
