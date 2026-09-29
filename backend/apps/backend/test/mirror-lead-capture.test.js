"use strict";

// The lead a stranger types into a mirror's quote form.
//
// BEFORE THIS CHANGE, on the shipped bundles: three donors submitted by setting
// window.location.href = "mailto:" + the client's address — nothing reached a
// server, so nothing could be counted — and the four that did post landed in an
// endpoint that stored an event, emailed US, wrote no Connect thread, and had no
// concept of the client at all. Both halves are pinned here.

const assert = require("node:assert/strict");
const test = require("node:test");
const { parse } = require("acorn");

const {
  createRateLimiter,
  leadEmails,
  leadThreadKey,
  normalizeLeadInput,
  originRouteCheck,
  resolveLeadRoute,
  slugFromHost,
} = require("../lib/mirror-lead");
const {
  LEAD_CAPTURE_SCRIPT,
  buildLeadCapture,
  resolveLeadCaptureConfig,
} = require("../lib/mirror-engine/lead-capture");
const { inject } = require("../lib/mirror-engine/content-inject");

const SLUG = "wss-test-rimrock-plumbing-billings";

// ---------------------------------------------------------------------------
// 1. WHAT COUNTS AS A LEAD
// ---------------------------------------------------------------------------

test("a lead nobody can answer is refused, and one contact channel is enough", () => {
  assert.equal(normalizeLeadInput({ slug: SLUG, name: "Dana" }).error, "need_a_phone_or_email");
  assert.equal(normalizeLeadInput({ slug: SLUG, name: "Dana", phone: "406 555 0134" }).ok, true);
  assert.equal(normalizeLeadInput({ slug: SLUG, name: "Dana", email: "dana@example.com" }).ok, true);
  // Slug is the routing key; a malformed one cannot be resolved to anybody.
  assert.equal(normalizeLeadInput({ slug: "NOT A SLUG", phone: "406 555 0134" }).error, "bad_slug");
});

test("both generations of built site are accepted by one contract", () => {
  // Four donors were already deployed posting `slug`; the injected capture
  // script sends `site`. Forking the contract would have stranded one of them.
  assert.equal(normalizeLeadInput({ site: SLUG, phone: "4065550134" }).lead.slug, SLUG);
  assert.equal(normalizeLeadInput({ slug: SLUG, phone: "4065550134" }).lead.slug, SLUG);
});

test("a filled honeypot is answered, never refused — the bot learns nothing", () => {
  const out = normalizeLeadInput({ slug: SLUG, phone: "4065550134", website: "http://spam.example" });
  assert.equal(out.ok, false);
  assert.equal(out.honeypot, true);
  assert.equal(out.status, 200);
});

test("a repeat enquiry from the same person is one thread, not two", () => {
  const a = leadThreadKey(SLUG, { email: "Dana@Example.com", phone: "(406) 555-0134" });
  const b = leadThreadKey(SLUG, { email: "dana@example.com", name: "Dana" });
  assert.equal(a, b);
  assert.equal(a, `${SLUG}:form:dana@example.com`);
});

// ---------------------------------------------------------------------------
// 2. THE RECIPIENT IS NEVER TAKEN FROM THE REQUEST
// ---------------------------------------------------------------------------

test("nothing a caller writes in the body can become a recipient", () => {
  const out = normalizeLeadInput({
    slug: SLUG,
    phone: "4065550134",
    to: "attacker@evil.example",
    deliverTo: "attacker@evil.example",
    owner_email: "attacker@evil.example",
  });
  assert.equal(out.ok, true);
  // `email` is the VISITOR's own address (a reply-to), never a destination.
  assert.deepEqual(Object.keys(out.lead).sort(), ["email", "message", "name", "page", "phone", "service", "slug"]);
  assert.equal(out.lead.email, "");
});

test("only a page on this mirror's own host may claim this slug for routing", () => {
  assert.equal(originRouteCheck({ origin: `https://${SLUG}.wss-ai.com` }, SLUG).trusted, true);
  assert.equal(originRouteCheck({ referer: `https://${SLUG}.wss-ai.com/contact` }, SLUG).trusted, true);
  // Another client's mirror must not be able to post leads into this one.
  const other = originRouteCheck({ origin: "https://wss-test-someone-else.wss-ai.com" }, SLUG);
  assert.equal(other.trusted, false);
  assert.match(other.reason, /origin_slug_mismatch/);
  assert.equal(originRouteCheck({ origin: "https://evil.example" }, SLUG).trusted, false);
  assert.equal(originRouteCheck({}, SLUG).reason, "no_origin_header");
});

test("slugFromHost only ever reads a mirror host", () => {
  assert.equal(slugFromHost(`https://${SLUG}.wss-ai.com/`), SLUG);
  assert.equal(slugFromHost("https://wss-ai.com.evil.example/"), "");
  assert.equal(slugFromHost("not a url"), "");
});

// ---------------------------------------------------------------------------
// 3. WHO THE LEAD BELONGS TO
// ---------------------------------------------------------------------------

function stubSelect(tables) {
  return async (table, query) => {
    const rows = tables[table] || [];
    return { ok: true, data: rows.filter((r) => (query.includes("site_slug=eq.") ? true : true)) };
  };
}

test("a PAID customer's lead goes to the paid customer", async () => {
  const route = await resolveLeadRoute({
    slug: SLUG,
    select: stubSelect({
      ghost_agency_dashboard_access: [
        { job_id: "job_ck_9912", owner_email: "owner@rimrockplumbing.com", business_name: "Rimrock Plumbing", site_slug: SLUG },
      ],
    }),
    env: {},
  });
  assert.equal(route.mode, "customer");
  assert.equal(route.deliverTo, "owner@rimrockplumbing.com");
  assert.equal(route.businessName, "Rimrock Plumbing");
});

test("a PROSPECT preview's lead is held, and the response names the switch that would release it", async () => {
  // lib/wss-connect-assets/magic-link.js provisions dashboard access for
  // prospects too, namespaced `prospect-`. Treating that row as a purchase is
  // how this endpoint would have cold-emailed a business that never opted in.
  const select = stubSelect({
    ghost_agency_dashboard_access: [
      { job_id: `prospect-${SLUG}`, owner_email: "office@rimrockplumbing.com", business_name: "Rimrock Plumbing", site_slug: SLUG },
    ],
    ghost_agency_prospects: [
      { prospect_id: SLUG, business_name: "Rimrock Plumbing", email: "office@rimrockplumbing.com", preview_url: `https://${SLUG}.wss-ai.com/` },
    ],
  });
  const held = await resolveLeadRoute({ slug: SLUG, select, env: {} });
  assert.equal(held.mode, "prospect_held");
  assert.equal(held.deliverTo, "", "a held lead must not be delivered to the prospect");
  assert.equal(held.heldTo, "office@rimrockplumbing.com");
  assert.match(held.heldReason, /GHOST_AGENCY_PROSPECT_SEND_ENABLED/);

  // The owner's existing live-send switch is the ONLY thing that releases it —
  // no second opinion about what "authorised" means.
  const live = await resolveLeadRoute({ slug: SLUG, select, env: { GHOST_AGENCY_PROSPECT_SEND_ENABLED: "true" } });
  assert.equal(live.mode, "prospect_live");
  assert.equal(live.deliverTo, "office@rimrockplumbing.com");
});

test("two records claiming one site are never guessed between", async () => {
  const twoPaid = await resolveLeadRoute({
    slug: SLUG,
    select: stubSelect({
      ghost_agency_dashboard_access: [
        { job_id: "job_a", owner_email: "a@example.com", site_slug: SLUG },
        { job_id: "job_b", owner_email: "b@example.com", site_slug: SLUG },
      ],
    }),
    env: {},
  });
  assert.equal(twoPaid.deliverTo, "");
  assert.equal(twoPaid.heldReason, "multiple_paid_accounts_claim_this_site");

  const twoProspects = await resolveLeadRoute({
    slug: SLUG,
    select: stubSelect({
      ghost_agency_prospects: [
        { prospect_id: "one", email: "a@example.com", preview_url: `https://${SLUG}.wss-ai.com/` },
        { prospect_id: "two", email: "b@example.com", preview_url: `https://${SLUG}.wss-ai.com/` },
      ],
    }),
    env: {},
  });
  assert.equal(twoProspects.deliverTo, "");
  assert.equal(twoProspects.heldReason, "multiple_prospects_claim_this_site");
});

test("a prospect row whose preview host is a DIFFERENT slug never routes here", async () => {
  const route = await resolveLeadRoute({
    slug: SLUG,
    select: stubSelect({
      ghost_agency_prospects: [
        { prospect_id: "other", email: "someone@example.com", preview_url: "https://wss-test-rimrock-plumbing-billings-v2.wss-ai.com/" },
      ],
    }),
    env: {},
  });
  assert.equal(route.deliverTo, "");
  assert.equal(route.heldReason, "no_client_record_for_this_slug");
});

test("a store that throws holds the lead instead of losing the routing question", async () => {
  const route = await resolveLeadRoute({
    slug: SLUG,
    select: async () => { throw new Error("supabase down"); },
    env: {},
  });
  assert.equal(route.mode, "unknown");
  assert.equal(route.deliverTo, "");
  assert.ok(route.lookup.errors.length >= 1);
});

// ---------------------------------------------------------------------------
// 4. WHAT THE TWO READERS SEE
// ---------------------------------------------------------------------------

const LEAD = { name: "Dana Kerr", phone: "(406) 555-0134", email: "dana@example.com", service: "Water heater", message: "No hot water since Sunday.", page: "/" };

test("the client copy exists only when there is a client to send it to", () => {
  const held = leadEmails({ slug: SLUG, lead: LEAD, route: { mode: "prospect_held", deliverTo: "", heldTo: "office@rimrockplumbing.com", heldReason: "owner_locked:GHOST_AGENCY_PROSPECT_SEND_ENABLED", businessName: "Rimrock Plumbing", clientId: "WSS-7A3980" } });
  assert.equal(held.client, null);
  // The owner must be able to act on a held lead within the hour, so the copy
  // carries the lead in full AND the address it did not go to.
  assert.match(held.owner.text, /Dana Kerr/);
  assert.match(held.owner.text, /No hot water since Sunday/);
  assert.match(held.owner.text, /NOT forwarded/);
  assert.match(held.owner.text, /office@rimrockplumbing\.com/);
  assert.equal(held.owner.replyTo, "dana@example.com");

  const sent = leadEmails({ slug: SLUG, lead: LEAD, route: { mode: "customer", deliverTo: "owner@rimrockplumbing.com", businessName: "Rimrock Plumbing" } });
  assert.equal(sent.client.to, "owner@rimrockplumbing.com");
  assert.equal(sent.client.replyTo, "dana@example.com");
  assert.match(sent.client.text, /No hot water since Sunday/);
  // The client's copy is about their customer. It says nothing about us.
  assert.doesNotMatch(sent.client.html, /WSS|prospect|mirror/i);
});

test("a lead's own words cannot inject markup into either copy", () => {
  const nasty = { ...LEAD, name: '<img src=x onerror="alert(1)">', message: "</table><script>bad()</script>" };
  const out = leadEmails({ slug: SLUG, lead: nasty, route: { mode: "customer", deliverTo: "owner@example.com", businessName: "R" } });
  assert.doesNotMatch(out.client.html, /<img|<script/);
  assert.doesNotMatch(out.owner.html, /<img|<script/);
  assert.match(out.client.html, /&lt;img/);
});

// ---------------------------------------------------------------------------
// 5. THE PUBLIC-ENDPOINT GUARD
// ---------------------------------------------------------------------------

test("the burst guard trips on the ninth post in a minute and forgets after it", () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 8, now: () => clock });
  for (let i = 0; i < 8; i += 1) assert.equal(limiter.hit("1.2.3.4"), false, `hit ${i + 1} should pass`);
  assert.equal(limiter.hit("1.2.3.4"), true);
  // A different visitor is unaffected by the noisy one.
  assert.equal(limiter.hit("5.6.7.8"), false);
  clock += 61_000;
  assert.equal(limiter.hit("1.2.3.4"), false);
});

// ---------------------------------------------------------------------------
// 6. THE BROWSER HALF
// ---------------------------------------------------------------------------

test("the capture script is valid JavaScript and cannot break out of its own tag", () => {
  assert.doesNotThrow(() => parse(LEAD_CAPTURE_SCRIPT, { ecmaVersion: 2020 }));
  assert.equal(LEAD_CAPTURE_SCRIPT.includes("</script"), false);
});

test("the capture gets in front of the donor's own handler, and falls back to the mailto: it replaced", () => {
  // React 18 delegates onSubmit to its root container, a descendant of
  // document — so a capture-phase listener HERE runs first, and stopPropagation
  // is what stops the donor's `location.href = "mailto:…"` from ever firing.
  assert.match(LEAD_CAPTURE_SCRIPT, /addEventListener\('submit'[\s\S]*?,true\)/);
  assert.match(LEAD_CAPTURE_SCRIPT, /ev\.preventDefault\(\);ev\.stopPropagation\(\)/);
  // A client must never lose a lead because our endpoint 500s.
  assert.match(LEAD_CAPTURE_SCRIPT, /mailto:/);
  assert.match(LEAD_CAPTURE_SCRIPT, /\.catch\(function\(\)\{[\s\S]*?failed\(form,f\)/);
  // And a proof shot is a picture of the client's site, never of our plumbing.
  assert.match(LEAD_CAPTURE_SCRIPT, /wssthumb=1/);
});

test("a form with no way to reach anybody back is left alone entirely", () => {
  // The search box and the newsletter field must keep working. The same test
  // doubles as "is this lead answerable" — an unanswerable one is not captured.
  assert.match(LEAD_CAPTURE_SCRIPT, /if\(!f\.phone&&!f\.email\)return;/);
  assert.match(LEAD_CAPTURE_SCRIPT, /role'\)\|\|''\)\.toLowerCase\(\)==='search'/);
});

test("a VISIBLE website field is a real question, not a honeypot", () => {
  // Answering 200 and dropping the lead because a client's form asks "your
  // website?" would be the exact silent loss this endpoint exists to remove.
  assert.match(LEAD_CAPTURE_SCRIPT, /honey\|hp_\/\.test\(k\)&&!vis\(el\)/);
});

test("the honeypot test matches how the donors actually hide theirs", () => {
  // The concrete donor parks its `website` input inside aria-hidden +
  // "absolute left-[-9999px] h-0 w-0 overflow-hidden" with tabIndex -1. That
  // field still reports display:block and a non-zero rect, so a style-only
  // check called it visible and a bot's fill sailed past the trap — measured in
  // the browser on donors-clean/concrete-elconstruction, not assumed.
  assert.match(LEAD_CAPTURE_SCRIPT, /getAttribute\('tabindex'\)==='-1'/);
  assert.match(LEAD_CAPTURE_SCRIPT, /closest\('\[aria-hidden="true"\]'\)/);
  assert.match(LEAD_CAPTURE_SCRIPT, /r\.right<=0\|\|r\.bottom<=0/);
});

test("the capture refuses to install when there is no slug to route a lead to", () => {
  const none = resolveLeadCaptureConfig({ facts: { email: "a@b.com" }, slug: "" });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "no_site_slug_to_route_leads_to");
  assert.equal(buildLeadCapture(none.config), "");
});

test("the fallback address is the client's own verified email, never invented", () => {
  const withEmail = resolveLeadCaptureConfig({ facts: { business_name: "Rimrock Plumbing", email: "office@rimrockplumbing.com", phone: "+14065550134" }, slug: SLUG });
  assert.equal(withEmail.config.email, "office@rimrockplumbing.com");
  assert.match(withEmail.config.confirm, /Rimrock Plumbing/);

  // No verified email is a legitimate answer. The script then falls back to the
  // phone rather than to a mailto: nobody can receive.
  const noEmail = resolveLeadCaptureConfig({ facts: { business_name: "Rimrock Plumbing", phone: "(406) 555-0134" }, slug: SLUG });
  assert.equal(noEmail.ok, true);
  assert.equal(noEmail.config.email, "");
  assert.equal(noEmail.config.phone, "(406) 555-0134");
});

// ---------------------------------------------------------------------------
// IDENTITY TRUST MODE (owner directive 2026-08-31): the site's scraped email
// routes the new site's contact form. These are the exact facts shapes the
// trust-mode miner emits (see places-optional-mining.test.js /
// operator-line-google-discovery.test.js): a site-truth row carries the email
// the business published on its own homepage, plus the phone the site itself
// carries when the email is absent. NEVER a dummy address — an empty email
// with a phone fallback is the honest configuration.
// ---------------------------------------------------------------------------
test("a trust-mode row's scraped email routes the form; absent email falls back to the site's phone", () => {
  // The no-GBP, no-schema row: email scraped from the homepage mailto:, phone
  // scraped from the tel: link — both fields the site itself published.
  const scrapedEmail = resolveLeadCaptureConfig({
    facts: {
      business_name: "No Address Plumbing Co",
      industry: "plumbing",
      city: "Louisville",
      state: "KY",
      email: "noaddressplumbing@gmail.com",
      phone: "+15025550177",
    },
    slug: SLUG,
  });
  assert.equal(scrapedEmail.ok, true);
  assert.equal(scrapedEmail.config.email, "noaddressplumbing@gmail.com");
  assert.equal(scrapedEmail.config.phone, "+15025550177");
  assert.equal(scrapedEmail.config.endpoint, "https://ghost.wss-ai.com/api/quote-request");

  // The same row with no email published: the form falls back to the phone
  // and NEVER to an invented address.
  const phoneOnly = resolveLeadCaptureConfig({
    facts: {
      business_name: "No Address Plumbing Co",
      industry: "plumbing",
      city: "Louisville",
      state: "KY",
      phone: "+15025550177",
    },
    slug: SLUG,
  });
  assert.equal(phoneOnly.ok, true);
  assert.equal(phoneOnly.config.email, "");
  assert.equal(phoneOnly.config.phone, "+15025550177");
  assert.doesNotMatch(JSON.stringify(phoneOnly.config), /@/,
    "no dummy address may appear anywhere in the stamped form config");

  // And the built bytes agree with the config: the stamped wss-lead-config
  // (the JSON contract the rendered form reads) carries the same routing.
  const built = buildLeadCapture(scrapedEmail.config);
  assert.match(built, /"email":"noaddressplumbing@gmail\.com"/);
  assert.match(built, /"slug":"wss-test-rimrock-plumbing-billings"/);
});

// ---------------------------------------------------------------------------
// 7. IT REACHES THE EMITTED BYTES
// ---------------------------------------------------------------------------

const FACTS = { business_name: "Rimrock Plumbing", industry: "plumbing", city: "Billings", state: "MT", email: "office@rimrockplumbing.com", phone: "+14065550134" };

test("every page of the built mirror carries the capture, and the report counts the bytes", () => {
  const out = inject({
    files: {
      "index.html": Buffer.from("<html><body><div id=\"root\"></div></body></html>", "utf8"),
      "about.html": Buffer.from("<html><body><main>about</main></body></html>", "utf8"),
    },
    content: { services: [{ name: "Drain cleaning" }] },
    facts: FACTS,
    slug: SLUG,
  });
  assert.equal(out.report.lead_capture.present, true);
  assert.equal(out.report.lead_capture.pages, 2, "a footer quote form on /about loses leads the same way");
  assert.equal(out.report.lead_capture.fallback, "mailto");
  assert.ok(out.report.lead_capture.bytes > 500);

  for (const rel of ["index.html", "about.html"]) {
    const html = out.files[rel].toString("utf8");
    assert.match(html, /id="wss-lead-config"/, `${rel} carries the stamped route`);
    assert.match(html, /window\.__WSS_LEAD__/, `${rel} reads it back`);
    assert.match(html, /ghost\.wss-ai\.com\/api\/quote-request/, `${rel} posts server-side`);
    assert.ok(html.includes(`"slug":"${SLUG}"`), `${rel} is stamped with its own slug`);
    assert.ok(html.includes("office@rimrockplumbing.com"), `${rel} carries the mailto: fallback address`);
  }
});

test("the stamped config cannot close the script tag it lives in", () => {
  const out = inject({
    files: { "index.html": Buffer.from("<html><body></body></html>", "utf8") },
    content: { services: [{ name: "x" }] },
    facts: { ...FACTS, business_name: "</script><script>evil()</script>" },
    slug: SLUG,
  });
  const html = out.files["index.html"].toString("utf8");
  assert.equal(html.includes("</script><script>evil()"), false);
  assert.ok(html.includes("\\u003c/script"));
});
