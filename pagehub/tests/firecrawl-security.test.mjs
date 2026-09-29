import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const firecrawlHandler = require(join(repoRoot, "api", "firecrawl-intake.js"));
const AUTH_TOKEN = "firecrawl-security-auth-token";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    end(body = "") { resolve({ status: this.statusCode, body, headers }); return this; }
  };
  return { response, complete };
}

async function invoke(body) {
  const { response, complete } = captureResponse();
  await firecrawlHandler({
    method: "POST",
    headers: {
      origin: "https://pagehub-intake-lock-form.vercel.app",
      authorization: `Bearer ${AUTH_TOKEN}`
    },
    body
  }, response);
  return complete;
}

async function withFirecrawlFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.FIRECRAWL_API_KEY = "security-test-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
}

function fixtureFirecrawlFetch({ sourceUrl, json = {}, markdown = "", rawHtml = "", title = "Fixture Business" }) {
  const source = new URL(sourceUrl);
  return async input => {
    const url = String(input);
    if (url.startsWith(`${source.origin}/sitemap`) || url === `${source.origin}/wp-sitemap.xml`) {
      return new Response("not found", { status: 404 });
    }
    if (url === "https://api.firecrawl.dev/v2/map") {
      return jsonResponse({ success: true, links: [] });
    }
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      return jsonResponse({
        success: true,
        data: {
          json,
          markdown,
          rawHtml,
          metadata: { title },
          links: [],
          images: [],
          branding: {}
        }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function serviceLines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

test("Firecrawl intake rejects local, private, link-local, and IPv4-mapped IPv6 sources before fetch", async () => {
  const forbiddenSources = [
    "http://localhost:8765/",
    "http://127.0.0.1/",
    "http://10.0.0.4/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/"
  ];

  for (const source of forbiddenSources) {
    const calls = [];
    const result = await withFirecrawlFetch(async input => {
      calls.push(String(input));
      throw new Error(`Forbidden source reached fetch: ${input}`);
    }, () => invoke({ urls: [source] }));

    assert.equal(result.status, 400, source);
    assert.equal(result.body.ok, false, source);
    assert.equal(calls.length, 0, `${source} must be rejected before any network request`);
  }
});

test("sitemap discovery never follows a redirect into a private target", async () => {
  const calls = [];
  const privateTarget = "http://169.254.169.254/latest/meta-data/";

  const result = await withFirecrawlFetch(async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, redirect: options.redirect || "follow" });

    if (/^https:\/\/fixture\.example\/(?:sitemap\.xml|sitemap_index\.xml|wp-sitemap\.xml)$/.test(url)) {
      // Native fetch would already contact the redirect target when `follow`
      // is used. Record that simulated hop so this test catches unsafe mode.
      if ((options.redirect || "follow") === "follow") {
        calls.push({ url: privateTarget, redirect: "followed-by-fetch" });
        return new Response("metadata secret", { status: 200 });
      }
      return new Response("", {
        status: 302,
        headers: { location: privateTarget }
      });
    }
    if (url === privateTarget) {
      throw new Error("Private redirect target was fetched");
    }
    if (url === "https://api.firecrawl.dev/v2/map") {
      return jsonResponse({ success: true, links: [] });
    }
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      return jsonResponse({
        success: true,
        data: {
          json: {},
          markdown: "Fixture business",
          rawHtml: "",
          metadata: { title: "Fixture Business" },
          links: [],
          images: [],
          branding: {}
        }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }, () => invoke({ urls: ["https://fixture.example/"] }));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(calls.some(call => /fixture\.example\/sitemap/.test(call.url)), "sitemap discovery should run");
  assert.ok(!calls.some(call => call.url === privateTarget), "private redirect target must never be requested");
  assert.ok(
    calls.filter(call => /fixture\.example\/sitemap/.test(call.url)).every(call => call.redirect !== "follow"),
    "sitemap requests must not delegate redirect validation to fetch"
  );
});

test("brand extraction uses Firecrawl branding and inline CSS without fetching linked stylesheets", async () => {
  const calls = [];
  const stylesheetUrl = "https://cdn.fixture.example/assets/brand.css";
  const html = `<!doctype html>
    <html><head>
      <link rel="stylesheet" href="${stylesheetUrl}">
      <style>:root{--brand-primary:#123456}.cta{background-color:#E7A62B}</style>
    </head><body><header>Fixture Business</header></body></html>`;

  const result = await withFirecrawlFetch(async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, redirect: options.redirect || "follow" });
    if (/^https:\/\/fixture\.example\/(?:sitemap\.xml|sitemap_index\.xml|wp-sitemap\.xml)$/.test(url)) {
      return new Response("not found", { status: 404 });
    }
    if (url === "https://api.firecrawl.dev/v2/map") {
      return jsonResponse({ success: true, links: [] });
    }
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      return jsonResponse({
        success: true,
        data: {
          json: { brandColors: "", brandPalette: [] },
          markdown: "Fixture business",
          rawHtml: html,
          metadata: { title: "Fixture Business" },
          links: [],
          images: [],
          branding: { colors: { primary: "#0A4A7A", accent: "#F4A024" } }
        }
      });
    }
    if (url === stylesheetUrl) {
      throw new Error("Linked stylesheet must not be fetched by intake extraction");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }, () => invoke({
    urls: ["https://fixture.example/"],
    evidence: [{
      field: "services",
      value: ["Public caller self-certified service"],
      source_url: "https://fixture.example/services",
      verified: true,
    }]
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(!calls.some(call => call.url === stylesheetUrl), "external CSS network request is forbidden");
  const colors = (result.body.extracted.brandPalette || [])
    .map(item => String(item.hex || item.color || item))
    .join(" ")
    .toUpperCase();
  assert.match(colors, /#0A4A7A/);
  assert.match(colors, /#123456|#E7A62B/);
  assert.notEqual(String(result.body.extracted.brandColors || "").trim(), "");
  assert.deepEqual(result.body.evidence, [], "public prefill callers cannot inject trusted evidence");
});

test("tattoo fallback keeps visible service lines and strips hidden CSS and script content", async () => {
  const sourceUrl = "https://west-side-tattoo.example/";
  const rawHtml = `<!doctype html><html><head>
    <style>.service-card,#tattoo-services{--service-gap:1rem;display:grid;position:relative}.fake{content:"Style Repair Services"}</style>
    <script>window.tattooServices=["Script Repair Services"];const copy="</style>Injected Repair Services";const markup="<style>";document.querySelector(".service-card")</script>
    <noscript><p>Noscript Repair Services</p></noscript>
    <svg><svg><text>Inner SVG Repair Services</text></svg>Leaked SVG Repair Service</svg>
    <template><template>Inner Template Repair Services</template>Leaked Template Repair Service</template>
    </head><body><main>
      <div>Custom Tattoo Services</div ><div onclick="renderServices()">Inline Handler Repair Services</div>
      <section><div>Cover-Up Tattoo Services</div></section>
      <article>Black and Grey Tattoo Services<br class="mobile-only">Fine Line Tattoo Services</article>
      <table><tr><td>Watercolor Tattoo Services</td><td>Lettering Tattoo Services</td></tr></table>
    </main>
    <style>.truncated-service{display:grid;position:absolute} Truncated Repair Services`;

  const result = await withFirecrawlFetch(
    fixtureFirecrawlFetch({ sourceUrl, rawHtml, title: "West Side Tattoo" }),
    () => invoke({ urls: [sourceUrl] })
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  const expected = [
    "Custom Tattoo Services",
    "Cover-Up Tattoo Services",
    "Black and Grey Tattoo Services",
    "Fine Line Tattoo Services",
    "Watercolor Tattoo Services",
    "Lettering Tattoo Services"
  ];
  assert.deepEqual(serviceLines(result.body.extracted.exactServices), expected);
  assert.deepEqual(serviceLines(result.body.extracted.mainServices), expected);
  const serviceText = `${result.body.extracted.exactServices || ""}\n${result.body.extracted.mainServices || ""}`;
  assert.doesNotMatch(serviceText, /Style Repair|Script Repair|Injected Repair|Noscript Repair|SVG Repair|Template Repair|Inline Handler Repair|Truncated Repair/i);
  assert.doesNotMatch(serviceText, /[{}]|--service|display\s*:|position\s*:|querySelector|window\./i);
});

test("self-closing raw-text tags fail closed instead of exposing fake services", async () => {
  const sourceUrl = "https://self-closing-script.example/";
  const rawHtml = "<script/>Fake Script Repair Service<div>Furnace Repair Services</div>";
  const result = await withFirecrawlFetch(
    fixtureFirecrawlFetch({ sourceUrl, rawHtml, title: "Blocked Script Fixture" }),
    () => invoke({ urls: [sourceUrl] })
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.extracted.exactServices, undefined);
  assert.equal(result.body.extracted.mainServices, undefined);
});

test("structured HVAC services preserve clean lines and reject CSS and JS candidates", async () => {
  const sourceUrl = "https://vogel-heating.example/";
  const structured = {
    mainServices: [
      "Furnace Repair",
      ".service-grid{display:grid;position:relative}",
      "Air Conditioning Installation",
      "HVAC Services: Repair & Maintenance",
      "R.V. Repair",
      "HVAC Repair (Residential)",
      "Data: Recovery Service",
      "Retail Display Block Installation",
      "Cover-Up",
      "Fine-Line",
      "Walk-Through",
      "Air-Conditioning",
      "Heating, Cooling",
      "Tattooing, Piercing",
      "--service-gap: 1rem",
      "window.vogelServices = ['Fake Repair']",
      "services = ['Furnace Repair']",
      "return 'Air Conditioning Repair'",
      "services.push('Heat Pump Repair')",
      "// Air Conditioning Repair",
      "\"service\": \"Heating Repair\"",
      "float:left",
      "clear:both",
      "outline:none",
      "clip-path:circle(50%)",
      "Furnace Repair float:left",
      "Custom Tattooing .service-card",
      "services.map(renderService)",
      "renderServices()",
      "if (service) repair()",
      "new RepairService()",
      "service: \"Heating Repair\"",
      "service && repair()",
      "repair-service:hover",
      "repair-card.service",
      "&:has(.service)",
      "Custom Tattooing @scope (.card)",
      "Furnace Repair -webkit-font-smoothing: antialiased",
      "-webkit-line-clamp: 2",
      "stroke-width: 2",
      "fill-rule: evenodd",
      "service-color: red",
      "display&#58;block",
      "repair-service",
      "body repair-service",
      "Repair-Service:hover",
      "service-card, hvac-service",
      "Furnace Repair line-clamp: 2",
      "Air Conditioning Repair orphans: 2",
      "HVAC Repair zoom: 1",
      "service ? repair : install",
      "await repairService",
      "obj[\"service\"]",
      "/service/gi",
      "`Furnace Repair`",
      "<li onclick=\"renderServices()\">Furnace Repair</li>",
      "style=\"display:grid\""
    ],
    exactServices: [
      "Heat Pump Repair",
      "Preventive HVAC Maintenance",
      "Cover-Up",
      "Fine-Line",
      "Walk-Through",
      "Air-Conditioning",
      "Heating, Cooling",
      "Tattooing, Piercing",
      "#services .repair-card{display:block}",
      "@media (min-width: 48rem){.service-card{position:sticky!important}}",
      "Ductwork Repair .service-card{display:block}"
    ].join("\n"),
    mustInclude: "const rv = 'HVAC'; display:flex"
  };

  const result = await withFirecrawlFetch(
    fixtureFirecrawlFetch({ sourceUrl, json: structured, title: "Vogel Heating & Cooling" }),
    () => invoke({ urls: [sourceUrl] })
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  const expected = [
    "Air Conditioning Installation",
    "Air-Conditioning",
    "Cover-Up",
    "Data: Recovery Service",
    "Fine-Line",
    "Furnace Repair",
    "Heating, Cooling",
    "Heat Pump Repair",
    "HVAC Repair (Residential)",
    "HVAC Services: Repair & Maintenance",
    "Preventive HVAC Maintenance",
    "R.V. Repair",
    "Retail Display Block Installation",
    "Tattooing, Piercing",
    "Walk-Through"
  ];
  for (const field of ["mainServices", "exactServices"]) {
    const lines = serviceLines(result.body.extracted[field]);
    assert.deepEqual([...lines].sort(), [...expected].sort());
    assert.equal(lines.length, expected.length, `${field} must contain only clean service labels`);
    assert.doesNotMatch(result.body.extracted[field], /Ductwork Repair|Custom Tattooing|Heating Repair|RV Air Conditioner|RepairService|renderServices|service-grid|repair-card|repair-service|hvac-service|--service|-webkit|stroke-width|fill-rule|service-color|line-clamp|orphans\s*:|zoom\s*:|display\s*:|position\s*:|float\s*:|clear\s*:|outline\s*:|clip-path\s*:|@(?:media|scope)|!important|window\.|services\s*=|return\s+|\.push\s*\(|\.map\s*\(|querySelector|onclick|style\s*=|await\s+|obj\[|\/service\/|`/i);
  }
});

test("lowercase natural service labels survive while selector-shaped tokens stay rejected", async () => {
  const sourceUrl = "https://lowercase-services.example/";
  const cleanServices = [
    "air-conditioning",
    "fine-line",
    "cover-up",
    "walk-through",
    "heating, cooling"
  ];
  const contaminated = [
    "repair-service:hover",
    "repair-card.service",
    "service-card, hvac-service",
    "body repair-service"
  ];
  const structured = {
    mainServices: [...cleanServices, ...contaminated].join("\n"),
    exactServices: [...cleanServices, ...contaminated].join("\n")
  };

  const result = await withFirecrawlFetch(
    fixtureFirecrawlFetch({ sourceUrl, json: structured, title: "Lowercase Service Fixture" }),
    () => invoke({ urls: [sourceUrl] })
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  for (const field of ["mainServices", "exactServices"]) {
    assert.deepEqual(serviceLines(result.body.extracted[field]), cleanServices);
    assert.doesNotMatch(result.body.extracted[field], /repair-service:hover|repair-card\.service|service-card,\s*hvac-service|body\s+repair-service/i);
  }
});

test("verified evidence is bound to the exact shared-platform tenant", () => {
  const sources = [
    "https://youtube.com/@client",
    "https://tiktok.com/@client",
    "https://youtu.be/client-video",
    "https://share.google/client-token",
    "https://nextdoor.com/pages/client",
    "https://client-business.example/",
  ];
  const accepted = [
    { field: "services", value: "Video service", source_url: "https://youtube.com/@client/services", verification_status: "source_verified" },
    { field: "services", value: "TikTok service", source_url: "https://tiktok.com/@client/video/1", verified: true },
    { field: "services", value: "Video proof", source_url: "https://youtu.be/client-video", verified: true },
    { field: "services", value: "Google proof", source_url: "https://share.google/client-token", verified: true },
    { field: "services", value: "First-party proof", source_url: "https://client-business.example/services", verified: true },
  ];
  const rejected = [
    { field: "services", value: "Competitor YouTube", source_url: "https://youtube.com/@competitor/services", verified: true },
    { field: "services", value: "Competitor TikTok", source_url: "https://tiktok.com/@competitor/video/1", verified: true },
    { field: "services", value: "Competitor video", source_url: "https://youtu.be/competitor-video", verified: true },
    { field: "services", value: "Competitor Google", source_url: "https://share.google/competitor-token", verified: true },
    { field: "services", value: "Unlisted shared host", source_url: "https://nextdoor.com/pages/competitor", verified: true },
    { field: "services", value: "Status-only self assertion", source_url: "https://client-business.example/fake", status: "verified" },
  ];

  const retained = firecrawlHandler.verifiedEvidenceForSources([...accepted, ...rejected], sources);
  assert.deepEqual(retained, accepted);
});
