"use strict";

// scripts/ship-four.js — rebuild the four remaining sample mirrors on the
// fixed routing, in-process and sequentially (cheap, no agent fan-out), then
// verify each live and write a manifest the pitch email reads from.
//
// Ramon is already live and proven, so it is verified rather than rebuilt.

const fs = require("node:fs");
const path = require("node:path");

const ENV = "C:/Users/Main/Documents/New project 2/.fable-proof.env";
const SCRATCH = "C:/Users/Main/AppData/Local/Temp/claude/C--Users-Main-Documents-Dark-Signal/b28e9c2e-4ceb-4a46-b34a-e43b43b1fc9b/scratchpad";
const OUT = path.join(SCRATCH, "ship");

for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
process.env.MIRROR_REQUIRE_BRAND = "1";

const { mirror } = require("../lib/mirror-engine/engine");
const { measureRuntime } = require("../lib/mirror-engine/measure-runtime");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// Requests. Lyons + Kingdom reuse saved payloads verbatim (only the donor and
// trust posture change); Music City and ENCO are rebuilt from their verified
// facts. Nothing here is invented — every claim traces to the prospect's own
// site or an attested Google panel.
// ---------------------------------------------------------------------------
function lyons() {
  const r = readJson(path.join(SCRATCH, "ship", "request.json"));
  return r; // already correct: Tucson facts, 12 services, 18 areas, 8 FAQs, research
}

function kingdom() {
  const r = readJson(path.join(SCRATCH, "kp-run", "kp-request.json"));
  r.donor = "plumbing-premier"; // the owner rejected the dark-editorial donor
  // TRUTH LAW: no Google panel resolved for Kingdom, so no rating ships.
  delete r.facts.rating;
  delete r.facts.review_count;
  return r;
}

function musicCity() {
  return {
    slug: "wss-test-music-city-roofers-nashville",
    donor: "roofing-falcon-clean",
    facts: {
      business_name: "Music City Roofers",
      industry: "roofing",
      city: "Nashville",
      state: "TN",
      phone: "(615) 802-4999",
      address: "2617 Grissom Dr",
      postal_code: "37204",
      rating: 4.7,
      review_count: 874,
    },
    brand: { logo: "https://www.musiccityroofers.com/img/logo.png" },
    hero: { headline: "Your Last Roof. Ever." },
    content: {
      services: [
        { name: "Roof Replacement", description: "Full residential roof replacement for Nashville-area homes." },
        { name: "Roof Repair", description: "Targeted repairs for leaks, flashing and damaged shingles." },
        { name: "Storm Damage Restoration", description: "Response and restoration after wind and hail events." },
        { name: "Emergency Roof Repair", description: "Urgent repair work when a roof is actively leaking." },
        { name: "Hail Damage", description: "Assessment and repair of hail-impacted roof surfaces." },
        { name: "Wind Damage", description: "Repair of wind-lifted and missing shingles." },
        { name: "Residential Roofing", description: "Roof systems for single-family homes." },
        { name: "Commercial Roofing", description: "Roof systems for commercial buildings." },
        { name: "GAF Roofing Systems", description: "Installation of GAF roofing products." },
        { name: "Roof Inspections", description: "Documented inspection of the roof and its details." },
      ],
      areas: [
        "Nashville", "Brentwood", "Franklin", "Murfreesboro", "Hendersonville", "Mount Juliet",
        "Smyrna", "Gallatin", "Spring Hill", "La Vergne", "Antioch", "Madison",
        "Goodlettsville", "Nolensville", "Lebanon", "Clarksville", "Columbia", "Dickson",
      ],
      about: "Music City Roofers has worked on Nashville-area roofs since 2012, installing GAF roofing systems for homeowners across Middle Tennessee.\n\nThe company supports local organizations including Habitat for Humanity, Nashville Rescue Mission and Provision International.",
      founded_year: 2012,
      faqs: [
        { q: "Why do new shingles sometimes look uneven at first?", a: "Shingles expand and settle after installation, so small irregularities in the first weeks are normal and typically resolve as the roof adjusts to temperature cycles." },
        { q: "What time can crews start work?", a: "Start times follow local city ordinances, which generally means a 7am start in Nashville and 8am in some surrounding municipalities." },
        { q: "How long does a roof replacement take?", a: "Most residential replacements are completed in one day, with larger or more complex roofs running into a second day." },
        { q: "What areas do you serve?", a: "Middle Tennessee, centered on Nashville and the surrounding cities listed on the service-area page." },
        { q: "Should I be present for the inspection?", a: "Being present is helpful because it allows the findings to be walked through with you directly while the crew is still on site." },
        { q: "When should I file an insurance claim?", a: "File once damage has been identified and documented, since claims are evaluated on the evidence of what actually happened to the roof." },
        { q: "How long does claim processing usually take?", a: "Insurance processing commonly runs five to ten business days, though the timeline is set by the carrier rather than the roofer." },
        { q: "Can a new roof go over multiple existing layers?", a: "Additional layers add significant weight to the structure, so removing existing layers is generally the sounder approach for the framing." },
      ],
      research: {
        neighborhoods: ["East Nashville", "Green Hills", "Germantown", "Sylvan Park", "Belle Meade", "Donelson"],
        landmarks: ["Centennial Park"],
        gbp: {
          descriptions: {
            short_250: "Music City Roofers provides roofing services in Nashville, TN. Work includes roof replacement, roof repair and storm damage restoration. Call (615) 802-4999.",
            medium_500: "Music City Roofers is a roofing company serving Nashville, TN and the surrounding Middle Tennessee area. Services include roof replacement, roof repair, storm damage restoration, hail and wind damage, and roof inspections. To ask a question or arrange a visit, call (615) 802-4999.",
            long_750: "Music City Roofers provides roofing services throughout Nashville, TN and nearby communities. The team handles roof replacement, roof repair, storm damage restoration, hail damage, wind damage and roof inspections. Every job starts with a look at what is actually there, so the scope is clear before work begins. To reach Music City Roofers, call (615) 802-4999.",
          },
          categories: ["Roofing contractor", "Roofing supply store", "Construction company"],
        },
        citations_csv: 'directory,business_name,phone,city,state\n"Google Business Profile","Music City Roofers","(615) 802-4999","Nashville","TN"\n"Bing Places","Music City Roofers","(615) 802-4999","Nashville","TN"\n',
      },
    },
  };
}

function enco() {
  return {
    slug: "wss-test-enco-plumbing-the-colony",
    donor: "plumbing-premier",
    facts: {
      business_name: "ENCO Plumbing, Inc.",
      industry: "plumbing",
      city: "The Colony",
      state: "TX",
      phone: "(214) 222-4464",
      email: "rneal@encoplumbing.com",
      license: "RMP#35843",
      rating: 4.9,
      review_count: 403,
    },
    brand: {
      logo: "https://encoplumbing.com/wp-content/uploads/2025/09/cropped-o-1.png",
      accent: "#003eac",
      accent_source: "https://encoplumbing.com/wp-content/uploads/2025/09/cropped-o-1.png",
    },
    hero: {
      headline: "Full-service plumbing in The Colony.",
      badge: "24/7 Emergency Service",
      accent: "Family owned and operated since 1994",
    },
    content: {
      services: [
        { name: "Drain Cleaning", description: "Clearing slow and blocked drain lines." },
        { name: "Sewer Line Service", description: "Inspection and repair of sewer lines, including camera service." },
        { name: "Water Heater Repair", description: "Repair of tank and tankless water heaters." },
        { name: "Water Heater Installation", description: "Replacement and installation of water heaters." },
        { name: "Leak Detection", description: "Locating leaks in supply and drain lines." },
        { name: "Slab Leak Repair", description: "Repair of leaks beneath concrete slabs." },
        { name: "Faucet and Fixture Repair", description: "Repair and replacement of faucets and fixtures." },
        { name: "Toilet Repair", description: "Repair and replacement of toilets." },
        { name: "Garbage Disposal Service", description: "Repair and replacement of disposals." },
        { name: "Gas Line Service", description: "Gas line work for residential and commercial properties." },
        { name: "Repiping", description: "Replacement of aging supply piping." },
        { name: "Commercial Plumbing", description: "Plumbing service for commercial properties." },
      ],
      areas: [
        "The Colony", "Frisco", "Plano", "Lewisville", "Carrollton", "Little Elm",
        "Flower Mound", "Highland Village", "Coppell", "Denton", "McKinney", "Allen",
        "Prosper", "Celina", "Corinth", "Argyle", "Grapevine", "Dallas",
      ],
      hours: ["Available 24/7"],
      about: "ENCO Plumbing was founded in November 1994 as Eric Neal Co, run out of Eric Neal's home with a single van.\n\nEric Neal is the founder and owner. His son Richard Neal has been part of the team for more than fifteen years.\n\nThe company serves both residential and commercial customers across the Dallas-Fort Worth area.",
      founded_year: 1994,
      mission: "Take care of the customer, do the work properly, and stand behind it.",
      team: [
        { name: "Eric Neal", role: "Founder and Owner" },
        { name: "Richard Neal", role: "" },
      ],
      faqs: [
        { q: "Do you handle emergency plumbing calls?", a: "Yes. The company states that its services are available 24/7, so emergency calls are part of the normal workload." },
        { q: "Are you licensed?", a: "Yes. ENCO Plumbing holds Texas license RMP#35843, which is displayed on the company's own site." },
        { q: "Do you work on commercial properties?", a: "Yes. The company serves both residential and commercial customers, including plumbing work for commercial buildings." },
        { q: "What areas do you cover?", a: "The Colony and the surrounding Dallas-Fort Worth communities listed on the service-area page, including Frisco, Plano, Lewisville and Carrollton." },
        { q: "How long has the company been in business?", a: "ENCO Plumbing was founded in November 1994, originally as Eric Neal Co." },
        { q: "Can you camera-inspect a sewer line?", a: "Yes. Camera service is part of the sewer line work the company offers, which is how a blockage or break gets located before digging." },
        { q: "Do you replace water heaters as well as repair them?", a: "Yes. Both repair and full replacement of tank and tankless water heaters are offered." },
        { q: "How do I reach you?", a: "Call (214) 222-4464 or email rneal@encoplumbing.com, both of which are published on the company's own site." },
      ],
      research: {
        neighborhoods: [],
        landmarks: [],
        gbp: {
          descriptions: {
            short_250: "ENCO Plumbing, Inc. provides plumbing services in The Colony, TX. Work includes drain cleaning, sewer line service and water heater installation. RMP#35843. Call (214) 222-4464.",
            medium_500: "ENCO Plumbing, Inc. is a plumbing company serving The Colony, TX and the surrounding Dallas-Fort Worth area. Services include drain cleaning, sewer line service, water heater repair and installation, leak detection and commercial plumbing. RMP#35843. To ask a question or arrange a visit, call (214) 222-4464.",
            long_750: "ENCO Plumbing, Inc. provides plumbing services throughout The Colony, TX and nearby communities. The team handles drain cleaning, sewer line service, water heater repair and installation, leak detection, slab leak repair and commercial plumbing. RMP#35843. Every job starts with a look at what is actually there, so the scope is clear before work begins. To reach ENCO Plumbing, call (214) 222-4464.",
          },
          categories: ["Plumber", "Drainage service", "Water heater installation"],
        },
        citations_csv: 'directory,business_name,phone,city,state\n"Google Business Profile","ENCO Plumbing, Inc.","(214) 222-4464","The Colony","TX"\n"Bing Places","ENCO Plumbing, Inc.","(214) 222-4464","The Colony","TX"\n',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Live verification
// ---------------------------------------------------------------------------
async function verifyLive(slug, spaRoutes = []) {
  const base = `https://${slug}.wss-ai.com`;
  const out = { authority: {}, nav: {}, notfound: null, sitemap: [], map: null };
  const home = await fetch(`${base}/`, { headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(25000) });
  const homeText = await home.text();
  out.home_status = home.status;

  for (const p of ["about", "service-areas", "faq", "team"]) {
    try {
      const r = await fetch(`${base}/${p}`, { headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      out.authority[p] = { status: r.status, distinct: r.ok && t.length !== homeText.length, bytes: t.length, title: (t.match(/<title>([^<]*)/) || [])[1] || "" };
    } catch (e) { out.authority[p] = { error: String(e.message).slice(0, 60) }; }
  }
  for (const route of spaRoutes.slice(0, 3)) {
    try {
      const r = await fetch(`${base}${route}`, { headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      out.nav[route] = { status: r.status, servesShell: t.length === homeText.length };
    } catch (e) { out.nav[route] = { error: String(e.message).slice(0, 60) }; }
  }
  try {
    const r = await fetch(`${base}/nope-xyz-404`, { signal: AbortSignal.timeout(20000) });
    out.notfound = r.status;
  } catch { out.notfound = null; }
  try {
    const sm = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
    out.sitemap = [...sm.matchAll(/<loc>([^<]*)/g)].map((m) => m[1].replace(base, "") || "/");
  } catch { /* leave empty */ }
  const mapMatch = homeText.match(/src="(https:\/\/www\.google\.com\/maps[^"]*)"/) || homeText.match(/data-src="(https:\/\/www\.google\.com\/maps[^"]*)"/);
  out.map = mapMatch ? (mapMatch[1].includes("/embed/v1/") ? "keyed_embed_api" : "unkeyed") : "not_found_in_html";
  return out;
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [
    ["lyons", lyons()],
    ["musiccity", musicCity()],
    ["kingdom", kingdom()],
    ["enco", enco()],
  ];
  const results = [];
  for (const [label, request] of jobs) {
    process.stdout.write(`\n=== ${label} (${request.slug}) donor=${request.donor} ===\n`);
    let body = null;
    try {
      const r = await mirror(request, {});
      body = r.body;
      if (!r.ok) {
        console.log(`  BUILD FAILED: ${body.error} ${JSON.stringify(body.detail || "").slice(0, 300)}`);
        results.push({ label, slug: request.slug, ok: false, error: body.error, detail: body.detail });
        continue;
      }
    } catch (e) {
      console.log(`  THREW: ${e.message}`);
      results.push({ label, slug: request.slug, ok: false, error: String(e.message).slice(0, 200) });
      continue;
    }
    const c = body.checks;
    console.log(`  revealable=${body.revealable} | ${c.optimization_108.headline}`);
    console.log(`  brand: ${c.brand.accent_origin} | photos placed ${c.brand.photos.placed}/${c.brand.photos.slots_in_donor} transcoded ${c.brand.photos.transcoded || 0}`);
    console.log(`  content: ${(c.content.authority_pages || []).join(" ")} | sitemap ${c.content.sitemap_urls} | editable ${c.editable.status} ${c.editable.archived}/${c.editable.total}`);

    const manifestPath = path.join(OUT, `${request.slug}.manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2));

    // Donor routes for the nav probe
    let spaRoutes = [];
    try {
      spaRoutes = readJson(path.join(process.env.MIRROR_DONOR_ROOT, request.donor, "BOILERPLATE.json")).spa_routes || [];
    } catch { /* optional */ }

    const live = await verifyLive(request.slug, spaRoutes);
    console.log(`  live: authority ${Object.entries(live.authority).filter(([, v]) => v.distinct).map(([k]) => k).join(",") || "none"} | 404=${live.notfound} | sitemap ${live.sitemap.length} | map ${live.map}`);

    let runtime = null;
    try {
      runtime = await measureRuntime(`https://${request.slug}.wss-ai.com/`);
      const v = runtime.vitals || {};
      console.log(`  runtime: LCP ${v.lcp_ms}ms CLS ${v.cls} TTFB ${v.ttfb_ms}ms ${v.protocol} ${runtime.transport && runtime.transport.compression} | contrast fails ${v.contrast && v.contrast.failCount}`);
    } catch (e) { console.log(`  runtime probe failed: ${e.message.slice(0, 80)}`); }

    results.push({
      label, slug: request.slug, ok: true, revealable: body.revealable,
      url: body.preview_url, score: c.optimization_108.headline,
      byGroup: c.optimization_108.byGroup,
      accent: (body.checks.brand || {}).accent, accent_origin: c.brand.accent_origin,
      photos: `${c.brand.photos.placed}/${c.brand.photos.slots_in_donor}`,
      transcoded: c.brand.photos.transcoded || 0,
      authority_pages: c.content.authority_pages, sitemap_urls: c.content.sitemap_urls,
      editable: `${c.editable.status} ${c.editable.archived}/${c.editable.total}`,
      facts: { phone: request.facts.phone, rating: request.facts.rating || null, review_count: request.facts.review_count || null, license: request.facts.license || null },
      donor: request.donor,
      live, runtime: runtime ? { lcp_ms: runtime.vitals.lcp_ms, cls: runtime.vitals.cls, ttfb_ms: runtime.vitals.ttfb_ms, protocol: runtime.vitals.protocol, compression: runtime.transport.compression, contrast_fails: runtime.vitals.contrast && runtime.vitals.contrast.failCount, focusables: runtime.vitals.keyboard && runtime.vitals.keyboard.focusable_count } : null,
    });
  }
  fs.writeFileSync(path.join(OUT, "ship-results.json"), JSON.stringify(results, null, 2));
  console.log(`\n=== ${results.filter((r) => r.revealable).length}/${results.length} revealable — results at ${path.join(OUT, "ship-results.json")}`);
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
