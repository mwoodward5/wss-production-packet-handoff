"use strict";

// THE LEFT-SIDE SIGN-UP PANEL MUST REACH BOTH BUILD PATHS.
//
// On 2026-08-06 all four live plumbing mirrors were fetched and searched: none
// contained "wss-floater", none contained a Client ID, none contained Riley's
// line. The panel had been built, tested and shipped — into ONE of the two
// build paths in lib/mirror-lane-build.js. The LeadMiner packet path assembled
// a `signup` object inline; the resolver path had no `signup` key at all, and
// an absent key is silently "no panel wanted" one layer down:
//
//     const floater = signup ? buildSignupFloater(signup) : "";
//
// Every seeded and every mined prospect takes the resolver path, so the revenue
// surface was missing from every mirror the line actually produced, and no
// report anywhere said so.
//
// These tests pin the two properties that make that impossible to repeat:
//   1. NEITHER path builds the config — both ask resolveSignupConfig.
//   2. When the panel cannot be configured, the build SAYS SO in its report
//      (and, deliberately, still builds — see the note on revealable below).

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
const { resolveSignupConfig, buildSignupFloater } = require("../lib/mirror-engine/signup-floater");
const { inject } = require("../lib/mirror-engine/content-inject");
const { clientReferenceCode } = require("../lib/client-reference");

// GHOST_AGENCY_CHECKOUT_LINK_SECRET is cleared with the rest because the panel
// now MINTS a signed buy link when that secret is present (see
// lib/checkout-links.js prospectCheckoutUrl). Leaving it to whatever the shell
// happens to export would make "with no Riley line and no checkout the panel is
// refused" pass or fail depending on the machine, which is not a test.
const PHONE_ENV = [
  "GHOST_AGENT_PHONE",
  "GHOST_AGENCY_AGENT_PHONE",
  "GHOST_AGENCY_CHECKOUT_URL",
  "GHOST_AGENCY_CHECKOUT_LINK_SECRET",
  "GHOST_AGENCY_FLOATER_PILL_FIRST",
];

// AWAITS the callback. A synchronous restore would put the environment back
// before an async build ever read it — which is a fake pass, not a pass.
async function withEnv(values, fn) {
  const saved = {};
  for (const name of PHONE_ENV) saved[name] = process.env[name];
  for (const name of PHONE_ENV) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  try { return await fn(); } finally {
    for (const name of PHONE_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

// A build whose mirror() is captured rather than performed. `checks.content`
// echoes what content-inject would have reported, so signupPanelReport is
// exercised against realistic evidence rather than an empty object.
function captureMirror(state, { contentCheck = true } = {}) {
  return async (request) => {
    state.request = request;
    const content = contentCheck
      ? {
        status: "injected",
        sections: 3,
        signup_panel: request.signup
          ? { present: true, pages: 1, bytes: 7185, client_id: request.signup.clientId || "", riley: Boolean(request.signup.rileyTel), checkout: Boolean(request.signup.checkoutUrl), reason: "" }
          : { present: false, pages: 0, bytes: 0, client_id: "", riley: false, checkout: false, reason: "no_signup_config_supplied" },
      }
      : null;
    return {
      status: 200,
      body: {
        ok: true,
        revealable: true,
        preview_url: `https://${request.slug}.wss-ai.com/`,
        checks: { ...(content ? { content } : {}) },
      },
    };
  };
}

const DONOR = { ok: true, donor: "plumbing-clean", vertical: "plumbing" };

const RESOLVER_PROSPECT = Object.freeze({
  prospect_id: "wss-test-rimrock-plumbing-billings",
  business_name: "Rimrock Plumbing",
  industry: "plumbing",
  city: "Billings",
  state: "MT",
  current_website: "https://rimrockplumbing.com/",
  logo: "https://irp.cdn-website.com/4b1b82c8/dms3rep/multi/opt/Rimrock-Plumbing-Logo1-272w.png",
  phone: "(406) 855-7131",
});

function resolverDeps(state, opts) {
  return {
    resolveBuildableDonor: () => DONOR,
    // The resolver finds the client's own services. This fixture used to
    // resolve NOTHING, which quietly made every test below a test of a
    // CONTENTLESS build — so "a missing panel does not strand the build" was
    // really asserting that a bare donor template is fine to send. It is not
    // (see contentFloorReport), and the panel question is only isolated when
    // there is a real page for the panel to be missing from.
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {},
      // Three since 2026-08-11, for the same reason the comment above gives
      // about two: serviceFloorReport holds a build whose services section has
      // fewer than three real services, so a two-service fixture would have
      // turned every test below back into a test of a HELD build.
      content: { services: [{ name: "Drain cleaning" }, { name: "Water heater repair" }, { name: "Hydro jetting" }] },
    }),
    harvestClientPhotos: async () => ({ ok: false, photos: [] }),
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    mirror: captureMirror(state, opts),
  };
}

// ---------------------------------------------------------------------------
// 1. THE RESOLVER PATH — the one that shipped four bare mirrors.
// ---------------------------------------------------------------------------

test("the resolver path carries the sign-up panel (the four live mirrors did not)", async () => {
  const state = {};
  const out = await withEnv({ GHOST_AGENCY_AGENT_PHONE: "+19493395562" }, () => (
    buildMirrorForProspect(RESOLVER_PROSPECT, { deps: resolverDeps(state) })
  ));

  assert.ok(state.request.signup, "the resolver path must hand mirror() a signup config");
  assert.equal(state.request.signup.clientId, "WSS-7A3980", "the same derived code the email prints and Riley recomputes");
  assert.equal(state.request.signup.rileyTel, "tel:+19493395562");
  assert.equal(state.request.signup.rileyDisplay, "(949) 339-5562");
  assert.equal(state.request.signup.domain, "wss-test-rimrock-plumbing-billings.wss-ai.com");

  assert.equal(out.signup_panel.status, "present");
  assert.equal(out.signup_panel.present, true);
  assert.equal(out.signup_panel.client_id, "WSS-7A3980");
  assert.equal(out.signup_panel.riley_source, "env:GHOST_AGENCY_AGENT_PHONE");
});

test("the Client ID on the panel is the code the caller reads to Riley, not a new one", () => {
  assert.equal(clientReferenceCode(RESOLVER_PROSPECT), "WSS-7A3980");
});

// ---------------------------------------------------------------------------
// 2. BOTH PATHS, ONE READER.
// ---------------------------------------------------------------------------

function packetProspect() {
  const site = "https://fixture-plumbing.example/";
  const places = "https://places.googleapis.com/v1/places/ChIJSignupFixture";
  const prov = (source, source_kind = "website") => ({ source, source_kind, captured_at: "2026-08-05T05:31:00.000Z" });
  return {
    prospect_id: "wss-test-rimrock-plumbing-billings",
    truth_packet: {
      meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
      mirror_ready: {
        business_name: "Rimrock Plumbing",
        place_id: "ChIJSignupFixture",
        industry: "plumber",
        city: "Billings",
        state: "MT",
        logo_url: `${site}assets/logo.svg`,
        logo_source_url: site,
        photos: [{ url: `${site}assets/truck.jpg`, source: "own_site" }],
        services: [{ name: "Drain cleaning" }],
        provenance: {
          "/business_name": prov(places, "google_places_api"),
          "/place_id": prov(places, "google_places_api"),
          "/industry": prov("leadminer:project-trade:plumber", "leadminer_derived"),
          "/city": prov(places, "google_places_api"),
          "/state": prov(places, "google_places_api"),
          "/logo_url": prov(site),
          "/logo_source_url": prov(site),
          "/photos/0/url": prov(site),
          "/photos/0/source": prov(site),
          "/services/0/name": prov(`${site}services`),
        },
      },
    },
  };
}

test("both build paths ask the SAME reader, so they cannot drift apart again", async () => {
  const env = { GHOST_AGENCY_AGENT_PHONE: "+19493395562" };

  const packetState = {};
  await withEnv(env, () => buildMirrorForProspect(packetProspect(), {
    deps: {
      resolveBuildableDonor: () => DONOR,
      captureFonts: async () => ({ ok: false }),
      readIntakePacket: () => ({ ok: false }),
      mergeIntoContent: (content) => content,
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      mirror: captureMirror(packetState),
    },
  }));

  const resolverState = {};
  await withEnv(env, () => buildMirrorForProspect(RESOLVER_PROSPECT, { deps: resolverDeps(resolverState) }));

  assert.ok(packetState.request.signup, "the LeadMiner packet path must still carry the panel");
  assert.deepEqual(
    packetState.request.signup,
    resolverState.request.signup,
    "the same prospect must get the same panel whichever path builds it",
  );
});

test("an operator-supplied slug is the domain the panel advertises", async () => {
  const state = {};
  await withEnv({ GHOST_AGENCY_AGENT_PHONE: "+19493395562" }, () => buildMirrorForProspect(
    RESOLVER_PROSPECT,
    { slug: "wss-test-operator-chosen", deps: resolverDeps(state) },
  ));
  // The hand-assembled version recomputed slugFor() for the domain and ignored
  // opts.slug, so the panel advertised a hostname the build never created.
  assert.equal(state.request.signup.domain, "wss-test-operator-chosen.wss-ai.com");
});

// ---------------------------------------------------------------------------
// 3. ABSENCE IS LOUD — AND DELIBERATELY NOT FATAL.
// ---------------------------------------------------------------------------

test("with no Riley line and no checkout the panel is refused BY NAME, not silently", async () => {
  const state = {};
  const out = await withEnv({}, () => buildMirrorForProspect(RESOLVER_PROSPECT, { deps: resolverDeps(state) }));

  assert.equal(state.request.signup, undefined, "nothing legitimate to show means no panel");
  assert.equal(out.signup_panel.status, "unconfigured");
  assert.equal(out.signup_panel.present, false);
  assert.match(out.signup_panel.reason, /GHOST_AGENCY_CHECKOUT_URL/, "name the variable an operator has to set");
  assert.match(out.signup_panel.reason, /Riley/, "and name the other half too");
});

test("a missing panel does NOT strand the build — it is a commercial defect, not a truth defect", async () => {
  const state = {};
  const out = await withEnv({}, () => buildMirrorForProspect(RESOLVER_PROSPECT, { deps: resolverDeps(state) }));
  // One unset environment variable must never take the whole line dark, and
  // "mirror_build_not_revealable" is the exact lie-by-omission that already
  // cost a day. Nothing about the CLIENT is misstated by our upsell's absence.
  assert.equal(out.ok, true);
  assert.equal(out.revealable, true);
});

test("a configured panel that never reached the HTML is reported as lost, not as present", async () => {
  const state = {};
  const out = await withEnv({ GHOST_AGENCY_AGENT_PHONE: "+19493395562" }, () => buildMirrorForProspect(
    RESOLVER_PROSPECT,
    { deps: resolverDeps(state, { contentCheck: false }) },
  ));
  // Content injection is what carries the panel; when it never runs, a config
  // that says "ok" proves nothing about the served bytes.
  assert.equal(out.signup_panel.configured, true);
  assert.equal(out.signup_panel.present, false);
  assert.equal(out.signup_panel.status, "not_injected");
});

// ---------------------------------------------------------------------------
// 4. THE INJECTOR'S OWN REPORT — counted off the emitted bytes.
// ---------------------------------------------------------------------------

const FACTS = { business_name: "Rimrock Plumbing", industry: "plumbing", city: "Billings", state: "MT" };
const PAGE = { "index.html": Buffer.from("<html><body><div id=\"root\"></div></body></html>", "utf8") };

test("content-inject reports the panel it wrote, and names the absence when it wrote none", () => {
  const withPanel = inject({
    files: PAGE,
    content: { services: [{ name: "Drain cleaning" }] },
    facts: FACTS,
    slug: "wss-test-rimrock-plumbing-billings",
    signup: { clientId: "WSS-7A3980", rileyTel: "tel:+19493395562", rileyDisplay: "(949) 339-5562", domain: "wss-test-rimrock-plumbing-billings.wss-ai.com" },
  });
  assert.equal(withPanel.report.signup_panel.present, true);
  assert.equal(withPanel.report.signup_panel.pages, 1);
  assert.equal(withPanel.report.signup_panel.client_id, "WSS-7A3980");
  assert.equal(withPanel.report.signup_panel.riley, true);
  assert.ok(withPanel.report.signup_panel.bytes > 1000);
  const html = withPanel.files["index.html"].toString("utf8");
  assert.match(html, /id="wss-floater"/);
  assert.match(html, /WSS-7A3980/);
  assert.match(html, /tel:\+19493395562/);

  const without = inject({
    files: PAGE,
    content: { services: [{ name: "Drain cleaning" }] },
    facts: FACTS,
    slug: "wss-test-rimrock-plumbing-billings",
  });
  assert.equal(without.report.signup_panel.present, false);
  assert.equal(without.report.signup_panel.reason, "no_signup_config_supplied");
  assert.doesNotMatch(without.files["index.html"].toString("utf8"), /wss-floater/);
});

test("the panel still refuses to appear in a proof shot", () => {
  const html = buildSignupFloater({ clientId: "WSS-7A3980", rileyTel: "tel:+19493395562", domain: "x.wss-ai.com" });
  // The email's before/after image is a picture of the CLIENT'S site; our
  // upsell must remove itself — the PILL included, since it is server-rendered
  // markup and an early `return` once left "$199 site plan" in the thumbnail.
  assert.match(html, /wssthumb=1/);
  assert.match(html, /f\.remove\(\);p\.remove\(\)/);
});

// ---------------------------------------------------------------------------
// 5. PILL FIRST BY DEFAULT — AND STILL INVISIBLE TO A CAMERA
// ---------------------------------------------------------------------------
// The full offer must not cover first-paint hero text or media. The card stays
// hidden in server-rendered markup and desktop joins mobile in showing the pill
// first. The old desktop auto-open remains available only as an explicit env
// rollback, after the proof-shot guard has run.

const OPEN_PANEL = () => buildSignupFloater({
  clientId: "WSS-7A3980",
  rileyTel: "tel:+19493395562",
  rileyDisplay: "(949) 339-5562",
  checkoutUrl: "https://ghost.wss-ai.com/api/checkout?p=x&sig=y",
  domain: "x.wss-ai.com",
});

test("the card is closed in the MARKUP; only the script ever opens it", () => {
  const html = OPEN_PANEL();
  // If this ever renders unhidden, a camera catches it before any script runs —
  // and the ?wssthumb=1 guard is a script.
  assert.match(html, /<div class="wss-card" id="wss-plan-card" hidden>/);
  // And the guard runs BEFORE anything can open it. An ordering assertion, not
  // a presence one: both lines existing in the wrong order is the whole bug.
  const guardAt = html.indexOf("wssthumb=1");
  const opensAt = html.indexOf("c.hidden=false");
  assert.ok(guardAt > 0 && opensAt > 0);
  assert.ok(guardAt < opensAt, "the thumbnail guard must precede every path that opens the card");
});

test("it stays a pill on desktop and phone by default; 0 restores old desktop auto-open", async () => {
  const html = await withEnv({}, () => OPEN_PANEL());
  // The default emits no load-time open path. The card can only open after the
  // visitor clicks the pill, so it cannot cover first-paint hero text or media.
  assert.doesNotMatch(html, /if\(!phone\(\)&&!dismissed\(\)\)open\(\);/);
  assert.match(html, /p\.addEventListener\('click',function\(\)\{remember\(false\);open\(\);\}\)/);
  // Phone is the CSS's own breakpoint, read back through matchMedia, so the
  // layout and the open/closed decision cannot drift apart.
  assert.match(html, /matchMedia\('\(max-width:760px\)'\)/);
  assert.match(html, /@media\(max-width:760px\)/);

  const rollback = await withEnv({ GHOST_AGENCY_FLOATER_PILL_FIRST: "0" }, () => OPEN_PANEL());
  // The kill switch restores exactly the old desktop-only/session-aware path;
  // its phone guard preserves the mobile pill-first law.
  assert.match(rollback, /if\(!phone\(\)&&!dismissed\(\)\)open\(\);/);
  assert.ok(rollback.indexOf("wssthumb=1") < rollback.indexOf("if(!phone()&&!dismissed())open();"));
});

test("the scrim is raised only on a phone — a desktop visitor keeps the client's chat bubble", () => {
  const html = OPEN_PANEL();
  // chat-widget.js hides itself whenever #wss-scrim.on exists, reading it as a
  // blocking overlay. The scrim's only display rule lives in the phone media
  // query, so raising it on a desktop is an invisible modal that costs the
  // client their chat launcher on every visit.
  assert.match(html, /s\.className=\(!c\.hidden&&phone\(\)\)\?'on':''/);
  assert.doesNotMatch(html, /s\.className='on'/);
});

test("a visitor who closes it is not asked again this session", () => {
  const html = OPEN_PANEL();
  assert.match(html, /sessionStorage/);
  assert.match(html, /remember\(true\);shut\(\)/);
  // …and re-opening it by hand clears the dismissal, so the pill still works.
  assert.match(html, /remember\(false\);open\(\)/);
});

test("the pill is measured off the client's own bottom bar, never parked on top of it", () => {
  const html = OPEN_PANEL();
  // A phone's primary CTA on these donors is a fixed bottom "call / get a
  // quote" bar. The lift is measured, not a guessed constant.
  assert.match(html, /--wss-floater-clear/);
  assert.match(html, /elementsFromPoint/);
  assert.match(html, /bottom:calc\(max\(12px,env\(safe-area-inset-bottom\)\) \+ var\(--wss-floater-clear,0px\)\)/);
});

// ---------------------------------------------------------------------------
// 6. OPEN, BUT NEVER OVER THE CLIENT'S OWN PAGE
// ---------------------------------------------------------------------------
// Opening the card by default put it exactly where these donors put the logo.
// Measured on the rendered page, not read out of the CSS: with the panel open at
// 1280, document.elementFromPoint at three points across the client's header
// mark returned "wss-plan-card" on roofing-falcon-clean and plumbing-premier,
// and the primary CTA was 77-100% covered on plumbing-clean, roofing-falcon-clean
// and hvac-brandforge. The cause was a one-line layout decision — a 264px card
// vertically centred (top:50% + translateY(-50%)) starts at (vh-H)/2, which for
// the ~640px this card wants is y≈80: the header band, on every donor.
//
// After: 7 donors x 2 viewports, every logo hit-test returns the logo and no
// primary CTA is covered. These tests pin the MECHANISM that makes that true,
// because the render proof cannot live in a unit test.
test("the open card is positioned from a measured header, never centred over one", () => {
  const html = OPEN_PANEL();
  // The centring that caused it must not come back.
  assert.doesNotMatch(html, /#wss-floater\{position:fixed;left:16px;top:50%/);
  assert.doesNotMatch(html, /translateY\(-50%\)/);
  // Position and height are both runtime measurements, and the fallbacks sit
  // below any plausible header rather than in the middle of the page.
  assert.match(html, /top:var\(--wss-floater-top,116px\)/);
  assert.match(html, /max-height:var\(--wss-floater-maxh,72vh\)/);
  // The header is MEASURED. Two independent readings — what is painted along the
  // top edge, and the client's mark itself — because a donor can hang its logo
  // below its bar, and the logo is the thing this defect covered.
  assert.match(html, /function headerBottom\(/);
  assert.match(html, /elementsFromPoint\(xs\[i\],3\)/);
  assert.match(html, /\[class\*="logo" i\]/);
});

test("placement happens in the same synchronous block that unhides the card", () => {
  const html = OPEN_PANEL();
  // If the card were unhidden in one task and placed in the next, there is a
  // frame in which it IS over the logo — and a proof shot is one frame.
  assert.match(html, /function open\(\)\{c\.hidden=false;placeCard\(\);/);
  // …and the thumbnail guard still precedes every path that opens it.
  assert.ok(html.indexOf("wssthumb=1") < html.indexOf("c.hidden=false"));
});

test("the card takes the tallest band clear of the client's controls, and says which it got", () => {
  const html = OPEN_PANEL();
  // A gap search over the client's own links and buttons, not a guessed offset.
  assert.match(html, /function controls\(x0,x1,y0,y1\)/);
  assert.match(html, /var MIN_BAND=200;/);
  // Two honest outcomes, distinguishable by a renderer: fully clear, or
  // header-cleared only. Silence about which one happened is how a "fix" that
  // only worked on the donor it was written against would survive.
  assert.match(html, /data-wss-placement','clear'/);
  assert.match(html, /data-wss-placement','header-only'/);
});

test("the pill searches for a clear slot instead of climbing the page", () => {
  const html = OPEN_PANEL();
  // The first attempt lifted above whatever it hit and retried, which on the
  // roofing donor at 390 walked the pill 200px up a stack of five service links
  // and parked it on the fifth. Candidates are enumerated and scored instead,
  // lowest first, and the cap bounds the travel.
  assert.match(html, /var CAP=Math\.min\(280,vh\*0\.34\);/);
  assert.match(html, /cands\.sort\(function\(a,b\)\{return b-a;\}\)/);
  assert.match(html, /bestArea<0\|\|ar<bestArea/);
  // And on a phone the pill is a chip: the second clause of the label is
  // desktop reading, so there is less of it to have to dodge with.
  assert.match(html, /<span class="wss-pill-more">/);
  assert.match(html, /@media\(max-width:760px\)\{#wss-pill \.wss-pill-more\{display:none\}\}/);
});

test("resolveSignupConfig never invents a number and never invents a code", async () => {
  const unset = await withEnv({}, () => resolveSignupConfig({ prospect: RESOLVER_PROSPECT, slug: "s" }));
  assert.equal(unset.ok, false);
  assert.equal(unset.signup, null);
  assert.equal(unset.diagnostics.riley_display, "");

  // No prospect identity => no Client ID, and the panel says so rather than
  // printing a code that resolves to nobody when it is read to Riley.
  const anonymous = await withEnv({ GHOST_AGENCY_AGENT_PHONE: "+19493395562" }, () => resolveSignupConfig({ prospect: {}, slug: "s" }));
  assert.equal(anonymous.ok, true);
  assert.equal(anonymous.signup.clientId, undefined);
  assert.ok(anonymous.warnings.includes("no_client_id"));
});
