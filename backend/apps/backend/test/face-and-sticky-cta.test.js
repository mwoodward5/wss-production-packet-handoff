"use strict";

// test/face-and-sticky-cta.test.js — "A REAL FACE, AND URGENT CTAs" (owner,
// 2026-08-12), extended with the FEATURE-FLAGGED contact rail (2026-09-02).
// Site trust-surface additions, each with truth-law gates:
//   1. an ownership-gated face/crew/van band, captioned by subject
//   2. a chat trigger whose visible label reads "Chat" (the panel still names
//      Riley), AI-disclosed, never a "presence" claim
//   3. a sticky mobile Call · Text Us · primary-CTA bar — FLAG-GATED off
//      facts.features.sticky_cta (default OFF), <768px only (CSS-enforced),
//      Text Us only under features.sms_cta AND a verified sms_capable fact
//   4. a chat handoff — "Prefer to talk? Call Riley" — FLAG-GATED off
//      facts.features.chat_handoff, wired to the lib/riley-line resolution
//   5. the bar and the two floaters coexist (asserted structurally here;
//      collision is proved by render at a 390 viewport in
//      scripts/prove-face-and-cta.js)

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inject,
  injectChatHandoff,
  buildTeamBand,
  buildCallBar,
  contactRailFlags,
  pickIdentityPhoto,
  identityBandSubject,
} = require("../lib/mirror-engine/content-inject");
const { resolveChatWidgetConfig, buildChatWidget } = require("../lib/mirror-engine/chat-widget");

const photo = (over) => ({ ok: true, ext: "jpg", bytes: Buffer.from("jpgbytes"), width: 1600, height: 1000, ...over });

// ---------------------------------------------------------------------------
// identityBandSubject — the caption is only ever as specific as the evidence
// ---------------------------------------------------------------------------
test("subject: a van is a vehicle, a crew is a team, a portrait is a person", () => {
  assert.equal(identityBandSubject("https://x/img/service-van-1920w.jpg"), "vehicle");
  assert.equal(identityBandSubject("https://x/uploads/our-crew.jpg"), "team");
  assert.equal(identityBandSubject("https://x/about/owner-headshot.jpg"), "person");
  // A vehicle word wins over a crowd word — a "team-van" is a van.
  assert.equal(identityBandSubject("https://x/team-van.jpg"), "vehicle");
});

test("subject: an opaque GBP token qualifies ONLY when the brief flagged a person", () => {
  const gbp = "https://lh3.googleusercontent.com/p/AAA_bbbCCC=s1600";
  assert.equal(identityBandSubject(gbp), "");
  assert.equal(identityBandSubject(gbp, { identityCritical: true }), "person");
});

// ---------------------------------------------------------------------------
// pickIdentityPhoto — join bank verdicts to fetched bytes, prefer a NON-hero one
// ---------------------------------------------------------------------------
test("pick: the identity-critical portrait is chosen and captioned person", () => {
  const bank = { photos: [
    { url: "https://x/hero.jpg", sha256: "hero", grade: "hero", current_hero: true },
    { url: "https://x/owner.jpg", sha256: "own", identity_critical: true },
  ] };
  const usablePhotos = [photo({ url: "https://x/hero.jpg", sha256: "hero" }), photo({ url: "https://x/owner.jpg", sha256: "own" })];
  const picked = pickIdentityPhoto({ bank, usablePhotos, excludeSha: "hero" });
  assert.equal(picked.sha, "own");
  assert.equal(picked.subject, "person");
});

test("pick: excludeSha keeps the band OFF the exact photo behind the hero", () => {
  // Two identity photos; the first is the hero wash's — the band takes the other.
  const bank = { photos: [
    { url: "https://x/crew-a.jpg", sha256: "a", identity_critical: true },
    { url: "https://x/crew-b.jpg", sha256: "b", identity_critical: true },
  ] };
  const usablePhotos = [photo({ url: "https://x/crew-a.jpg", sha256: "a" }), photo({ url: "https://x/crew-b.jpg", sha256: "b" })];
  const picked = pickIdentityPhoto({ bank, usablePhotos, excludeSha: "a" });
  assert.equal(picked.sha, "b");
});

test("pick: the packet/GBP lane works off filenames when no brief ran", () => {
  const usablePhotos = [photo({ url: "https://x/img/service-van.jpg", sha256: "v" }), photo({ url: "https://x/img/hero-bg.jpg", sha256: "h" })];
  const picked = pickIdentityPhoto({ bank: null, usablePhotos, excludeSha: "" });
  assert.equal(picked.sha, "v");
  assert.equal(picked.subject, "vehicle");
});

test("pick: an abstract-only bank yields nothing — absent, honestly", () => {
  const usablePhotos = [photo({ url: "https://x/img/close-up-pipe.jpg", sha256: "p" }), photo({ url: "https://x/img/texture.jpg", sha256: "t" })];
  assert.equal(pickIdentityPhoto({ bank: { photos: [] }, usablePhotos, excludeSha: "" }), null);
});

// ---------------------------------------------------------------------------
// buildTeamBand — copy true for the subject, their own asset only
// ---------------------------------------------------------------------------
test("band: person copy, their asset, honest alt", () => {
  const html = buildTeamBand({ identityPhoto: { url: "/assets/wss-people.jpg", subject: "person" }, facts: { business_name: "Ramon Roofing" }, market: "Fort Worth, TX" });
  assert.match(html, /id="wss-team"/);
  assert.match(html, /Who you&#39;re hiring/);         // apostrophe ships escaped
  assert.match(html, /The people behind Ramon Roofing/);
  assert.match(html, /src="\/assets\/wss-people\.jpg"/);
  assert.match(html, /alt="The team at Ramon Roofing"/);
  assert.match(html, /data-wss-identity="person"/);
});

test("band: a van stays a vehicle without turning the NAP city into a service claim", () => {
  const html = buildTeamBand({ identityPhoto: { url: "/assets/wss-people.jpg", subject: "vehicle" }, facts: { business_name: "Ramon Roofing" }, market: "Fort Worth, TX" });
  assert.match(html, /On the road/);
  assert.match(html, /Ramon Roofing on the road/);
  assert.match(html, /alt="Ramon Roofing vehicle"/);
  assert.doesNotMatch(html, /Meet the team|The crew at/);
  assert.doesNotMatch(html, /Fort Worth/, "an address locality is not proof that the van serves that market");
});

test("band: refuses anything not an ownership-gated asset", () => {
  assert.equal(buildTeamBand({ identityPhoto: null, facts: { business_name: "X" } }), "");
  assert.equal(buildTeamBand({ identityPhoto: { url: "javascript:alert(1)", subject: "person" }, facts: { business_name: "X" } }), "");
  assert.equal(buildTeamBand({ identityPhoto: { url: "http://insecure/x.jpg", subject: "person" }, facts: { business_name: "X" } }), "");
});

// ---------------------------------------------------------------------------
// buildCallBar — Call always, Text only when textable, id dodges our own widgets
// ---------------------------------------------------------------------------
test("bar: a phone gives Call + Chat, and NO Text without a textable number", () => {
  const html = buildCallBar({ phoneDigits: "8175551212", phoneHuman: "(817) 555-1212", businessName: "Ramon Roofing", accent: "#C53F34" });
  assert.match(html, /id="wsscallbar"/);
  assert.match(html, /href="tel:8175551212"/);
  assert.match(html, /wss-cb__chat/);
  assert.doesNotMatch(html, /wss-cb__text/);           // no faked Text button
  assert.match(html, /--wss-cb-accent:#c53f34/);
  // The id must NOT start "wss-" (with a hyphen), so the floater's obstruction
  // heuristic — which skips wss-* — still dodges this bar. Contract, not cosmetic.
  assert.doesNotMatch(html, /id="wss-callbar"/);
});

test("bar: sms: href format — bare NANP digits for a bare number, +E164 for an E.164 one", () => {
  const nanp = buildCallBar({ phoneDigits: "8175551212", smsDigits: "8175559999", smsAllowed: true, businessName: "X" });
  assert.match(nanp, /href="sms:8175559999"/);
  const e164 = buildCallBar({ phoneDigits: "8175551212", smsDigits: "+18175559999", smsAllowed: true, businessName: "X" });
  assert.match(e164, /href="sms:\+18175559999"/);
  assert.doesNotMatch(e164, /sms:[^"+\d]/);
});

test("bar: a genuinely textable number lights the Text Us button — but ONLY under the sms_cta flag", () => {
  // Feature 5: the flag AND a textable number are both required. The label
  // reads "Text Us" — the business's own text line for ITS customers.
  const unflagged = buildCallBar({ phoneDigits: "8175551212", smsDigits: "8175559999", businessName: "X" });
  assert.doesNotMatch(unflagged, /wss-cb__text/);      // default OFF: number alone is not enough
  const flagged = buildCallBar({ phoneDigits: "8175551212", smsDigits: "8175559999", smsAllowed: true, businessName: "X" });
  assert.match(flagged, /wss-cb__text/);
  assert.match(flagged, /href="sms:8175559999"/);
  assert.match(flagged, /Text Us<\/span>/);
});

test("bar: the business's primary CTA is the second action; an invalid one is dropped, never faked", () => {
  const html = buildCallBar({ phoneDigits: "8175551212", primaryCta: { label: "Book Online", href: "https://booking.example/ramon" }, businessName: "X" });
  assert.match(html, /wss-cb__cta/);
  assert.match(html, /href="https:\/\/booking\.example\/ramon"/);
  assert.match(html, />Book Online<\/a>/);
  // With a real primary CTA the Chat fallback yields to it.
  assert.doesNotMatch(html, /wss-cb__chat/);
  const junk = buildCallBar({ phoneDigits: "8175551212", primaryCta: { label: "Free Money", href: "javascript:alert(1)" }, businessName: "X" });
  assert.doesNotMatch(junk, /wss-cb__cta/);            // non-https href: dropped, not sanitized into trust
  assert.doesNotMatch(junk, /Free Money/);
  assert.match(junk, /wss-cb__chat/);                   // …and the honest fallback returns
});

// ---------------------------------------------------------------------------
// CONTACT-RAIL FEATURE FLAGS — default OFF, absent flag = absent feature
// ---------------------------------------------------------------------------
test("flags: absent, empty, or falsy facts.features is all OFF — and only boolean true counts", () => {
  assert.deepEqual(contactRailFlags({}), { sticky_cta: false, sms_cta: false, chat_handoff: false });
  assert.deepEqual(contactRailFlags({ features: {} }), { sticky_cta: false, sms_cta: false, chat_handoff: false });
  assert.deepEqual(contactRailFlags({ features: null }), { sticky_cta: false, sms_cta: false, chat_handoff: false });
  // "true" (string) and 1 are NOT promotions — a caller that cannot send a
  // real boolean has not verified the feature for this business.
  assert.equal(contactRailFlags({ features: { sticky_cta: "true", sms_cta: 1 } }).sticky_cta, false);
  assert.equal(contactRailFlags({ features: { sticky_cta: "true", sms_cta: 1 } }).sms_cta, false);
  assert.deepEqual(
    contactRailFlags({ features: { sticky_cta: true, chat_handoff: true } }),
    { sticky_cta: true, sms_cta: false, chat_handoff: true },
  );
});

test("bar: no phone, no bar (the floating bubble already covers chat)", () => {
  assert.equal(buildCallBar({ phoneDigits: "", businessName: "X" }), "");
  assert.equal(buildCallBar({ phoneDigits: "12", businessName: "X" }), "");
});

test("bar: it removes itself from proof shots and drives the real launcher", () => {
  const html = buildCallBar({ phoneDigits: "8175551212", businessName: "X" });
  assert.match(html, /wssthumb=1/);                    // absent from ?wssthumb=1 captures
  assert.match(html, /wss-chat-launcher/);             // Chat clicks the real widget
});

// ---------------------------------------------------------------------------
// The expert chat trigger — Riley, AI-disclosed, no presence claim
// ---------------------------------------------------------------------------
test("chat: the config carries the trade, hygienically", () => {
  const cfg = resolveChatWidgetConfig({ facts: { business_name: "Ramon Roofing" }, slug: "wss-test-ramon", brand: {}, trade: "Roofing" });
  assert.equal(cfg.ok, true);
  assert.equal(cfg.config.trade, "Roofing");
});

test("chat: the visible trigger reads 'Chat', names the trade, discloses AI", () => {
  const cfg = resolveChatWidgetConfig({ facts: { business_name: "Ramon Roofing" }, slug: "wss-test-ramon", brand: { accent: "#c53f34" }, trade: "HVAC" });
  const html = buildChatWidget(cfg.config);
  // The launcher's accessible name describes opening a chat with the AI
  // assistant — not "Ask Riley", and not the old passive "Open chat with X".
  assert.match(html, /aria-label="Chat with Ramon Roofing — free HVAC advice from their AI assistant\."/);
  assert.doesNotMatch(html, /aria-label="Open chat with/);
  // The visible trigger label reads "Chat" (not "Ask Riley"), with the trade
  // offer and an AI badge.
  assert.match(html, /id="wss-chat-cta"/);
  assert.match(html, /<span class="wss-chat__cta-strong">Chat<\/span>/);
  assert.doesNotMatch(html, /<span class="wss-chat__cta-strong">Ask Riley<\/span>/);
  assert.match(html, /Free HVAC advice/);
  assert.match(html, /class="wss-chat__cta-ai"[^>]*>AI</);
  // The panel identity still discloses that Riley is the AI assistant.
  assert.match(html, /Riley is Ramon Roofing's AI assistant/);
});

test("chat: TRUTH LAW — no presence dot, no 'online' claim on the trigger", () => {
  const cfg = resolveChatWidgetConfig({ facts: { business_name: "X Co" }, slug: "wss-test-xco", brand: {}, trade: "Plumbing" });
  const html = buildChatWidget(cfg.config);
  assert.doesNotMatch(html, /online now|is online|typing|\bseen\b/i);
  assert.doesNotMatch(html, /cta-dot/);   // the green presence dot was removed by design
});

test("chat: no trade still works — 'free advice', trigger reads 'Chat', panel keeps Riley", () => {
  const cfg = resolveChatWidgetConfig({ facts: { business_name: "X Co" }, slug: "wss-test-xco", brand: {} });
  const html = buildChatWidget(cfg.config);
  assert.match(html, /aria-label="Chat with X Co — free advice from their AI assistant\."/);
  assert.match(html, /<span class="wss-chat__cta-strong">Chat<\/span>/);
  assert.match(html, /Free advice/);
  // The panel identity still names Riley.
  assert.match(html, /Riley is X Co's AI assistant/);
});

// ---------------------------------------------------------------------------
// inject() — the three surfaces land together, reported off the emitted bytes
// ---------------------------------------------------------------------------
const DONOR = '<!doctype html><html><head><title>t</title></head><body>'
  + '<section class="hero"><h1>Ramon Roofing</h1></section><div id="root"></div>'
  + '<footer>&copy; Ramon Roofing</footer><script src="./app.js"></script></body></html>';

const FACTS = {
  business_name: "Ramon Roofing", industry: "roofing", city: "Fort Worth", state: "TX",
  phone: "+18175551212", rating: 4.9, review_count: 212, place_id: "ChIJ-ramon",
};
const CONTENT = { services: [{ name: "Roof Repair" }, { name: "Roof Replacement" }], areas: ["Fort Worth", "Arlington"] };

function build(extra = {}) {
  const out = inject({
    files: { "index.html": Buffer.from(DONOR), "app.js": Buffer.from("/* */") },
    content: CONTENT, facts: FACTS, phoneDigits: "8175551212", slug: "wss-test-ramon",
    logoUrl: "https://x/logo.png", manifest: {}, brand: { accent: "#c53f34" },
    signup: { clientId: "WSS-TEST-1234", rileyTel: "tel:+19493395562", checkoutUrl: "https://wss-ai.com/c/test" },
    identityPhoto: { url: "/assets/wss-people.jpg", subject: "person" },
    ...extra,
  });
  return { html: out.files["index.html"].toString("utf8"), report: out.report };
}

// The bar is FLAG-GATED now: promoted facts ride with the rest of the packet.
const BAR_FACTS = { ...FACTS, features: { sticky_cta: true, sms_cta: true, chat_handoff: true } };

test("inject: face band + sticky bar + expert chat all ship on the page", () => {
  const { html, report } = build({ facts: BAR_FACTS });
  // The face band, hoisted under the hero (its id is in the hoist list).
  assert.match(html, /id="wss-team"/);
  assert.match(html, /data-wss-identity="person"/);
  assert.match(html, /var ids=\["trust","wss-team","reviews","social"\]/);
  assert.equal(report.identity_band.present, true);
  assert.equal(report.identity_band.subject, "person");
  // The sticky bar, reported off the emitted bytes.
  assert.match(html, /id="wsscallbar"/);
  assert.equal(report.call_bar.present, true);
  assert.equal(report.call_bar.flag_on, true);
  assert.equal(report.call_bar.text, false);
  // The expert chat trigger (visible label reads "Chat").
  assert.match(html, /id="wss-chat-cta"/);
  assert.match(html, /<span class="wss-chat__cta-strong">Chat<\/span>/);
  assert.match(html, /aria-label="Chat with Ramon Roofing — free Roofing advice from their AI assistant/);
});

test("inject: Text lights only when a textable number is on the facts", () => {
  // An explicit distinct text line (sms_phone) still needs the sms_capable
  // fact — the verification that the line really receives texts.
  const { html, report } = build({ facts: { ...BAR_FACTS, sms_capable: true, sms_phone: "8175559999" } });
  assert.equal(report.call_bar.text, true);
  assert.match(html, /href="sms:8175559999"/);
});

test("inject: Text Us (feature 5) needs the flag AND the sms_capable fact — and then sms: aims at the business's own line", () => {
  // Flag on + sms_capable on, no distinct text line: sms: targets THE business
  // phone (the verified-mobile line), in its E.164 form.
  const both = build({ facts: { ...BAR_FACTS, sms_capable: true } });
  assert.equal(both.report.call_bar.text, true);
  assert.match(both.html, /href="sms:\+18175551212"/);
  // Flag on but sms_capable absent (a voice-only number): NO sms: link.
  const noFact = build({ facts: BAR_FACTS });
  assert.equal(noFact.report.call_bar.text, false);
  assert.doesNotMatch(noFact.html, /href="sms:/);
  // sms_capable on but the flag off (not promoted): still NO sms: link.
  const noFlag = build({ facts: { ...FACTS, sms_capable: true } });
  assert.doesNotMatch(noFlag.html, /id="wsscallbar"/);
  assert.doesNotMatch(noFlag.html, /href="sms:/);
});

test("inject: sticky_cta default OFF renders NO bar — absent flag, absent feature, named in the report", () => {
  const { html, report } = build();                          // FACTS carry no features at all
  assert.doesNotMatch(html, /id="wsscallbar"/);
  assert.doesNotMatch(html, /wss-callbar-css/);
  assert.equal(report.call_bar.present, false);
  assert.equal(report.call_bar.flag_on, false);
  assert.equal(report.call_bar.reason, "sticky_cta_flag_off");
  // Not half-rendered either: no orphan bar CSS and no sms: anywhere.
  assert.doesNotMatch(html, /#wsscallbar/);
});

test("inject: the bar is <768px ONLY — CSS media-query enforced, never a min-width desktop rule", () => {
  const { html } = build({ facts: BAR_FACTS });
  const css = /<style id="wss-callbar-css">([\s\S]*?)<\/style>/.exec(html)[1];
  // Base state is hidden; the ONE rule that shows the bar sits inside a
  // max-width media test strictly below 768px (767.98px keeps a 767.5px
  // viewport mobile while 768px and everything above stays desktop).
  assert.match(css, /^#wsscallbar\{display:none\}/m);
  assert.match(css, /@media\(max-width:767\.98px\)\{\#wsscallbar\{display:flex/);
  // No rule anywhere may show the bar at ≥768px: every enabling media test is
  // the mobile one, and no min-width desktop rule exists for the bar.
  for (const m of css.matchAll(/@media([^{]+)\{/g)) {
    if (/min-width/.test(m[1])) assert.doesNotMatch(css.slice(m.index), /\#wsscallbar\{display:flex/);
  }
  assert.doesNotMatch(css, /min-width:\s*76[78]/);
  assert.doesNotMatch(css, /max-width:\s*768/);              // 768 itself must never show it
  // The body padding that clears the bar is scoped to the same mobile test.
  assert.match(css, /@media\(max-width:767\.98px\)\{\#wsscallbar\{[^}]*\}body\{padding-bottom:calc\(60px/);
});

test("inject: primary CTA fact renders as the bar's second action and the Chat fallback yields", () => {
  const { html, report } = build({ facts: { ...BAR_FACTS, primary_cta: { label: "Book Online", href: "https://booking.example/ramon" } } });
  assert.match(html, /wss-cb__cta/);
  assert.match(html, /href="https:\/\/booking\.example\/ramon"/);
  assert.equal(report.call_bar.primary_cta, true);
  assert.doesNotMatch(html, /wss-cb__chat/);
});

test("inject: no overlap with the floater or the chat launcher (CSS co-existence contract)", () => {
  const { html } = build({ facts: BAR_FACTS });
  // 1. THE ID DODGE. The floater's obstruction measurement skips ids starting
  //    "wss-" — the bar's id deliberately does not start with that prefix, so
  //    BOTH floaters measure the bar as a real bottom obstruction and lift
  //    above it (proved by render at 390 in scripts/prove-face-and-cta.js).
  assert.match(html, /id="wsscallbar"/);
  assert.doesNotMatch(html, /id="wss-callbar"/);
  // 2. THE LIFT VARIABLES. The floater pill/card and the chat root sit on
  //    runtime-measured clearances — the exact mechanism that stacks them
  //    above a bottom bar instead of under it.
  assert.match(html, /--wss-floater-clear/);
  assert.match(html, /--wss-chat-clear/);
  // 3. THE STACK ORDER. The bar (99980) sits under the chat root (99990), so
  //    the launcher and its panel float OVER the bar, never under it.
  const barZ = Number(/#wsscallbar\{[^}]*z-index:(\d+)/.exec(html)[1]);
  const chatZ = Number(/#wss-chat-root\{[^}]*z-index:(\d+)/.exec(html)[1]);
  assert.ok(chatZ > barZ, `chat z-index ${chatZ} must exceed bar z-index ${barZ}`);
  // 4. The bar only exists below 768px, so on desktop there is nothing to
  //    overlap at all.
  assert.match(html, /@media\(max-width:767\.98px\)\{\#wsscallbar\{display:flex/);
});

// ---------------------------------------------------------------------------
// FEATURE 11 — THE CHAT HANDOFF: "Prefer to talk? Call Riley"
// ---------------------------------------------------------------------------
test("inject: chat handoff renders inside the widget panel, wired to the resolved Riley line", () => {
  const { html, report } = build({ facts: BAR_FACTS });
  assert.match(html, /id="wss-chat-handoff-css"/);
  assert.match(html, /data-wss-chat-handoff/);            // runtime marker stamped on #wss-chat-root
  assert.match(html, /getElementById\("wss-chat-form"\)/); // self-wires against the real widget
  assert.match(html, /Prefer to talk\? Call Riley/);
  // Wired to the SAME resolution the sign-up panel carries (signup.rileyTel).
  assert.match(html, /setAttribute\("href","tel:\+19493395562"\)/);
  assert.equal(report.chat_handoff.present, true);
  assert.equal(report.chat_handoff.tel, "tel:+19493395562");
  assert.equal(report.chat_handoff.reason, "");
});

test("inject: chat handoff falls back to the configured agency line when no client line is provisioned", () => {
  process.env.GHOST_AGENT_PHONE = "+19493395561";
  try {
    const { html, report } = build({ facts: BAR_FACTS, signup: { clientId: "WSS-TEST-1234", checkoutUrl: "https://wss-ai.com/c/test" } });
    assert.match(html, /Prefer to talk\? Call Riley/);
    assert.match(html, /setAttribute\("href","tel:\+19493395561"\)/);
    assert.equal(report.chat_handoff.tel, "tel:+19493395561");
  } finally {
    delete process.env.GHOST_AGENT_PHONE;
    delete process.env.GHOST_AGENCY_AGENT_PHONE;
  }
});

test("inject: chat handoff is absent — honestly, with a named reason — when any gate is missing", () => {
  // Flag off (default): nothing, and the report says why.
  const off = build();
  assert.doesNotMatch(off.html, /Prefer to talk\? Call Riley/);
  assert.equal(off.report.chat_handoff.present, false);
  assert.equal(off.report.chat_handoff.reason, "chat_handoff_flag_off");
  // Flag on but the business publishes no phone: no handoff.
  const noPhone = build({ facts: { ...BAR_FACTS, phone: "" }, phoneDigits: "" });
  assert.doesNotMatch(noPhone.html, /Prefer to talk\? Call Riley/);
  assert.equal(noPhone.report.chat_handoff.reason, "no_business_phone_for_handoff");
  // Flag on, phone on, but NO Riley line anywhere (no signup, no agency env):
  // no affordance — never a guessed number, and never the front-desk NAP phone.
  delete process.env.GHOST_AGENT_PHONE;
  delete process.env.GHOST_AGENCY_AGENT_PHONE;
  const noLine = build({ facts: BAR_FACTS, signup: null });
  assert.doesNotMatch(noLine.html, /Prefer to talk\? Call Riley/);
  assert.equal(noLine.report.chat_handoff.reason, "no_riley_line_for_handoff");
  assert.doesNotMatch(noLine.html, /tel:\+18175551212"[\s\S]{0,80}Call Riley/);
});

test("inject: chat handoff is idempotent and self-wires only against a real widget", () => {
  const { html } = build({ facts: BAR_FACTS });
  // The marker is stamped by the script at parse time AND checked at build time
  // — a second inject pass over the same files must not stack a second one.
  const once = injectChatHandoff({ files: { "index.html": Buffer.from(html) }, facts: BAR_FACTS, signup: { rileyTel: "tel:+19493395562" } });
  assert.equal(once.report.pages, 0);
  assert.equal(once.report.present, true);   // counted, not restamped
  const twice = injectChatHandoff({ files: once.files, facts: BAR_FACTS, signup: { rileyTel: "tel:+19493395562" } });
  assert.equal(twice.report.pages, 0);
  assert.equal((twice.files["index.html"].toString("utf8").match(/wss-chat-handoff-css/g) || []).length, 1);
  // A page with no chat widget gets nothing, and the report names it.
  const bare = injectChatHandoff({ files: { "index.html": Buffer.from(DONOR) }, facts: BAR_FACTS, signup: { rileyTel: "tel:+19493395562" } });
  assert.equal(bare.report.present, false);
  assert.equal(bare.report.reason, "no_chat_widget_present");
});

test("inject: no identity photo → no band, said so honestly", () => {
  const { html, report } = build({ identityPhoto: null });
  assert.doesNotMatch(html, /id="wss-team"/);
  assert.equal(report.identity_band.present, false);
  assert.equal(report.identity_band.reason, "no_identity_photo");
});
