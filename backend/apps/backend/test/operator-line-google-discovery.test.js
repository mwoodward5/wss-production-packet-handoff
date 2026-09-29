"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isDirectoryUrl,
  mineBuildReady,
  searchPlacesPage,
} = require("../lib/lead-miner");
const { CircuitBreaker } = require("../lib/discovery-health");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const SITE = "https://acme-home-services.com/";
const DIRECTORY = "https://www.yelp.com/biz/acme-home-services-spokane";

const SPARSE_HTML = `<!doctype html><html><head>
  <title>Acme Home Services | Spokane WA</title>
  <meta name="description" content="Acme Home Services is based in Spokane, Washington.">
</head><body>
  <main><h1>Acme Home Services</h1><p>Locally owned. Call our team today.</p></main>
  <a href="mailto:hello@acme-home-services.com">Email Acme</a>
</body></html>`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mirrorPass() {
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      build_hash: "build-hash",
      donor_content_hash: "donor-hash",
      file_count: 51,
      evidence_sha: "evidence-sha",
      renderer: "mirror-engine@v1",
      checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
    },
  };
}

function inputFor(fetchImpl, overrides = {}) {
  return {
    trigger: "operator_line",
    // The provisional website -> Intake bridge is an owner-only Practice
    // capability. Callers must opt into it explicitly; trigger alone is not
    // permission to weaken the Live identity and trade gates.
    lane: "sandbox",
    queries: [{
      industry: "plumbing",
      location: "Spokane WA",
      textQuery: "plumbing in Spokane WA",
      queryGroup: 0,
    }],
    candidatesPerQuery: 1,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      // A configured Places key must not silently switch operator discovery.
      GOOGLE_PLACES_API_KEY: "places-key-that-must-not-be-used",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      // IDENTITY TRUST MODE (2026-08-31) is ON by default in production; this
      // suite pins the strict quarantine lane, so it opts out via the kill
      // switch. The trust-mode behavior is pinned by the tests at the bottom
      // of this file.
      GHOST_AGENCY_IDENTITY_TRUST: "0",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
    ...overrides,
  };
}

async function withGlobalFetch(fetchImpl, run) {
  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    global.fetch = realFetch;
  }
}

test("optional Places v1 identity lookup keeps its identity-only field mask", async () => {
  const requests = [];
  const page = await searchPlacesPage({
    key: "places-test-key",
    textQuery: "plumbing in Spokane WA",
    pageSize: 2,
    retries: 0,
    breaker: new CircuitBreaker(),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return json({ places: [] });
    },
  });

  assert.equal(page.ok, true, JSON.stringify(page));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, PLACES_SEARCH);
  const headers = requests[0].init.headers || {};
  const mask = String(headers["X-Goog-FieldMask"] || headers["x-goog-fieldmask"] || "");
  for (const field of [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.businessStatus",
    "places.primaryType",
    "places.types",
    "places.addressComponents",
    "places.googleMapsUri",
    "nextPageToken",
  ]) {
    assert.ok(mask.includes(field), `identity mask is missing ${field}: ${mask}`);
  }
  for (const field of [
    "places.photos",
    "places.rating",
    "places.userRatingCount",
    "places.reviews",
    "places.regularOpeningHours",
    "places.editorialSummary",
  ]) {
    assert.ok(!mask.includes(field), `identity lookup must not request ${field}: ${mask}`);
  }
});

test("Firecrawl website discovery refuses directory and social child hosts without substring false positives", () => {
  for (const url of [
    "https://m.yelp.com/biz/acme",
    "https://api.yelp.com/businesses/acme",
    "https://m.facebook.com/acme-plumbing",
    "https://sites.google.com/view/acme-plumbing",
  ]) {
    assert.equal(isDirectoryUrl(url), true, `${url} must not enter first-party website capture`);
  }
  assert.equal(isDirectoryUrl("https://notyelp.com/"), false,
    "an unrelated owner whose hostname merely contains yelp must remain eligible");
});

test("operator Line discovers the owned website with Firecrawl and carries sparse website plus email to Intake", async () => {
  const requests = [];
  let mirrorCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    requests.push({ href, method, body: String(init.body || "") });

    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ data: [
        { url: DIRECTORY, title: "Spokane service directory" },
        { url: SITE, title: "Acme Home Services" },
      ] });
    }
    if (href === SITE && method === "GET") {
      return new Response(SPARSE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (href === PLACES_SEARCH) throw new Error("operator discovery dialed Places");
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  assert.equal(mirrorCalls, 1);
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.cost.places_photo_media_calls, 0);
  assert.equal(out.provider_health.mode, "skipped_zero_google");

  const discovery = out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl");
  assert.ok(discovery, JSON.stringify(out.funnel));
  assert.equal(discovery.cost, "firecrawl_search");
  assert.equal(discovery.entered, 2);
  assert.equal(discovery.survived, 1);
  assert.equal(discovery.rejected.directory_or_social_page, 1);
  const identity = out.funnel.find((stage) => stage.stage === "6_first_party_identity");
  assert.equal(identity.survived, 1, JSON.stringify(out.funnel));

  const record = out.records[0];
  assert.equal(record.discovery.via, "firecrawl_search");
  assert.equal(record.discovery.url, SITE);
  assert.equal(record.identity_source, "owner_only_practice_provisional");
  assert.equal(record.identity_provisional, true);
  assert.equal(record.identity_provisional_reason, "awaiting_intake_genie_identity");
  assert.equal(record.mirror_request.facts.current_website, SITE);
  assert.equal(record.mirror_request.facts.email, "hello@acme-home-services.com");
  assert.equal(record.email_evidence.email, "hello@acme-home-services.com");

  // Category and template signals are routing notes. They cannot discard a
  // reachable first-party site before the signed Intake Genie compile.
  assert.equal(record.qualification.template_fit.original_ok, false);
  assert.equal(record.qualification.template_fit.advisory, true);
  assert.equal(record.qualification.template_fit.admittedBy, "operator_requested_provisional");
  assert.equal(record.trade_corroboration.ok, true);
  assert.equal(record.trade_corroboration.provenance_class, "provisional");
  assert.equal(record.trade_corroboration.basis, "operator_requested_trade");
  assert.equal(record.provenance.industry.method, "operator_requested_provisional");
  assert.equal(out.rejects.some((row) => [
    "trade_swap",
    "template_family_fit_below_threshold",
    "product_dominant_site",
  ].includes(row.reason)), false, JSON.stringify(out.rejects));

  assert.equal(requests.filter((request) => request.href === FIRECRAWL_SEARCH).length, 1);
  assert.equal(requests.filter((request) => request.href === SITE).length, 1);
  assert.equal(requests.some((request) => request.href === DIRECTORY), false,
    "a directory result must never be fetched as the business website");
  assert.equal(requests.some((request) => request.href === PLACES_SEARCH), false);
});

test("only explicit Practice may carry the sparse provisional/category-advisory candidate to Intake", async () => {
  for (const lane of ["live", "omitted"]) {
    let mirrorCalls = 0;
    const fetchImpl = async (url, init = {}) => {
      const href = String(url && url.url ? url.url : url);
      const method = String(init.method || "GET").toUpperCase();
      if (href === FIRECRAWL_SEARCH && method === "POST") {
        return json({ data: [{ url: SITE, title: "Acme Home Services" }] });
      }
      if (href === SITE && method === "GET") {
        return new Response(SPARSE_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`unstubbed fetch: ${method} ${href}`);
    };
    const input = inputFor(fetchImpl, {
      mirrorImpl: async () => {
        mirrorCalls += 1;
        return mirrorPass();
      },
    });
    if (lane === "omitted") delete input.lane;
    else input.lane = lane;

    const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

    assert.equal(out.ok, true, `${lane}: ${JSON.stringify(out.rejects)}`);
    assert.equal(out.records.length, 0, `${lane}: a Live-shaped input cannot emit the provisional record`);
    assert.equal(mirrorCalls, 0, `${lane}: a held candidate cannot start build proof`);
    assert.equal(out.records.some((record) => record.identity_provisional === true), false);
    assert.equal(out.held_rows.length, 1, `${lane}: ${JSON.stringify(out.held_rows)}`);
    assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
    assert.equal(out.held_rows[0].record.identity_provisional, undefined);
    assert.equal(out.rejects.some((row) => row.reason === "identity_unverified_first_party"), true,
      `${lane}: ${JSON.stringify(out.rejects)}`);
  }
});

test("Live operator keeps sport fencing on a hard hold before build proof", async () => {
  const sportHtml = `<!doctype html><html><head>
    <title>Duke City Fencing Academy | Spokane WA</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Duke City Fencing Academy",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Spokane",
        addressRegion: "WA",
        postalCode: "99201",
      },
    })}</script>
  </head><body>
    <h1>Duke City Fencing Academy</h1>
    <p>Olympic fencing club with sabre and epee coaching, tournaments, and classes for kids.</p>
    <a href="mailto:coach@acme-home-services.com">Email the academy</a>
  </body></html>`;
  let mirrorCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ data: [{ url: SITE, title: "Duke City Fencing Academy" }] });
    }
    if (href === SITE && method === "GET") {
      return new Response(sportHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    lane: "live",
    queries: [{
      industry: "fencing",
      location: "Spokane WA",
      textQuery: "fencing in Spokane WA",
      queryGroup: 0,
    }],
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_SPORT_FENCING_GUARD: "1",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.records.length, 0);
  assert.equal(mirrorCalls, 0, "sport fencing cannot reach Live build proof");
  const hold = out.held_rows.find((row) => row.record.blocked_reason === "vertical_mismatch_sport_fencing");
  assert.ok(hold, JSON.stringify(out.held_rows));
  assert.equal(hold.status, "held");
  assert.equal(hold.record.vertical_hold.reason, "vertical_mismatch_sport_fencing");
  assert.equal(out.rejects.some((row) => row.reason === "vertical_mismatch_sport_fencing"), true);
});

test("operator Line refuses a cross-owner landing without spending on recovery or build proof", async () => {
  const victim = "https://victim.example/";
  const foreign = "https://foreign.example/landing";
  let mirrorCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ data: [{ url: victim, title: "Victim Home Services" }] });
    }
    if (href === victim && method === "GET") {
      const response = new Response(SPARSE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: foreign });
      return response;
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0);
  assert.equal(mirrorCalls, 0);
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.firecrawl_scrape_calls, 0);
  assert.equal(out.cost.homepage_scrape_fallbacks, 0);
  assert.equal(out.cost.places_calls, 0);
  const rejection = out.rejects.find((row) => row.reason === "identity_cross_owner_redirect");
  assert.ok(rejection, JSON.stringify(out.rejects));
  assert.match(rejection.detail, /victim\.example landed on foreign\.example/);
});

test("one-site Practice searches the wide 50-result pool, inspects what survives, and proves only the requested row", async () => {
  const requests = [];
  let homepageGets = 0;
  let mirrorCalls = 0;
  const results = Array.from({ length: 12 }, (_, index) => ({
    url: `https://site-${index}.example/services?source=search`,
    title: `Acme Home Services ${index}`,
  }));
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    requests.push({ href, method, body: String(init.body || "") });
    if (href === FIRECRAWL_SEARCH && method === "POST") return json({ data: results });
    const match = /^https:\/\/site-(\d+)\.example\/$/.exec(href);
    if (match && method === "GET") {
      homepageGets += 1;
      const index = Number(match[1]);
      return new Response(SPARSE_HTML
        .replaceAll("Acme Home Services", `Acme Home Services ${index}`)
        .replaceAll("hello@acme-home-services.com", `hello@site-${index}.example`), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (href === PLACES_SEARCH) throw new Error("bounded pool dialed Places");
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.records.length, 1);
  assert.equal(mirrorCalls, 1, "the operator must prove only the requested quota");
  // Owner directive 2026-09-01: the search width is 50, so every candidate the
  // wide SERP returned (12 here) is inspected for free; the paid/slow proof
  // pool stays quota-bounded, which is why only one row is ever proven.
  assert.equal(homepageGets, 12, "every surviving wide-SERP candidate gets its one free homepage GET");
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.places_calls, 0);
  const searchRequest = requests.find((request) => request.href === FIRECRAWL_SEARCH);
  assert.equal(JSON.parse(searchRequest.body).limit, 50);
  assert.equal(out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl").entered, 12);
  assert.equal(out.records[0].discovery.url, "https://site-0.example/");
});

test("operator Firecrawl failure costs one attempt; an exhausted query cycle costs zero", async () => {
  let calls = 0;
  const failedFetch = async (url) => {
    assert.equal(String(url), FIRECRAWL_SEARCH);
    calls += 1;
    return json({ error: "provider unavailable" }, 503);
  };
  const failed = await withGlobalFetch(failedFetch, () => mineBuildReady(inputFor(failedFetch)));

  assert.equal(failed.ok, true);
  assert.equal(failed.records.length, 0);
  assert.equal(calls, 1);
  assert.equal(failed.cost.firecrawl_search_calls, 1);
  assert.equal(failed.cost.places_calls, 0);
  assert.equal(failed.rejects.some((row) => row.reason === "firecrawl_http_503"), true);

  calls = 0;
  const neverFetch = async () => {
    calls += 1;
    throw new Error("an exhausted query cycle must not call a provider");
  };
  const exhausted = await withGlobalFetch(neverFetch, () => mineBuildReady(inputFor(neverFetch, {
    queries: [{
      industry: "plumbing",
      location: "Spokane WA",
      textQuery: "plumbing in Spokane WA",
      queryGroup: 0,
      queryShapeCount: 2,
      queryShapeIndex: 0,
    }],
    refillRound: 2,
    sourceMode: "fixed_market",
  })));

  assert.equal(exhausted.ok, true);
  assert.equal(exhausted.records.length, 0);
  assert.equal(calls, 0);
  assert.equal(exhausted.cost.firecrawl_search_calls, 0);
  assert.equal(exhausted.cost.places_calls, 0);
  assert.deepEqual(exhausted.source_exhausted, {
    exhausted: true,
    reason: "operator_query_cycle_exhausted",
    refill_round: 2,
  });
});

// ---------------------------------------------------------------------------
// IDENTITY TRUST MODE (owner directive 2026-08-31) — the production default.
//
// TRUST THE SITE: a first-party site with no schema.org identity block and no
// Google observation is an underserved lead, not a defect. On the LIVE
// operator lane the strict quarantine above becomes a clean pass — the site's
// own name, phone and email carried as-is, the queried market labelled as a
// hint, no override tag because nothing was overridden. Places is never
// dialed and never needed. The suite's default env ("0" in inputFor) pins
// the strict lane; these tests opt back in with "1".
// ---------------------------------------------------------------------------
const NO_SCHEMA_OPERATOR_HTML = `<!doctype html><html><head>
  <title>Riverside Plumbing | Spokane WA</title>
</head><body>
  <main><h1>Riverside Plumbing</h1><p>Family owned and operated in Spokane.</p></main>
  <section class="services"><h2>Services</h2><h3>Drain Cleaning</h3><h3>Water Heater Repair</h3><h3>Leak Repair</h3></section>
  <a href="tel:+15095550188">Call (509) 555-0188</a>
  <a href="mailto:riversideplumbing@gmail.com">Email us</a>
</body></html>`;

test("identity trust: a LIVE operator pick with no schema and no GBP passes clean on site truth", async () => {
  const site = "https://riverside-plumbing.example.com/";
  let mirrorCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ data: [{ url: site, title: "Riverside Plumbing | Spokane WA" }] });
    }
    if (href === site && method === "GET") {
      return new Response(NO_SCHEMA_OPERATOR_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (href === PLACES_SEARCH) throw new Error("trust mode must not make Places a dependency");
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });
  delete input.lane; // LIVE-shaped input — the lane the strict suite refuses
  input.env.GHOST_AGENCY_IDENTITY_TRUST = "1";

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.held_rows.length, 0, "an incomplete site identity is not a review hold in trust mode");
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(mirrorCalls, 1, "the trust-mode pick proceeds to build proof");
  assert.equal(out.cost.places_calls, 0, "Places presence is never a dependency");

  const record = out.records[0];
  // No tag, no provisional scoping: the pass is clean because an incomplete
  // site identity is not a failure trust suppresses — it stops being asked.
  assert.equal(record.identity_trust_overrides, undefined);
  assert.equal(record.identity_provisional, undefined);
  assert.equal(record.identity_source, "first_party");

  const facts = record.mirror_request.facts;
  assert.equal(facts.business_name, "Riverside Plumbing");
  assert.equal(facts.phone, "+15095550188");
  assert.equal(record.provenance.business_name.method, "self_published:html_h1_trust");
  assert.equal(record.provenance.phone.method, "self_published:tel_link");
  // The queried market rides as the labelled hint for the absent fields.
  assert.equal(facts.city, "Spokane");
  assert.equal(facts.state, "WA");
  assert.equal(record.provenance.city.class, "provisional");
  assert.equal(record.provenance.city.method, "identity_trust_mode");
  assert.equal(record.metro_fence.basis, "identity_trust_market_hint");
  // The site's scraped email routes the new site's contact form.
  assert.equal(facts.email, "riversideplumbing@gmail.com");

  const identity = out.funnel.find((stage) => stage.stage === "6_first_party_identity");
  assert.equal(identity.survived, 1, JSON.stringify(out.funnel));
  assert.deepEqual(identity.rejected, {}, "trust mode converts the identity quarantine — nobody dies at stage 6");
});

test("identity trust kill switch: the LIVE sparse pick still quarantines exactly as before", async () => {
  let mirrorCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ data: [{ url: SITE, title: "Acme Home Services" }] });
    }
    if (href === SITE && method === "GET") {
      return new Response(SPARSE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  const input = inputFor(fetchImpl, {
    mirrorImpl: async () => {
      mirrorCalls += 1;
      return mirrorPass();
    },
  });
  delete input.lane;
  // inputFor's default env already carries GHOST_AGENCY_IDENTITY_TRUST="0";
  // restated because this test IS the reversibility contract.

  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0, "strict mode keeps the live sparse quarantine");
  assert.equal(mirrorCalls, 0);
  assert.equal(out.held_rows.length, 1);
  assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
});
