"use strict";

// test/builder-cdn-logo-gate.test.js — a widening of the ownership gate that
// must not become a hole.
//
// MEASURED: 300 candidates across concrete and fencing produced 32 weak sites
// and zero qualified leads, all dying at the logo gate. The marks were real and
// correctly named; they were served from the site builder's CDN rather than the
// client's domain (hesse-fence-and-deck-logo.png on le-cdn.hibuwebsites.com).
// That is the anti-correlation in the funnel: a site weak enough to need us is
// usually on a builder, and builders host the logo.
//
// The gate that refused them is the APOC fix — the guard that stopped another
// company's mark reaching a client's page. So the widening is deliberately
// narrow, and these tests are written to attack it rather than confirm it:
//
//   * OFF unless BUILDER_CDN_LOGOS is explicitly on. Default behaviour is
//     byte-identical to the old sameOwner check.
//   * A known builder CDN only. An arbitrary host is still a stranger.
//   * The FILENAME must carry >= 2 distinct tokens of the business's own name.
//     One token is a coincidence; a generic logo.png is evidence about nobody.
//
// The failure this must never allow: company A's mark, on a shared CDN, landing
// on company B's page.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ownsLogo, sameOwner, nameTokens } = require("../lib/web-brand");

const SITE = "https://hessefenceanddeck.com/";
const NAME = "Hesse Fence & Deck";
const REAL = "https://le-cdn.hibuwebsites.com/x/dms3rep/multi/hesse-fence-and-deck-logo.png";
const ON = { BUILDER_CDN_LOGOS: "1" };

// FLIPPED 2026-08-06, on measured evidence. The brand stage was refusing 7 of
// every 11 qualified leads for no_own_domain_logo_candidate, and a logo is
// MANDATORY (computeRevealable requires the brand check; brand only passes with
// a real logo and a measurable accent). Default-off meant the funnel discarded
// exactly the businesses the pitch is aimed at — a weak site is usually on a
// builder, and builders host the logo on their own CDN.
//
// What did NOT change is every guard that makes the widening safe, and those
// are asserted immediately below: a known builder host, a supplied business
// name, two matching tokens, one of them distinctive rather than a trade word.
test("DEFAULT IS ON: a builder-CDN mark carrying the business's own name is adopted", () => {
  assert.equal(ownsLogo(SITE, REAL, NAME, {}), true);
  for (const v of ["", "1", "true", "on", "yes", "maybe"]) {
    assert.equal(ownsLogo(SITE, REAL, NAME, { BUILDER_CDN_LOGOS: v }), true, `flag "${v}" leaves the default on`);
  }
});

test("an explicit off switch still returns to same-domain-only", () => {
  for (const v of ["0", "false", "off", "no"]) {
    assert.equal(ownsLogo(SITE, REAL, NAME, { BUILDER_CDN_LOGOS: v }), false, `flag "${v}" must disable`);
  }
});

test("the client's own domain is always owned, flag or no flag", () => {
  const own = "https://hessefenceanddeck.com/img/logo.png";
  assert.equal(ownsLogo(SITE, own, NAME, {}), true);
  assert.equal(ownsLogo(SITE, own, "", {}), true, "no business name needed for the own-domain path");
  assert.equal(sameOwner(SITE, own), true);
});

test("FLAG ON: a builder CDN mark named for THIS business is accepted", () => {
  assert.equal(ownsLogo(SITE, REAL, NAME, ON), true);
});

test("THE ATTACK: another company's mark on the same CDN is refused", () => {
  const other = "https://le-cdn.hibuwebsites.com/x/baker-fence-and-deck-logo.png";
  assert.equal(ownsLogo(SITE, other, NAME, ON), false,
    "a mark naming a different business must never be adopted");
});

test("a generic filename on a builder CDN is evidence about nobody", () => {
  for (const f of ["logo.png", "header-logo.png", "site-logo.svg", "image001.png"]) {
    assert.equal(ownsLogo(SITE, `https://le-cdn.hibuwebsites.com/x/${f}`, NAME, ON), false, f);
  }
});

test("an arbitrary host is still a stranger, however well the filename reads", () => {
  for (const h of ["evil.example.com", "cdn.competitor.io", "images.random.net"]) {
    assert.equal(ownsLogo(SITE, `https://${h}/hesse-fence-and-deck-logo.png`, NAME, ON), false, h);
  }
});

test("one matching token is a coincidence, not corroboration", () => {
  // "fence" alone matches half the industry.
  assert.equal(ownsLogo(SITE, "https://le-cdn.hibuwebsites.com/x/fence-logo.png", NAME, ON), false);
  // A one-word business name can never reach two tokens, so it cannot pass.
  assert.equal(ownsLogo("https://acme.com/", "https://le-cdn.hibuwebsites.com/x/acme-logo.png", "Acme", ON), false);
});

test("legal suffixes and stopwords are not tokens — they would match everything", () => {
  const t = nameTokens("The Hesse Fence & Deck Company LLC");
  assert.ok(!t.includes("the") && !t.includes("company") && !t.includes("llc") && !t.includes("and"));
  assert.deepEqual(t, ["hesse", "fence", "deck"]);
  // Two businesses sharing only stopwords must not cross-match.
  assert.equal(ownsLogo(SITE, "https://le-cdn.hibuwebsites.com/x/the-company-llc-logo.png", NAME, ON), false);
});

test("a malformed url is refused rather than throwing", () => {
  for (const bad of ["", "not-a-url", "javascript:alert(1)", null]) {
    assert.equal(ownsLogo(SITE, bad, NAME, ON), false, String(bad));
  }
});

// ---------------------------------------------------------------------------
// A CACHING PROXY SERVING THE CLIENT'S OWN ORIGIN FILE
// ---------------------------------------------------------------------------
// MEASURED, 2026-08-08, on six real Phoenix plumbers: every empty candidate
// list came back `not_own_mark_host`, not "ambiguous, refused on purpose". AZ
// Family Plumbing's header mark is a NitroPack rewrite whose path names their
// own origin — the proxy keys its cache by it — and ownsLogo read hostname and
// filename only, never the path. Their own artwork was called a stranger's and
// the lead died at the brand stage after Firecrawl and a homepage fetch had
// already been paid for. Live proof after this change: candidates 0 -> 1,
// declared false -> true, manufacturer badges admitted 0.

const NITRO = "https://cdn-ilcdbif.nitrocdn.com/ymppzYwHQtPrpMnrCeQidJqNQVwKIaKf/assets/images/optimized/rev-0839a14";
const AZ_SITE = "https://www.azfamilyplumbing.com/";

test("a proxy rewrite whose path names the client's own domain is the client's own file", () => {
  assert.equal(
    ownsLogo(AZ_SITE, `${NITRO}/www.azfamilyplumbing.com/wp-content/uploads/header-logo.svg`, "AZ Family Plumbing"),
    true,
  );
});

test("the proxy path counts as same-domain even with builder-CDN widening switched off", () => {
  // BUILDER_CDN_LOGOS=0 means "same domain only". A proxied copy of the
  // client's own origin file IS their own file, which is why this is proved
  // before the flag rather than behind it.
  assert.equal(
    ownsLogo(AZ_SITE, `${NITRO}/www.azfamilyplumbing.com/wp-content/uploads/header-logo.svg`, "AZ Family Plumbing", { BUILDER_CDN_LOGOS: "0" }),
    true,
  );
});

test("the domain must be a WHOLE path segment — lookalikes are still strangers", () => {
  for (const bad of [
    `${NITRO}/notazfamilyplumbing.com/wp-content/uploads/header-logo.svg`,
    `${NITRO}/azfamilyplumbing.com.evil.test/wp-content/uploads/header-logo.svg`,
    `${NITRO}/cache-azfamilyplumbing.com-v2/wp-content/uploads/header-logo.svg`,
    // Another company's site proxied through the same CDN.
    `${NITRO}/www.apacheplumbingservices.com/wp-content/uploads/header-logo.svg`,
  ]) {
    assert.equal(ownsLogo(AZ_SITE, bad, "AZ Family Plumbing", { BUILDER_CDN_LOGOS: "0" }), false, bad);
  }
});

test("an arbitrary host cannot spoof ownership with the client domain in its path", () => {
  assert.equal(
    ownsLogo(AZ_SITE, "https://evil.test/www.azfamilyplumbing.com/header-logo.svg", "AZ Family Plumbing", { BUILDER_CDN_LOGOS: "0" }),
    false,
  );
});

test("another Nitro tenant cannot add the client domain later in its path", () => {
  assert.equal(
    ownsLogo(AZ_SITE, `${NITRO}/evil.example/www.azfamilyplumbing.com/header-logo.svg`, "AZ Family Plumbing", { BUILDER_CDN_LOGOS: "0" }),
    false,
  );
});

test("THE APOC CASE: a stranger's mark on an arbitrary CDN is still refused", () => {
  // The incident the ownership gate exists for — a logo URL from image-search
  // evidence, trusted with no ownership check, rendering a roofing
  // manufacturer's mark as the prospect's own identity.
  for (const stranger of [
    "https://images.example-search.com/apoc-roof-coatings-logo.png",
    "https://cdn.manufacturer.example/navien-new-logo-2021.png",
    // Same proxy host, no path evidence at all.
    "https://cdn-ilcdbif.nitrocdn.com/KEY/assets/images/logo.png",
  ]) {
    assert.equal(ownsLogo(AZ_SITE, stranger, "AZ Family Plumbing"), false, stranger);
  }
});

test("a manufacturer badge sharing the proxied path is still named and refused", () => {
  // Ownership of the HOST is not ownership of the MARK. NitroPack rewrites
  // EVERY asset, so the client's domain is in the path of the Navien badge too.
  // ownsLogo admits it; the third-party denylist is what stops it, and that is
  // the layer this change deliberately does not touch.
  const badge = `${NITRO}/www.azfamilyplumbing.com/wp-content/uploads/Navien-new-logo-2021-1.png`;
  assert.equal(ownsLogo(AZ_SITE, badge, "AZ Family Plumbing"), true, "the host check cannot see filenames");
  const { isThirdPartyMark } = require("../lib/capture-brand");
  assert.equal(isThirdPartyMark(badge), true, "the denylist is the layer that refuses it");
});
