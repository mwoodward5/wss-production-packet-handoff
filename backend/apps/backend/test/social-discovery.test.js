"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sd = require("../lib/mirror-engine/social-discovery");
const { buildSocialBar } = require("../lib/mirror-engine/content-inject");
const { CircuitBreaker } = require("../lib/discovery-health");
const { demandRank, REVIEW_FLOOR, discoveryStartPage, searchPlaces, scorePlace } = require("../lib/lead-miner");

// ---------------------------------------------------------------------------
// classifyProfileUrl — a profile is an IDENTITY, not any URL on the host.
// ---------------------------------------------------------------------------

test("a real profile URL on each network classifies with a canonical form", () => {
  const cases = [
    ["https://www.facebook.com/CartersMyPlumber", "facebook", "CartersMyPlumber"],
    ["https://instagram.com/cartersmyplumber/", "instagram", "cartersmyplumber"],
    ["https://www.youtube.com/@CartersMyPlumber", "youtube", "CartersMyPlumber"],
    ["https://www.linkedin.com/company/carters-my-plumber", "linkedin", "carters-my-plumber"],
    ["https://www.yelp.com/biz/carters-my-plumber-indianapolis", "yelp", "carters-my-plumber-indianapolis"],
    ["https://www.tiktok.com/@cartersmyplumber", "tiktok", "cartersmyplumber"],
    ["https://nextdoor.com/pages/carters-my-plumber", "nextdoor", "carters-my-plumber"],
  ];
  for (const [url, network, handle] of cases) {
    const hit = sd.classifyProfileUrl(url);
    assert.ok(hit, `expected ${url} to classify`);
    assert.equal(hit.network, network);
    assert.equal(hit.handle, handle);
    assert.match(hit.url, /^https:\/\//);
  }
});

test("share widgets, login walls and platform chrome are never a profile", () => {
  const notProfiles = [
    "https://www.facebook.com/sharer.php?u=https://example.com",
    "https://www.facebook.com/sharer/sharer.php",
    "https://www.facebook.com/tr?id=123&ev=PageView",
    "https://www.facebook.com/login",
    "https://www.instagram.com/explore/tags/plumbing/",
    "https://www.instagram.com/accounts/login/",
    "https://www.youtube.com/watch?v=abc123",
    "https://www.youtube.com/results?search_query=plumber",
    "https://www.linkedin.com/shareArticle?mini=true",
    "https://twitter.com/intent/tweet?text=hi",
    "https://www.yelp.com/search?find_desc=plumber",
  ];
  for (const url of notProfiles) {
    assert.equal(sd.classifyProfileUrl(url), null, `${url} must not classify as an owned profile`);
  }
});

test("somebody else's POST is not the client's account, even on the right network", () => {
  // The single most tempting false positive: a photo of the client's van on a
  // customer's Instagram. It names them and it is on instagram.com; it is not
  // their account and must never be linked as one.
  assert.equal(sd.classifyProfileUrl("https://www.instagram.com/p/CxYz123/"), null);
  assert.equal(sd.classifyProfileUrl("https://www.instagram.com/reel/CxYz123/"), null);
});

test("a non-network URL classifies as nothing at all", () => {
  assert.equal(sd.classifyProfileUrl("https://cartersmyplumber.com/about"), null);
  assert.equal(sd.classifyProfileUrl("javascript:alert(1)"), null);
  assert.equal(sd.classifyProfileUrl(""), null);
  assert.equal(sd.classifyProfileUrl(null), null);
});

// ---------------------------------------------------------------------------
// Ownership — the rule the whole feature stands on.
// ---------------------------------------------------------------------------

test("a link in their own footer is ownership, and needs no further proof", async () => {
  const html = `<html><body><footer>
    <a href="https://www.facebook.com/CartersMyPlumber">Facebook</a>
    <a href="/instagram">not a social link</a>
    <a href="https://www.yelp.com/biz/carters-my-plumber-indianapolis">Yelp</a>
    <a href="https://www.facebook.com/sharer.php?u=x">Share</a>
  </footer></body></html>`;
  const found = sd.profilesFromOwnSite(html, "https://cartersmyplumber.com/");
  assert.deepEqual(found.map((p) => p.network).sort(), ["facebook", "yelp"]);
  assert.ok(found.every((p) => p.provenance === "own_site_link"));
});

test("distinctive tokens drop the trade and the legal wrapper, which everyone shares", () => {
  assert.deepEqual(sd.distinctiveTokens("Carter's My Plumber Plumbing Services LLC"), ["carter", "s", "my"].filter((t) => t.length > 1));
  // "Miller" is what makes Miller Plumbing Inc. itself; "plumbing" and "inc" are not.
  assert.deepEqual(sd.distinctiveTokens("Miller Plumbing Inc."), ["miller"]);
});

test("EVERY distinctive token must be present — a partial match is how you adopt a stranger", () => {
  // The exact failure this rule exists to stop: Miller Plumbing reduces to
  // ["miller"], "millerroofing" contains "miller", and there is no honest way
  // to tell them apart from the name. So a one-token business gets NO search
  // match at all — it can only ever attach a profile it linked itself.
  assert.equal(sd.nameMatchesBusiness("Miller Plumbing Inc", { handle: "millerroofing", title: "Miller Roofing" }), false);
  assert.equal(sd.nameMatchesBusiness("Miller Plumbing Inc", { handle: "millerplumbing", title: "Miller Plumbing" }), false,
    "even the CORRECT page is refused, because we cannot prove it is the correct one");
  // With two distinctive tokens the test bites properly.
  assert.equal(sd.nameMatchesBusiness("Rimrock Valley Plumbing", { handle: "rimrockplumbing", title: "Rimrock Plumbing" }), false);
  assert.equal(sd.nameMatchesBusiness("Rimrock Valley Plumbing", { handle: "rimrockvalleyplumbing", title: "" }), true);
});

test("a directory blurb that merely MENTIONS the business is not a claim to be it", () => {
  // The description is deliberately outside the haystack: "...compare Rimrock
  // Valley Plumbing with 12 nearby pros..." names them and is not their page.
  assert.equal(
    sd.nameMatchesBusiness("Rimrock Valley Plumbing", {
      handle: "billings-plumbers",
      title: "Best Plumbers in Billings MT",
      description: "Compare Rimrock Valley Plumbing and 12 nearby pros",
    }),
    false,
  );
});

test("discoverSocials refuses a search hit whose name does not match, and SAYS SO", async () => {
  const search = async () => ({
    ok: true,
    results: [
      { url: "https://www.facebook.com/IndyPlumbingPros", title: "Indy Plumbing Pros" },
      { url: "https://www.instagram.com/rimrockvalleyplumbing/", title: "Rimrock Valley Plumbing" },
    ],
  });
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing", siteUrl: "https://rimrockvalley.com/", html: "", search });
  assert.deepEqual(out.profiles.map((p) => p.network), ["instagram"]);
  assert.equal(out.profiles[0].provenance, "named_match");
  assert.equal(out.searchCalls, 1);
  assert.equal(out.refused.length, 1);
  assert.equal(out.refused[0].network, "facebook");
  assert.equal(out.refused[0].reason, "name_not_unambiguous");
});

test("own-site links outrank search results for the same network", async () => {
  const html = `<a href="https://www.facebook.com/TheRealPage">fb</a>`;
  const search = async () => ({ ok: true, results: [{ url: "https://www.facebook.com/rimrockvalleyplumbing", title: "Rimrock Valley Plumbing" }] });
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing", siteUrl: "https://rimrockvalley.com/", html, search });
  const fb = out.profiles.find((p) => p.network === "facebook");
  assert.equal(fb.provenance, "own_site_link");
  assert.match(fb.url, /TheRealPage/);
});

test("a search failure is silence, not a thrown build", async () => {
  const search = async () => { throw new Error("firecrawl 502"); };
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing", siteUrl: "https://rimrockvalley.com/", html: "", search });
  assert.deepEqual(out.profiles, []);
  assert.equal(out.searchCalls, 1);
});

test("no site, no html, no search: zero profiles and no invention", async () => {
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing" });
  assert.deepEqual(out.profiles, []);
  assert.equal(out.searchCalls, 0);
});

// ---------------------------------------------------------------------------
// The rendered bar.
// ---------------------------------------------------------------------------

test("the social bar renders one linked, recognisable mark per owned profile", () => {
  const html = buildSocialBar({
    facts: {
      business_name: "Rimrock Valley Plumbing",
      socials: [
        { network: "facebook", url: "https://www.facebook.com/rimrockvalleyplumbing", label: "Facebook", handle: "rimrockvalleyplumbing" },
        { network: "yelp", url: "https://www.yelp.com/biz/rimrock-valley-plumbing-billings", label: "Yelp" },
      ],
    },
  });
  assert.match(html, /Find Rimrock Valley Plumbing online/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/rimrockvalleyplumbing"/);
  assert.match(html, /href="https:\/\/www\.yelp\.com\/biz\/rimrock-valley-plumbing-billings"/);
  assert.match(html, /#1877F2/, "the Facebook mark carries its own brand colour");
  assert.match(html, /rel="noopener noreferrer me"/);
  assert.equal((html.match(/wss-s__chip/g) || []).length, 2);
});

test("ABSENT COLLAPSES SILENTLY — no profiles means no bar, not an empty one", () => {
  assert.equal(buildSocialBar({ facts: { business_name: "X" } }), "");
  assert.equal(buildSocialBar({ facts: { business_name: "X", socials: [] } }), "");
  // ...and never a placeholder invitation to an account that does not exist.
  const html = buildSocialBar({ facts: { business_name: "X", socials: [{ network: "facebook" }] } });
  assert.equal(html, "");
});

test("an http:// or unknown-network entry is dropped rather than rendered", () => {
  const html = buildSocialBar({
    facts: {
      business_name: "X",
      socials: [
        { network: "facebook", url: "http://www.facebook.com/x" },
        { network: "myspace", url: "https://myspace.com/x" },
        { network: "yelp", url: "https://www.yelp.com/biz/x" },
      ],
    },
  });
  assert.equal((html.match(/wss-s__chip/g) || []).length, 1);
  assert.match(html, /yelp\.com/);
});

test("a duplicate network renders once", () => {
  const html = buildSocialBar({
    facts: {
      business_name: "X",
      socials: [
        { network: "facebook", url: "https://www.facebook.com/a" },
        { network: "facebook", url: "https://www.facebook.com/b" },
      ],
    },
  });
  assert.equal((html.match(/wss-s__chip/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// The review floor: a ranker, never a gate.
// ---------------------------------------------------------------------------

test("the review floor is forty, and above it is the top band", () => {
  assert.equal(REVIEW_FLOOR, 40);
  assert.equal(demandRank(140, 4.8).band, "proven_demand");
  assert.equal(demandRank(41, 3.2).band, "above_floor");
  assert.equal(demandRank(12, 4.9).band, "below_floor");
});

test("a business UNDER the floor is ranked lower and never refused", () => {
  const thin = demandRank(12, 4.9);
  const proven = demandRank(140, 4.8);
  assert.ok(proven.rank > thin.rank);
  assert.equal(thin.meetsFloor, false);
  // The owner's rule made mechanical: there is no refusal to express here.
  assert.ok(!("refused" in thin) && !("ok" in thin));
  // ...and it still scores as a minable lead.
  assert.ok(scorePlace({ userRatingCount: 12, rating: 4.9, nationalPhoneNumber: "x" }, "a@b.com") > 1);
});

test("UNMEASURED is not zero — an uncounted business outranks a measured-thin one", () => {
  assert.equal(demandRank(null, null).band, "unmeasured");
  assert.ok(demandRank(null, null).rank > demandRank(3, 5).rank);
});

test("scoring now REWARDS proven demand instead of obscurity", () => {
  const proven = scorePlace({ userRatingCount: 140, rating: 4.7, nationalPhoneNumber: "x", formattedAddress: "y" }, "a@b.com");
  const quiet = scorePlace({ userRatingCount: 4, rating: 4.7, nationalPhoneNumber: "x", formattedAddress: "y" }, "a@b.com");
  assert.ok(proven > quiet, "a 140-review trader must outrank a 4-review one");
});

// ---------------------------------------------------------------------------
// Deep pagination.
// ---------------------------------------------------------------------------

test("deep pagination is OFF by default — it costs money per run", () => {
  assert.equal(discoveryStartPage({}), 0);
  assert.equal(discoveryStartPage({ GHOST_AGENCY_MINER_START_PAGE: "4" }), 4);
  assert.equal(discoveryStartPage({ GHOST_AGENCY_MINER_START_PAGE: "banana" }), 0);
  // 99 CLAMPS to the ceiling rather than billing 99 discarded pages. A typo in
  // an env var must not be able to spend a hundred Places calls per query.
  assert.equal(discoveryStartPage({ GHOST_AGENCY_MINER_START_PAGE: "99" }), 8);
});

test("startPage discards the early pages and reports what it paid to skip", async () => {
  const pages = [
    ["page1-a", "page1-b"], ["page2-a"], ["page3-a"], ["page4-a"], ["deep-a", "deep-b"],
  ];
  let i = 0;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({
      places: pages[i].map((id) => ({ id })),
      nextPageToken: ++i < pages.length ? `t${i}` : undefined,
    }),
    headers: new Map(),
  });
  const out = await searchPlaces({ key: "k", textQuery: "plumbers in Indianapolis IN", limit: 20, startPage: 4, fetchImpl, breaker: new CircuitBreaker() });
  assert.equal(out.ok, true);
  assert.deepEqual(out.places.map((p) => p.id), ["deep-a", "deep-b"], "only the deep page survives");
  assert.equal(out.pagesSkipped, 4, "four billed pages were thrown away, and it says so");
  assert.equal(out.startPage, 4);
  assert.ok(out.httpCalls >= 5, "the ledger counts the skipped pages as real spend");
});

test("a thin market that runs out of pages yields less, not page-one businesses", async () => {
  let i = 0;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ places: [{ id: `p${i}` }], nextPageToken: ++i < 2 ? "t" : undefined }),
    headers: new Map(),
  });
  const out = await searchPlaces({ key: "k", textQuery: "plumbers in Nowhere MT", limit: 20, startPage: 4, fetchImpl, breaker: new CircuitBreaker() });
  assert.equal(out.ok, true);
  assert.deepEqual(out.places, [], "no page five means no leads, NOT a silent fallback to page one");
});

test("a keyword-stuffed GBP name matches on its NAME, not on its SEO tail", () => {
  // Measured on the live Carter's mirror: the full GBP string is
  // "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair", and
  // requiring every one of those tokens refused the business's own Facebook,
  // LinkedIn, Yelp and BBB pages. The name is what comes before the dash.
  const full = "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair";
  assert.equal(sd.coreName(full), "Carter's My Plumber");
  assert.equal(sd.nameMatchesBusiness(full, { handle: "CartersMyPlumber", title: "Carter's My Plumber" }), true);
  // And it is still a real test: a different Indianapolis plumber is refused.
  assert.equal(sd.nameMatchesBusiness(full, { handle: "IndyPlumbingPros", title: "Indy Plumbing Pros" }), false);
});

test("a name with no separator, or a stub before one, keeps the whole string", () => {
  assert.equal(sd.coreName("Rimrock Valley Plumbing"), "Rimrock Valley Plumbing");
  // "ABC - Plumbing and Drain of Billings": the head is one token, so trimming
  // to it would weaken the test. The full string stays.
  assert.equal(sd.coreName("ABC - Plumbing and Drain of Billings"), "ABC - Plumbing and Drain of Billings");
});

test("a BBB handle is the BUSINESS slug, not the trade segment before it", () => {
  // /profile/plumber/... — reading the segment after "profile" gave "plumber",
  // a handle that matches every plumber in America. Observed on the live
  // Carter's build before the fix.
  const hit = sd.classifyProfileUrl("https://www.bbb.org/us/in/indianapolis/profile/plumber/carters-my-plumber-0382-90036102");
  assert.equal(hit.network, "bbb");
  assert.equal(hit.handle, "carters-my-plumber");
  assert.equal(sd.nameMatchesBusiness("Carter's My Plumber", { handle: hit.handle, title: "" }), true);
  // A different plumber's BBB page no longer slips through on the trade word.
  const other = sd.classifyProfileUrl("https://www.bbb.org/us/in/indianapolis/profile/plumber/indy-drain-pros-0382-90099999");
  assert.equal(sd.nameMatchesBusiness("Carter's My Plumber", { handle: other.handle, title: "Indy Drain Pros" }), false);
});

test("the bar heads with the NAME, and the shared hoist lifts #trust, #reviews then #social under the hero", () => {
  // THE CONTRACT MOVED AGAIN (2026-08-12 audit): the hoist is HOIST_UNDER_HERO_JS,
  // one script that chains #trust, THEN the #reviews carousel, THEN #social
  // directly under the hero, in that order. The trust strip was buried at
  // y≈8,095 while only the social bar was lifted; the same audit then asked for
  // the review carousel with faces above the fold, so #reviews joins the lift
  // between the strip and the social bar. The bar itself is pure markup now.
  const html = buildSocialBar({
    facts: {
      business_name: "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair",
      socials: [{ network: "facebook", url: "https://www.facebook.com/CartersMyPlumber" }],
    },
  });
  assert.match(html, /Find Carter&#39;s My Plumber online/, "and the apostrophe is HTML-escaped, not raw");
  assert.doesNotMatch(html, /Water Heater Repair/);
  assert.doesNotMatch(html, /<script>/, "the bar is markup only; the hoist is shared");

  // The shared hoist really ships, targets both ids in trust-first order, and
  // its body carries NO raw "</" — one would terminate the host <script>
  // early and take the rest of the page down with it.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "content-inject.js"), "utf8");
  assert.match(src, /HOIST_UNDER_HERO_JS/);
  const hoist = /const HOIST_UNDER_HERO_JS = `([\s\S]*?)`;/.exec(src);
  assert.ok(hoist, "the hoist constant must exist");
  // The trust surface added a #wss-team identity block (their real face); it
  // rides between the strip and the review carousel so a person is above the
  // fold. Order: trust strip, team face, review carousel, then the social bar.
  assert.match(hoist[1], /\["trust","wss-team","reviews","social"\]/, "trust, team face, review carousel, then social");
  const body = hoist[1].slice(hoist[1].indexOf("<script>") + 8, hoist[1].lastIndexOf("<\\/script>"));
  assert.equal(body.includes("</"), false, "the script body must not contain a raw closing-tag sequence");
  assert.match(src, /\$\{HOIST_UNDER_HERO_JS\}/, "and the injected wrapper actually includes it");
});

// ---------------------------------------------------------------------------
// THE CHIPS THAT SENT PROSPECTS TO THEIR COMPETITORS.
//
// Every URL below was measured on a LIVE mirror on 2026-08-07, under the
// business it was published for. None of these are hypotheticals: they were on
// the internet under the client's own banner while the previous check reported
// the social bar as healthy — because it counted chips instead of following
// them anywhere.
// ---------------------------------------------------------------------------

test("an Angi CATEGORY page is not a profile — this one listed the client's competitors", () => {
  // Live on wss-test-plumbers-green-bay-green-bay: an "Angi" chip opening
  // "Top 10 Best Plumbers in Green Bay, WI". The business is called Plumbers
  // Green Bay, so its distinctive tokens are [green, bay] — and the ranked list
  // of his rivals contains both of them, in the title, which was the whole test.
  assert.equal(sd.classifyProfileUrl("https://www.angi.com/companylist/us/wi/green-bay/plumbing.htm"), null);
  assert.equal(sd.classifyProfileUrl("https://www.bbb.org/us/wi/green-bay/category/plumber"), null);
  // ...and the real listing beside it still classifies. A gate that refuses the
  // category page AND the profile has not fixed anything.
  const real = sd.classifyProfileUrl("https://www.angi.com/companylist/us/mo/kansas-city/poor-john%27s-plumbing-reviews-271264.htm");
  assert.equal(real.network, "angi");
  assert.equal(real.handle, "poor-john's-plumbing");
  // Professional Piping's genuine Angi listing id is a single digit.
  assert.equal(sd.classifyProfileUrl("https://www.angi.com/companylist/us/wa/spokane/professional-piping-inc-reviews-1.htm").network, "angi");
});

test("the title of a ranked list can no longer carry a chip, even when it names the client", () => {
  const seen = sd.readAttestation("<title>Top 10 Best Plumbers in Green Bay, WI</title>");
  assert.equal(seen.isIndex, true);
  const v = sd.judgeProfile({
    candidate: { network: "angi", handle: "plumbing", url: "https://www.angi.com/companylist/us/wi/green-bay/plumbing.htm", provenance: "named_match" },
    businessName: "Plumbers Green Bay",
    home: { city: "Green Bay", state: "WI" },
    fetched: { ok: true, status: 200, html: "<title>Top 10 Best Plumbers in Green Bay, WI</title>" },
  });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "directory_index_page");
});

test("a BBB tab is never the handle, and a chip never opens the client's COMPLAINTS", () => {
  // Rescue Rooter's live BBB chip ended in /customer-reviews, so the matched
  // handle was literally "customer-reviews" and the title waved it through.
  const hit = sd.classifyProfileUrl("https://www.bbb.org/us/tn/memphis/profile/heating-and-air-conditioning/arsrescue-rooter-0543-44016274/customer-reviews");
  assert.equal(hit.handle, "arsrescue-rooter");
  assert.equal(hit.url, "https://www.bbb.org/us/tn/memphis/profile/heating-and-air-conditioning/arsrescue-rooter-0543-44016274");
  // Mainstream Electric's live chip pointed at its own complaints tab.
  const mainstream = sd.classifyProfileUrl("https://www.bbb.org/us/wa/spokane-valley/profile/electrician/mainstream-electric-heating-cooling-and-plumbing-1296-22000343/complaints");
  assert.doesNotMatch(mainstream.url, /complaints/);
});

test("a franchise's listing in another STATE is not this branch — Yelp Austin, BBB Memphis", () => {
  // wss-test-rescue-rooter-portland shipped both. "Rescue Rooter" is the name of
  // the Portland business AND the Austin one AND the Memphis one, so no name
  // test can separate them. Only geography can.
  const bbb = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.bbb.org/us/tn/memphis/profile/heating-and-air-conditioning/arsrescue-rooter-0543-44016274"), provenance: "named_match" },
    businessName: "Rescue Rooter",
    home: { city: "Portland", state: "OR" },
    fetched: { ok: false, status: 403, html: "" },
  });
  assert.equal(bbb.ok, false);
  assert.equal(bbb.reason, "locality_contradiction");
  assert.match(bbb.evidence, /TN/);

  // Yelp does not put the state in the path, so the proof is pooled from every
  // search row pointing at the same listing — one of them carried the address.
  const yelp = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.yelp.com/biz/ars-rescue-rooter-austin-5"), provenance: "named_match" },
    businessName: "Rescue Rooter",
    home: { city: "Portland", state: "OR" },
    rowStates: new Set(["TX"]),
    fetched: { ok: false, status: 403, html: "" },
  });
  assert.equal(yelp.ok, false);
  assert.equal(yelp.reason, "locality_contradiction");
});

test("a NEIGHBOURING state is a metro, not a contradiction", () => {
  // D&F Plumbing trades in Portland OR; BBB files it in Vancouver WA, ten
  // minutes away across the river. A bare state-mismatch rule deletes that real
  // chip, so the test is adjacency, not equality.
  assert.equal(sd.statesConflict("OR", "WA"), false);
  assert.equal(sd.statesConflict("OR", "OR"), false);
  assert.equal(sd.statesConflict("OR", "TN"), true);
  assert.equal(sd.statesConflict("OR", "TX"), true);
  // An unknown home state can never contradict anything.
  assert.equal(sd.statesConflict("", "TX"), false);
  const v = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.bbb.org/us/wa/vancouver/profile/plumber/d-f-plumbing-co-1296-61000874"), provenance: "own_site_link" },
    businessName: "D&F Plumbing, Heating and Cooling",
    home: { city: "Portland", state: "OR" },
    fetched: { ok: false, status: 403, html: "" },
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "own_site_link", "reaching this verdict at all proves the locality test did not fire");
});

test("a LinkedIn MEMBER page is a private individual's — even when the owner links it himself", () => {
  // Two live mirrors published one. Poor John's shipped an employee's profile;
  // Platero Parada shipped the owner's own, out of its OWN footer. The employer
  // is named in every LinkedIn person title, which is exactly why a title test
  // could never catch this.
  const terri = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.linkedin.com/in/terri-welker-64822a20"), provenance: "named_match" },
    businessName: "Poor John's Plumbing",
    home: { city: "Parkville", state: "MO" },
    fetched: { ok: false, status: 999, html: "" },
  });
  assert.equal(terri.ok, false);
  assert.equal(terri.reason, "personal_profile");

  const samuel = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.linkedin.com/in/samuel-platero-300178307"), provenance: "own_site_link" },
    businessName: "Platero Parada Plumbing",
    home: { city: "Sacramento", state: "CA" },
    fetched: { ok: false, status: 999, html: "" },
  });
  assert.equal(samuel.ok, false, "self-assertion does not make the owner's private page a company profile");

  // The COMPANY page for the same business is untouched — the fix replaces the
  // private page with the real one rather than emptying the network.
  const company = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.linkedin.com/company/platero-parada-plumbing"), provenance: "named_match" },
    businessName: "Platero Parada Plumbing",
    home: { city: "Sacramento", state: "CA" },
    fetched: { ok: true, status: 200, html: '<meta property="og:title" content="Platero Parada Plumbing | LinkedIn">' },
  });
  assert.equal(company.ok, true);
  assert.equal(company.reason, "destination_attested");
});

test("a member page whose slug IS the business name survives", () => {
  // America's Plumbing Company links linkedin.com/in/americasplumbingco from its
  // own site. The slug is the company, truncated — and could be nobody else.
  assert.equal(sd.handleEncodesBusiness("America's Plumbing Company", "americasplumbingco"), true);
  assert.equal(sd.handleEncodesBusiness("Poor John's Plumbing", "terri-welker-64822a20"), false);
  assert.equal(sd.handleEncodesBusiness("Platero Parada Plumbing", "samuel-platero-300178307"), false);
});

test("FOLLOWING THE LINK beats reading the slug — in BOTH directions", () => {
  // Nextdoor served nextdoor.com/pages/samuel-platero-san-jose-ca, which reads
  // like a stranger in the wrong city. The page itself says otherwise, and the
  // page is the truth: a slug-shape rule would have deleted a good chip.
  const good = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://nextdoor.com/pages/samuel-platero-san-jose-ca/"), provenance: "own_site_link" },
    businessName: "Platero Parada Plumbing",
    home: { city: "Sacramento", state: "CA" },
    fetched: { ok: true, status: 200, html: '<meta property="og:title" content="Platero Parada Plumbing LLC - Sacramento, CA - Nextdoor">' },
  });
  assert.equal(good.ok, true);
  assert.equal(good.reason, "destination_attested");

  // And the reverse: an opaque YouTube channel id proves nothing by itself and
  // is carried entirely by what the destination says it is.
  const yt = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.youtube.com/channel/UCDoJnM4wYkqxUWK3KoYPfkw"), provenance: "named_match" },
    businessName: "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair",
    home: { city: "Indianapolis", state: "IN" },
    fetched: { ok: true, status: 200, html: '<meta property="og:title" content="Carter&#39;s My Plumber">' },
  });
  assert.equal(yt.ok, true);
  assert.equal(yt.reason, "destination_attested");
});

test("a bot wall is not an attestation — 200 OK is not the same as readable", () => {
  // Yelp answers 403, BBB and Angi answer a Cloudflare challenge, Instagram
  // answers 200 with a login shell titled "Instagram". Treating any of those as
  // a name match is "QC PASS is never proof" wearing a new costume.
  for (const t of ["Instagram", "Just a moment... | Better Business Bureau®", "Attention Required! | Cloudflare", "Error", "yelp.com"]) {
    assert.equal(sd.readAttestation(`<title>${t}</title>`).name, "", `"${t}" must not attest an identity`);
  }
  // A real one does attest, with the platform's own branding trimmed off.
  assert.equal(sd.readAttestation("<title>Carter's My Plumber - YouTube</title>").name, "Carter's My Plumber");
});

test("a URL we could not read ships only when its PATH names the business", () => {
  const base = { businessName: "Carter's My Plumber", home: { city: "Indianapolis", state: "IN" }, fetched: { ok: false, status: 403, html: "" } };
  const mine = sd.judgeProfile({ ...base, candidate: { ...sd.classifyProfileUrl("https://www.yelp.com/biz/carters-my-plumber-greenwood"), provenance: "named_match" } });
  assert.equal(mine.ok, true);
  assert.equal(mine.reason, "path_encodes_business");
  // A stranger's unreadable listing has nothing left to stand on.
  const theirs = sd.judgeProfile({ ...base, candidate: { ...sd.classifyProfileUrl("https://www.yelp.com/biz/indy-drain-pros-indianapolis"), provenance: "named_match" } });
  assert.equal(theirs.ok, false);
  assert.equal(theirs.reason, "unverifiable_url");
});

test("a destination naming a DIFFERENT business refuses the chip outright", () => {
  const v = sd.judgeProfile({
    candidate: { ...sd.classifyProfileUrl("https://www.linkedin.com/company/indy-drain-pros"), provenance: "named_match" },
    businessName: "Carter's My Plumber",
    home: { city: "Indianapolis", state: "IN" },
    fetched: { ok: true, status: 200, html: '<meta property="og:title" content="Indy Drain Pros | LinkedIn">' },
  });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "destination_is_not_this_business");
});

test("discoverSocials FOLLOWS every chip it is about to attach, and says what it found", async () => {
  const search = async () => ({
    ok: true,
    results: [
      { url: "https://www.yelp.com/biz/ars-rescue-rooter-austin-5", title: "ARS RESCUE ROOTER - Yelp" },
      { url: "https://www.yelp.com/biz/ars-rescue-rooter-austin-5?start=60", title: "ARS RESCUE ROOTER - Yelp", description: "ARS RESCUE ROOTER, 8619 Wall St, Ste 600, Austin, TX 78754, 140 Photos" },
      { url: "https://www.bbb.org/us/tn/memphis/profile/heating-and-air-conditioning/arsrescue-rooter-0543-44016274/customer-reviews", title: "ARS/Rescue Rooter | BBB Reviews" },
    ],
  });
  const followed = [];
  const follow = async (url) => { followed.push(url); return { ok: false, status: 403, html: "" }; };
  const out = await sd.discoverSocials({
    businessName: "Rescue Rooter",
    siteUrl: "https://www.ars.com/rescue-rooter-jack-howk-portland",
    html: '<script type="application/ld+json">{"addressRegion":"Oregon"}</script>',
    search, follow,
  });
  assert.deepEqual(out.profiles, [], "neither out-of-state listing may be attached");
  assert.equal(out.home.state, "OR", "the home state was read off their own page");
  assert.equal(out.refused.length, 2);
  assert.ok(out.refused.every((r) => r.reason === "locality_contradiction"));
  // Every refusal carries the sentence an operator can check by hand. A count is
  // not an audit, and a count is how this shipped in the first place.
  assert.ok(out.refused.every((r) => /Rescue Rooter trades in OR/.test(r.evidence)));
  assert.ok(followed.length >= 1, "the links were actually followed, not merely parsed");
});

test("a link-follower that dies does not become an attached chip", async () => {
  const follow = async () => { throw new Error("socket hang up"); };
  const search = async () => ({ ok: true, results: [{ url: "https://www.yelp.com/biz/rimrock-valley-plumbing-billings", title: "Rimrock Valley Plumbing" }] });
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing", siteUrl: "https://rimrockvalley.com/", html: "", search, follow });
  // The path names them, so it survives on the path — but on the path ALONE,
  // and the evidence says so rather than implying the page was read.
  assert.equal(out.profiles.length, 1);
  assert.equal(out.profiles[0].verifiedBy, "path_encodes_business");
  assert.match(out.profiles[0].verifiedEvidence, /could not be read/);
});

test("following is optional, and its absence never invents proof", async () => {
  const search = async () => ({ ok: true, results: [{ url: "https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz", title: "Rimrock Valley Plumbing" }] });
  const out = await sd.discoverSocials({ businessName: "Rimrock Valley Plumbing", siteUrl: "https://rimrockvalley.com/", html: "", search, follow: null });
  assert.equal(out.followCalls, 0);
  assert.deepEqual(out.profiles, [], "an opaque channel id with nobody to vouch for it is ABSENT, not attached");
});

test("the home state is read off their own page when the caller does not pass one", () => {
  assert.equal(sd.homeLocality({ html: '{"addressRegion":"Oregon","addressLocality":"Clackamas"}' }).state, "OR");
  assert.equal(sd.homeLocality({ state: "wi" }).state, "WI");
  // Unknown stays unknown. It must never resolve to a guess: an unknown home
  // state means "no locality verdict", while a wrong one means a deleted chip.
  assert.equal(sd.homeLocality({ html: "<p>we serve the whole midwest</p>" }).state, "");
  assert.equal(sd.normalizeState("Banana"), "");
});

test("CARTER'S SIX CHIPS ALL SURVIVE — a fix that empties the bar is not a fix", () => {
  // Measured against the live Carter's build: facebook, instagram, youtube,
  // linkedin, yelp and bbb. Each is carried by a DIFFERENT kind of proof, which
  // is the point — any one rule on its own would have deleted several of them.
  const name = "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair";
  const home = { city: "Indianapolis", state: "IN" };
  const cases = [
    ["https://www.facebook.com/CartersMyPlumber", "named_match", { ok: false, status: 400, html: "" }, "path_encodes_business"],
    ["https://www.instagram.com/cartersmyplumber/", "own_site_link", { ok: true, status: 200, html: "<title>Instagram</title>" }, "own_site_link"],
    ["https://www.youtube.com/channel/UCDoJnM4wYkqxUWK3KoYPfkw", "named_match", { ok: true, status: 200, html: "<title>Carter's My Plumber - YouTube</title>" }, "destination_attested"],
    ["https://www.linkedin.com/company/carter's-my-plumber-llc", "named_match", { ok: true, status: 200, html: "<title>Carter's My Plumber LLC | LinkedIn</title>" }, "destination_attested"],
    ["https://www.yelp.com/biz/carters-my-plumber-greenwood", "named_match", { ok: false, status: 403, html: "" }, "path_encodes_business"],
    ["https://www.bbb.org/us/in/indianapolis/profile/plumber/carters-my-plumber-0382-90036102", "named_match", { ok: false, status: 403, html: "" }, "path_encodes_business"],
  ];
  for (const [url, provenance, fetched, expected] of cases) {
    const candidate = sd.classifyProfileUrl(url);
    assert.ok(candidate, `${url} must still classify`);
    const v = sd.judgeProfile({ candidate: { ...candidate, provenance }, businessName: name, home, fetched });
    assert.equal(v.ok, true, `${url} was refused: ${v.reason} — ${v.evidence}`);
    assert.equal(v.reason, expected, `${url} should be carried by ${expected}`);
  }
});

test("A DEAD PROFILE IS REFUSED EVEN WHEN THE BUSINESS LINKS IT ITSELF", () => {
  // Both cases were found by following live chips on 2026-08-07, not reasoned
  // about. A stale link in a footer is exactly the thing a business stops
  // maintaining, and shipping it sends their customer to an error page under
  // their own brand — which is worse than an absent chip.

  // Five Star Columbus Plumbing links this from its own site; it answers 404.
  const yt404 = sd.classifyProfileUrl("https://www.youtube.com/@fivestarhomeservices");
  const a = sd.judgeProfile({
    candidate: { ...yt404, provenance: "own_site_link" },
    businessName: "Five Star Columbus Plumbing",
    home: { city: "Columbus", state: "OH" },
    fetched: { ok: false, status: 404, html: "" },
  });
  assert.equal(a.ok, false);
  assert.equal(a.reason, "destination_gone");

  // Universal Plumbing's YouTube chip: HTTP 200, no og:title, and the body
  // says the channel is not there. A status check alone cannot see this.
  const ytSoft = sd.classifyProfileUrl("https://www.youtube.com/channel/UCkfGnmWogywVKerTEvDBB8Q");
  const b = sd.judgeProfile({
    candidate: { ...ytSoft, provenance: "own_site_link" },
    businessName: "Universal Plumbing",
    home: { city: "Augusta", state: "GA" },
    fetched: { ok: true, status: 200, html: '<html><body><script>{"alerts":[{"alertRenderer":{"type":"ERROR","text":{"simpleText":"This channel does not exist."}}}]}</script></body></html>' },
  });
  assert.equal(b.ok, false);
  assert.equal(b.reason, "destination_gone");

  // AND THE OTHER WAY: a real channel that happens to be unreadable behind an
  // anti-bot wall must still ship. A refusal rule that eats live profiles is
  // the failure this whole file exists to prevent.
  const live = sd.classifyProfileUrl("https://www.youtube.com/@bulldogrooter9851");
  const c = sd.judgeProfile({
    candidate: { ...live, provenance: "own_site_link" },
    businessName: "Bulldog Rooter",
    home: { city: "Spokane Valley", state: "WA" },
    fetched: { ok: true, status: 200, html: "<title>Bulldog Rooter - YouTube</title>" },
  });
  assert.equal(c.ok, true);
});

test("A PHRASE THE HEALTHY PAGE ALSO CONTAINS IS NOT EVIDENCE", () => {
  // My first soft-404 rule matched the bare string "Couldn't find this
  // account" and refused tiktok.com/@universalplumbing — a LIVE profile with 34
  // followers that I had already opened in a browser. TikTok inlines its whole
  // i18n dictionary, so the phrase sits at byte ~198,000 of the healthy page
  // and the dead one alike. This test is the guard against reintroducing it.
  const tt = sd.classifyProfileUrl("https://www.tiktok.com/@universalplumbing");
  const v = sd.judgeProfile({
    candidate: { ...tt, provenance: "own_site_link" },
    businessName: "Universal Plumbing",
    home: { city: "Augusta", state: "GA" },
    fetched: { ok: true, status: 200, html: `x{"Couldn't find this account":"Couldn't find this account"}x{"uniqueId":"universalplumbing","nickname":"Universal Plumbing"}` },
  });
  assert.equal(v.ok, true, `a live TikTok profile was refused: ${v.reason} — ${v.evidence}`);
});
