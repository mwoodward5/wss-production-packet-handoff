"use strict";
// Harvest OUR OWN prospect homepages and record, for every image on the page,
// the signals a logo ranker could use. Ground truth from exactly the population
// we target, rather than general web convention.
require("./env");
const fs = require("node:fs");
const BE = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend";
const { select } = require(BE + "/lib/store");

const LIMIT = Number(process.argv[2] || 40);
const CONC = 6;

// String.raw so backslashes survive; the previous version built this in a
// template literal where \b silently became a BACKSPACE character and the
// regex matched nothing on 40 sites while reporting success.
function attr(tag, name) {
  const re = new RegExp(String.raw`\b` + name + String.raw`\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`, "i");
  const m = re.exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "") : "";
}

const STOP = /\b(llc|inc|co|corp|ltd|the|and|of|plumbing|heating|cooling|hvac|air|services?|service|company|sons?|brothers)\b/g;

function extract(html, businessName) {
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const words = String(businessName || "").toLowerCase().replace(STOP, " ")
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2);

  const images = [];
  let cursor = 0;
  for (const tag of imgs) {
    const at = html.indexOf(tag, cursor);
    cursor = at + tag.length;
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src");
    if (!src) continue;
    const alt = attr(tag, "alt");
    const cls = attr(tag, "class");
    const before = html.slice(Math.max(0, at - 700), at);
    const altLc = alt.toLowerCase();
    const fileLc = src.toLowerCase();
    // "inside <header>" = a <header> opened more recently than it closed.
    const lastOpen = before.toLowerCase().lastIndexOf("<header");
    const lastClose = before.toLowerCase().lastIndexOf("</header");
    images.push({
      src, alt, cls,
      customLogo: /\bcustom-logo\b/i.test(cls),
      inHeader: lastOpen > lastClose,
      inHomeLink: /<a\b[^>]*href\s*=\s*["']?(?:\/|https?:\/\/[^"'>]*\/?)["']?[^>]*>\s*$/i.test(before.slice(-300)),
      inCarousel: /(swiper|slick|owl-carousel|splide|glide__)/i.test(before.slice(-500) + " " + cls),
      inBadgeCtx: /(badge|award|accreditation|certification|partner|affiliation|sponsor|trust)/i.test(before.slice(-500) + " " + cls),
      altMatchesName: words.length ? words.some((w) => altLc.includes(w)) : null,
      fileMatchesName: words.length ? words.some((w) => fileLc.includes(w)) : null,
      isSvg: /\.svg(\?|#|$)/i.test(src),
      namedLogo: /logo/i.test(src) || /logo/i.test(cls),
    });
  }
  const schema = /"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"url"\s*:\s*"([^"]+)")/i.exec(html);
  return {
    images,
    schemaLogo: schema ? (schema[1] || schema[2] || "") : "",
    inlineSvgInHeader: /<header[\s\S]{0,4000}?<svg\b/i.test(html),
    cssBgLogo: /background(?:-image)?\s*:\s*url\((["']?)[^"')]*logo[^"')]*\1\)/i.test(html),
  };
}

(async () => {
  const r = await select("ghost_agency_prospects", "?select=prospect_id,record&order=updated_at.desc&limit=600");
  const seen = new Set();
  const targets = (r.data || []).map((x) => x.record || {})
    .filter((rec) => rec.business_name && /^https?:\/\//i.test(rec.current_website || rec.website || ""))
    .filter((rec) => {
      try {
        const h = new URL(rec.current_website || rec.website).hostname.replace(/^www\./, "");
        if (seen.has(h)) return false; seen.add(h); return true;
      } catch { return false; }
    })
    .slice(0, LIMIT);

  console.log(`fetching ${targets.length} prospect homepages...`);
  const corpus = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (;;) {
      const rec = targets[i++];
      if (!rec) return;
      const site = rec.current_website || rec.website;
      try {
        const res = await fetch(site, {
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; WSSLabs-corpus/1.0)" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) { corpus.push({ site, business: rec.business_name, error: `http_${res.status}` }); continue; }
        corpus.push({ site, business: rec.business_name, ...extract(await res.text(), rec.business_name) });
      } catch (e) { corpus.push({ site, business: rec.business_name, error: String(e.message).slice(0, 60) }); }
    }
  }));

  fs.writeFileSync("logo-corpus.json", JSON.stringify(corpus, null, 1));
  const ok = corpus.filter((c) => c.images);
  const totalImgs = ok.reduce((n, c) => n + c.images.length, 0);
  console.log(`\nfetched ${ok.length}/${targets.length} (${corpus.length - ok.length} failed) | images examined: ${totalImgs}`);
  if (!ok.length) return;

  const pct = (n) => `${((n / ok.length) * 100).toFixed(0)}%`;
  const siteHas = (fn) => ok.filter((c) => c.images.some(fn)).length;
  const row = (label, n) => console.log(`  ${label.padEnd(38)} ${String(n).padStart(3)}  ${pct(n)}`);

  console.log(`\nPOSITIVE SIGNAL AVAILABILITY (${ok.length} real prospect sites)`);
  row('class="custom-logo"', siteHas((x) => x.customLogo));
  row("alt matches the business name", siteHas((x) => x.altMatchesName));
  row("filename matches the business name", siteHas((x) => x.fileMatchesName));
  row("an <img> inside <header>", siteHas((x) => x.inHeader));
  row("an <img> wrapped in a home link", siteHas((x) => x.inHomeLink));
  row("schema.org logo declared", ok.filter((c) => c.schemaLogo).length);
  row("inline <svg> in the header", ok.filter((c) => c.inlineSvgInHeader).length);
  row("logo painted as a CSS background", ok.filter((c) => c.cssBgLogo).length);

  console.log(`\nNEGATIVE CONTEXT PRESENT`);
  row("images in a carousel/slider", siteHas((x) => x.inCarousel));
  row("images in a badge/partner wrapper", siteHas((x) => x.inBadgeCtx));

  console.log(`\nDISCRIMINATION — of images merely NAMED "logo", how many are the client's?`);
  const named = ok.flatMap((c) => c.images.filter((x) => x.namedLogo));
  const namedTheirs = named.filter((x) => x.altMatchesName || x.fileMatchesName || x.customLogo);
  console.log(`  images named "logo": ${named.length} | of those, evidenced as the client's: ${namedTheirs.length} (${((namedTheirs.length / (named.length || 1)) * 100).toFixed(0)}%)`);
  console.log(`  => ${named.length - namedTheirs.length} images say "logo" and are NOT evidenced as theirs.`);

  const none = ok.filter((c) => !c.images.some((x) => x.customLogo || x.altMatchesName || x.fileMatchesName) && !c.schemaLogo);
  console.log(`\nsites with NO positive declaration at all: ${none.length}  ${pct(none.length)}`);
  none.slice(0, 10).forEach((c) => console.log(`   ${c.business} - ${c.site}`));
})().catch((e) => { console.error(e); process.exit(1); });
