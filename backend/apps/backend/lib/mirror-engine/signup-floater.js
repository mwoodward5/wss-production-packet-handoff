"use strict";

// lib/mirror-engine/signup-floater.js — the left-side sign-up panel.
//
// Ported from the proven original (site-forge-lane/reference/ab-site/floater.js
// and the hardened boilerplates/roofing-tekline copy): a fixed, vertical glass
// card on the LEFT edge, collapsed to a pill by default and opened on click.
// The owner's words: "our left side pop out for the sign up showing all the
// bells and whistles... it should include Riley and the client's code there so
// they can call in from the website as well, seeing the code in bigger writing."
//
// WHY IT WAS SWITCHED OFF, AND WHAT IS DIFFERENT NOW
// The forge lane strips this from every build by default, for two stated
// reasons, and both are answered here rather than ignored:
//
//   1. "it carried a hardcoded WSS phone (949…) that rendered a SECOND number
//      on the client page." No number is written down in this file. Riley's
//      line is resolved through lib/riley-line.js — the module that exists
//      because a retired number once printed itself from a fallback — and the
//      whole Riley block is OMITTED when no line resolves. The card is also
//      unmistakably OURS: it opens with the WSS Labs mark and "site & AI team",
//      so the number reads as our concierge, never as the client's front desk.
//
//   2. "the on-site countdown widget read as a fake-urgency gimmick." The
//      countdown is NOT ported. Nothing enforced that deadline, and a timer
//      counting down to an event that never happens is a lie told in public.
//
// AND IT NEVER APPEARS IN A PROOF SHOT. The before/after thumbnail must show
// the CLIENT'S site, not our upsell over the top of it — so the panel refuses
// to render when the page is loaded with ?wssthumb=1, which is exactly how the
// original protected the same screenshot.
//
// ---------------------------------------------------------------------------
// PILL FIRST ON EVERY VIEWPORT (2026-08-21)
// ---------------------------------------------------------------------------
// The client's hero is the first-paint promise. The full $149 card must never
// cover its headline, media or CTA before the visitor asks to see the offer, so
// desktop and phone both start as the small pill and open the card on click.
// GHOST_AGENCY_FLOATER_PILL_FIRST=0 is the narrow rollback switch for the old
// desktop auto-open law; phone stays pill-first even during rollback.
//
// The width test is the SAME 760px breakpoint the phone CSS below uses, read
// through matchMedia, so the layout and the open/closed decision can never
// disagree about what a phone is.
//
// THREE THINGS THIS MUST NOT BREAK, and how each is held:
//
//   1. THE PROOF SHOT. Opening is done by the script, and the script's FIRST
//      act is still the ?wssthumb=1 check that removes the card, the pill and
//      the scrim outright. The card is also still `hidden` in the server-
//      rendered markup — it is only ever opened by a line of JS that runs
//      after that guard — so a thumbnail cannot catch it even mid-parse. Naive
//      open-by-default (dropping `hidden` from the markup) would have put a
//      Client ID card in the prospect's outreach email.
//   2. THE CLIENT'S CHAT BUBBLE. lib/mirror-engine/chat-widget.js hides itself
//      whenever `#wss-scrim.on` exists, treating it as a blocking overlay. The
//      scrim is a PHONE affordance (its only display rule lives in the phone
//      media query), so it is now turned on only when the phone query matches.
//      Setting it unconditionally, with the card now open at load, would have
//      hidden the client's chat launcher on every desktop visit.
//   3. THE CLIENT'S OWN BOTTOM BAR. Several donors park a sticky "Call now"
//      bar at the bottom of a phone screen. Our pill is measured out of its
//      way with --wss-floater-clear, the same trick (and the same shape of
//      code) the chat widget uses for --wss-chat-clear.
//
// And a visitor who closes it is not asked again if the desktop rollback is in
// use: the dismissal is remembered for the session. Reopening from the pill
// still clears that dismissal exactly as before.
//
// ---------------------------------------------------------------------------
// OPEN, BUT NEVER OVER THE CLIENT'S OWN PAGE (2026-08-11)
// ---------------------------------------------------------------------------
// Opening by default had a cost nobody had measured, and it was the worst one
// available: the panel was painted over the client's logo. Rendered proof, at
// 1280, with elementFromPoint at three points across the header mark —
//
//   roofing-falcon-clean   logo l=32 t=48 w=280 h=64   -> "wss-plan-card" x3
//   plumbing-premier       (same)                      -> "wss-plan-card" x3
//   plumbing-clean         primary CTA "Request a Quote"        77% covered
//   hvac-brandforge        primary CTA "Request a Free Estimate" 99% covered
//   roofing-falcon-clean   primary CTA "Request quote"          100% covered
//
// — and the cause was one layout decision, not a donor quirk. `top:50%` with
// `translateY(-50%)` starts a card of height H at (vh-H)/2; for the ~640px this
// card wants that is y≈80 on a 800px screen, which is the header band on every
// donor in the library. The panel was not "in the gutter"; it was on the mark.
//
// The fix keeps it OPEN (the owner asked for that) and MEASURES where it may
// sit, rather than trusting an offset, because the donors genuinely differ —
// header bottoms across the library run from 44px to 144px. Two custom
// properties carry the answer, both written by placeCard() below:
//
//   --wss-floater-top    the top of the tallest band that is below the client's
//                        header AND clear of the client's own links/buttons
//   --wss-floater-maxh   how much of that band the card may use; it scrolls
//                        internally, so a short band costs reading room, never
//                        content
//
// The same measurement runs for the pill on a phone, where the collision was
// with an in-flow "Request an inspection" rather than a fixed bar.
//
// AFTER, same apparatus, 7 donors x {1280, 390}: every logo hit-test returns
// the logo, no primary CTA is covered anywhere, and 13 of the 14 renders have
// no overlap with any client control at all. Two donors in the library
// (medspa-luma, salon-lacquer-studio) could not be rendered locally — their SPA
// shells do not mount from a bare file server — so they are unproven here.

// ONE READER FOR THE PANEL'S CONFIGURATION — see resolveSignupConfig below.
// These are required here rather than in the build module because the panel's
// renderer and the panel's configuration must never be able to disagree about
// what "configured" means; a caller that assembles the object by hand is
// exactly how one build path shipped the panel and the other silently did not.
const { resolveRileyLine: defaultResolveRileyLine } = require("../riley-line");
const { clientReferenceCode } = require("../client-reference");
const {
  prospectCheckoutUrl: defaultProspectCheckoutUrl,
  CHECKOUT_URL_ENV_NAME,
  CHECKOUT_SECRET_ENV_NAME,
} = require("../checkout-links");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

const CSS = [
  // WHERE THE CARD SITS IS MEASURED, NOT GUESSED — see placeCard() in the
  // script below. `top:50%;transform:translateY(-50%)` (vertically centred) is
  // what put a 264px-wide card straight over the client's header logo: on
  // wss-test-rimrock-plumbing-billings the mark occupies l=40 t=55 w=141 h=72,
  // and elementFromPoint at three points across it returned "wss-plan-card" at
  // all three. A centred card of height H starts at (vh-H)/2, which for the
  // 600-odd pixels this card wants is ~y=100 — the header band, on every donor.
  // The custom properties below are the two numbers the runtime writes; the
  // fallbacks are only ever seen if the script is blocked, and they are chosen
  // to sit under any plausible header rather than in the middle of the page.
  "#wss-floater{position:fixed;left:16px;top:var(--wss-floater-top,116px);z-index:99999;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;gap:10px}",
  "#wss-floater .wss-card{width:264px;max-height:var(--wss-floater-maxh,72vh);overflow-y:auto;background:rgba(15,15,17,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 15px;box-shadow:0 8px 28px rgba(0,0,0,.45);color:#f2f2f2;position:relative}",
  "#wss-floater .wss-brand{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.09)}",
  "#wss-floater .wss-brand-name{font-size:12.5px;font-weight:800;line-height:1.1;display:flex;flex-direction:column}",
  "#wss-floater .wss-brand-name small{font-weight:500;opacity:.6;font-size:10px}",
  "#wss-floater .wss-eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;margin-bottom:4px}",
  "#wss-floater .wss-price{font-size:27px;font-weight:800;letter-spacing:-.02em}",
  "#wss-floater .wss-price small{font-size:12px;font-weight:600;opacity:.7}",
  "#wss-floater .wss-waive{display:inline-block;font-size:10.5px;margin:5px 0 9px;padding:2px 7px;border-radius:999px;background:rgba(52,211,153,.14);color:#6ee7b7}",
  "#wss-floater ul.wss-stack{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:5px}",
  "#wss-floater ul.wss-stack li{font-size:11.5px;line-height:1.35;padding-left:15px;position:relative;opacity:.93}",
  "#wss-floater ul.wss-stack li:before{content:'\\2713';position:absolute;left:0;color:#34D399;font-weight:700}",
  "#wss-floater .wss-stack-note{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;margin-bottom:9px}",
  "#wss-floater .wss-btn{display:block;text-align:center;text-decoration:none;border-radius:9px;padding:9px 10px;font-size:12.5px;font-weight:700;margin-bottom:8px}",
  "#wss-floater .wss-btn-primary{background:#E5484D;color:#fff}",
  "#wss-floater .wss-btn-riley{background:#fff;color:#111;line-height:1.25}",
  "#wss-floater .wss-btn-riley small{display:block;font-weight:500;font-size:10px;opacity:.7;margin-top:2px}",
  // THE CODE, IN BIGGER WRITING — the owner's specific ask. It is the thing a
  // caller has to read aloud, so it is set larger than the body copy, spaced
  // for reading over a phone line, and selectable.
  "#wss-floater .wss-code{margin:2px 0 9px;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);text-align:center}",
  "#wss-floater .wss-code-label{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;margin-bottom:3px}",
  "#wss-floater .wss-code-value{display:block;font-size:19px;font-weight:800;letter-spacing:.09em;user-select:all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
  "#wss-floater .wss-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34D399;margin-right:6px;vertical-align:middle}",
  "#wss-floater .wss-proof{font-size:10.5px;line-height:1.4;opacity:.72;margin-bottom:9px}",
  "#wss-floater .wss-domain-row{display:flex;align-items:center;gap:6px;font-size:10.5px;opacity:.72}",
  // The close control is a real touch target (44px is the accessible minimum),
  // not a 17px glyph. On a phone the owner could not find how to dismiss this.
  "#wss-floater .wss-close{position:absolute;top:4px;right:4px;width:34px;height:34px;background:none;border:0;color:#fff;opacity:.55;font-size:20px;line-height:1;cursor:pointer;border-radius:8px}",
  "#wss-floater .wss-close:hover{opacity:1;background:rgba(255,255,255,.08)}",
  // --wss-floater-clear is measured at runtime: the height of whatever the
  // CLIENT'S site has fixed to the bottom-left of a phone screen (a sticky
  // "Call now" bar, a cookie strip). Zero until something is actually in the
  // way, so a page with a clean bottom edge is laid out exactly as before.
  "#wss-pill{position:fixed;left:16px;bottom:calc(16px + var(--wss-floater-clear,0px));z-index:99999;border:0;border-radius:999px;padding:10px 15px;font-size:12.5px;font-weight:700;background:rgba(15,15,17,.86);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif}",
  // The pill is the only thing of ours a phone shows unprompted, so on a phone
  // it is a CHIP: the second clause of the label is desktop reading. A 200px
  // bar across the bottom-left of a 390px screen is a wide target to have to
  // dodge the client's own controls around.
  "@media(max-width:760px){#wss-pill .wss-pill-more{display:none}}",

  // ---- PHONES ------------------------------------------------------------
  // Owner: "it would take over the whole screen and not even be clear on how to
  // minimize it." A full-width sheet at 76vh was doing exactly that. On a phone
  // this is a SMALL card, not a takeover: capped width, capped height, tighter
  // type, a 44px close target, and a tap-anywhere-outside backdrop. Someone
  // looking at their own new site must be able to dismiss us in one tap.
  "@media(max-width:760px){",
  "#wss-floater{left:max(10px,env(safe-area-inset-left));right:auto;top:auto;bottom:calc(64px + var(--wss-floater-clear,0px));transform:none}",
  "#wss-floater .wss-card{width:min(74vw,250px);max-height:52vh;padding:11px 12px;border-radius:12px}",
  "#wss-floater .wss-price{font-size:21px}",
  "#wss-floater ul.wss-stack li{font-size:10.5px;line-height:1.3}",
  "#wss-floater .wss-proof{display:none}",           // the long blurb is desktop reading
  "#wss-floater .wss-domain-row{display:none}",
  "#wss-floater .wss-close{width:44px;height:44px;font-size:24px;opacity:.8;background:rgba(255,255,255,.1)}",
  "#wss-floater .wss-code-value{font-size:17px}",
  // The pill is what a phone gets on load, so it is the element that has to
  // stay out of the client's way: lifted above their bottom bar, and inside
  // the safe area on a notched phone.
  "#wss-pill{left:max(10px,env(safe-area-inset-left));bottom:calc(max(12px,env(safe-area-inset-bottom)) + var(--wss-floater-clear,0px));padding:9px 13px;font-size:12px;max-width:calc(100vw - 78px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  "}",
  // The backdrop only exists on phones, and only while the card is open.
  "#wss-scrim{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.35);border:0;padding:0;display:none}",
  "@media(max-width:760px){#wss-scrim.on{display:block}}",
  "@media(prefers-reduced-motion:reduce){#wss-floater *{transition:none!important;animation:none!important}}",
].join("");

const MARK = '<svg width="22" height="22" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="50" cy="20" r="5" fill="#34D399"/></svg>';

// THE PRICE, WRITTEN ONCE. The waived setup fee is struck through on the panel
// exactly as it is in the proof email (lib/outreach-email-v3.js), because the
// same person reads both and the reciprocity beat only works if the number is
// the same one. $499 here vs $500 there was not a rounding difference — it was
// two teams' worth of drift on the one line that costs money.
const SETUP_FEE = "500";

// THE PANEL SELLS WHAT THE ENGINE BUILT, AND NOTHING ELSE.
//
// The reader of this panel is standing on the mirror. Every line here is
// checkable against the page behind it in about four seconds, so a line the
// engine does not produce is not just untrue — it is untrue in front of the
// evidence. Three of the five were, measured 2026-08-08:
//
//   * "mined, excavated & remastered" — client-photos.js harvests the
//     prospect's own photographs, proves ownership, refuses stock and
//     third-party marks, dedupes by content hash and RANKS them (that ranking
//     is what decides which two fill a two-slot donor). It never transforms a
//     pixel. transcodePhoto() is a container conversion for MIME correctness
//     and needs an ffmpeg the serverless runtime does not carry. "Mined" and
//     "excavated" are fair descriptions of the harvest; "remastered" is not.
//   * "Cinematic hero video — built for your business" — the motion layer is
//     the DONOR's. Nothing in this lane generates video: lib/veo-ambiance.js
//     is required only by lib/siteforge.js, belongs to the other lane, and
//     returns [] unless GHOST_AGENCY_VEO_AMBIANCE is on (default off).
//   * "AI-generated imagery" — nothing generates an image anywhere in the
//     mirror lane, and TRUTH LAW would refuse to put a fabricated picture of
//     a business on that business's own website even if something did.
//
// "Local competitor & search research — built into your pages" was narrowed
// for the same reason the email narrowed it on 2026-08-07: the competitor
// ranking is real, and it lives in the Signal report, not in the mirror. What
// IS in the pages is the service-area set, and those towns are measured — a
// ring sampled around the verified coordinates and resolved against the US
// Census geocoder (nearby-cities.js), precisely so no mirror ships the ten
// invented neighbouring towns the source template did.
const BENEFITS = [
  "Your photos, logo &amp; brand &mdash; mined from your own site",
  "Your pages written from your real services &amp; reviews",
  "The towns you serve &mdash; measured, never invented",
  "Your local competitors &mdash; ranked in your report",
  "Hosting, SSL, lead capture &amp; unlimited edits",
];

/**
 * buildSignupFloater({ clientId, rileyTel, rileyDisplay, checkoutUrl, domain, price })
 *   -> "" | html
 *
 * Returns "" when there is nothing legitimate to show (no checkout and no
 * Riley line), rather than a card that only advertises a price.
 */
function buildSignupFloater({
  clientId = "",
  rileyTel = "",
  rileyDisplay = "",
  checkoutUrl = "",
  domain = "",
  // ONE PRICE, EVERYWHERE. The panel said $199/$499 while the proof email that
  // brought the reader here said $149/$500-waived — two numbers for one product,
  // on two surfaces the same person sees minutes apart. The owner's price is
  // $149/mo with the $500 setup fee waived; see PRICE/SETUP_FEE below.
  price = "149",
} = {}) {
  const hasRiley = /^tel:/i.test(String(rileyTel));
  const hasCheckout = /^https:\/\//i.test(String(checkoutUrl));
  if (!hasRiley && !hasCheckout) return "";

  // HARD-CODED ON. Only an explicit `0` restores the historical desktop
  // auto-open behavior; every other value, including unset, protects the
  // client's first-paint hero with the pill-first experience.
  const pillFirst = process.env.GHOST_AGENCY_FLOATER_PILL_FIRST !== "0";

  const card = [
    '<div class="wss-card" id="wss-plan-card" hidden>',
    '<button class="wss-close" type="button" aria-label="Minimize" title="Minimize">&#8211;</button>',
    `<div class="wss-brand">${MARK}<span class="wss-brand-name">WSS Labs<small>site &amp; AI team</small></span></div>`,
    '<div class="wss-eyebrow">This site was built for you</div>',
    `<div><span class="wss-price">&#36;${esc(price)}<small>.00/mo</small></span></div>`,
    `<span class="wss-waive"><s>&#36;${esc(SETUP_FEE)} setup fee</s> &mdash; waived today</span>`,
    `<ul class="wss-stack">${BENEFITS.map((b) => `<li>${b}</li>`).join("")}</ul>`,
    '<div class="wss-stack-note">All included today</div>',
    hasCheckout
      ? `<a class="wss-btn wss-btn-primary" href="${esc(checkoutUrl)}" target="_blank" rel="noopener">&#36; Launch my site now &#8594;</a>`
      : "",
    // Riley, and the code they read to her.
    hasRiley
      ? `<a class="wss-btn wss-btn-riley" href="${esc(rileyTel)}"><span class="wss-live-dot"></span>Call your own private web developer${rileyDisplay ? `<small>${esc(rileyDisplay)} &mdash; 24/7, never a hold queue</small>` : "<small>24/7, never a hold queue</small>"}</a>`
      : "",
    clientId
      ? `<div class="wss-code"><span class="wss-code-label">Your client ID</span><span class="wss-code-value">${esc(clientId)}</span></div>`
      : "",
    hasRiley
      ? '<div class="wss-proof"><b>Don&rsquo;t take our word &mdash; test it.</b> Call Riley, read her your client ID, and ask for one change: swap the video, reword a headline, change a photo. Watch this site update while you&rsquo;re on the phone.</div>'
      : "",
    domain
      ? `<div class="wss-domain-row"><span class="wss-live-dot"></span><span><b>${esc(domain)}</b> &mdash; included free</span></div>`
      : "",
    "</div>",
  ].filter(Boolean).join("");

  // The script is deliberately tiny and silent: renderCheck fails a build on a
  // single console error, and this panel is never worth failing a mirror over.
  const script = [
    "(function(){try{",
    "var f=document.getElementById('wss-floater'),c=f&&f.querySelector('.wss-card'),p=document.getElementById('wss-pill');",
    "if(!f||!c||!p)return;",
    // A proof shot is a picture of the CLIENT'S site. Our upsell must not be in
    // it — and the PILL is server-rendered markup, so simply returning early
    // left "$149 site plan" sitting in the "your new site" thumbnail. Both
    // elements are removed outright.
    //
    // THIS LINE KEEPS EVERY OPEN PATH OUT OF PROOF SHOTS. It runs before a pill
    // click or the rollback-only desktop auto-open, and the card is `hidden` in
    // the markup until open() unhides it — so on a ?wssthumb=1 load there is
    // nothing left to open and nothing to photograph.
    "if(/[?&]wssthumb=1/.test(location.search)){f.remove();p.remove();var sc=document.getElementById('wss-scrim');if(sc)sc.remove();return;}",
    "var s=document.getElementById('wss-scrim');",
    "var root=document.documentElement;",
    // ONE definition of "phone", shared with the CSS above. 760px is the phone
    // media query's own breakpoint; reading it back through matchMedia keeps
    // the open/closed decision and the layout from disagreeing.
    "function phone(){try{return window.matchMedia('(max-width:760px)').matches;}catch(e){return (window.innerWidth||1281)<=760;}}",
    // A visitor who closes us keeps that choice for the session. The default
    // pill never auto-opens; this still prevents the rollback mode from
    // reopening the card on every page they click through.
    "var KEY='wss_floater_dismissed_v1';",
    "function remember(v){try{if(v)sessionStorage.setItem(KEY,'1');else sessionStorage.removeItem(KEY);}catch(e){}}",
    "function dismissed(){try{return sessionStorage.getItem(KEY)==='1';}catch(e){return false;}}",
    // The scrim is a PHONE affordance — its only display rule lives inside the
    // phone media query. Raising it on a desktop put an invisible "modal" on
    // the page that the client's chat widget reads as a blocker and hides
    // itself behind (chat-widget.js syncOverlay). This remains important for a
    // pill click and for the rollback-only desktop auto-open.
    "function scrim(){if(s)s.className=(!c.hidden&&phone())?'on':'';}",

    // ---- WHAT WE ARE NOT ALLOWED TO COVER, MEASURED ------------------------
    // Two shared helpers. `ours` keeps every scan from finding this panel and
    // treating it as the client's own furniture; `vis` is the same "actually on
    // screen" test the chat widget uses, because an element that is display:none
    // or transparent is not something a visitor can be blocked from clicking.
    "function ours(el){return !el||el===f||el===p||el===s||f.contains(el)||String(el.id||'').indexOf('wss-')===0;}",
    "function vis(el){try{var st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')return false;if(Number(st.opacity)<0.06)return false;var r=el.getBoundingClientRect();return r.width>=8&&r.height>=8;}catch(e){return false;}}",
    // Every control of the CLIENT'S that lands inside a given rectangle. This is
    // the thing the panel must not sit on top of: a link or a button the visitor
    // came to press. Tiny icons are ignored (they are almost always inside a
    // bigger control that is itself in the list).
    "var CTRL='a,button,input,select,textarea,summary,[role=\"button\"],[role=\"link\"],[onclick]';",
    "function controls(x0,x1,y0,y1){var out=[],vh=window.innerHeight||0,els=[];",
    "try{els=Array.prototype.slice.call(document.querySelectorAll(CTRL));}catch(e){}",
    "for(var i=0;i<els.length;i++){var el=els[i];if(ours(el)||!vis(el))continue;",
    "var r=el.getBoundingClientRect();",
    "if(r.width<28||r.height<20)continue;",
    "if(r.bottom<=y0||r.top>=y1||r.right<=x0||r.left>=x1)continue;",
    "out.push([Math.max(0,r.top),Math.min(vh,r.bottom)]);}",
    "out.sort(function(a,b){return a[0]-b[0];});return out;}",

    // THE HEADER HEIGHT IS MEASURED, NOT GUESSED — the donors differ, and the
    // number that matters is where THIS donor stopped drawing its bar. Two
    // independent readings, unioned, because either one alone has a blind spot:
    //
    //   · the bars actually painted along the top edge (elementsFromPoint at
    //     y=3, plus the header/nav/banner elements), grown downward while
    //     anything else starts within 10px of the current bottom — that chains
    //     an announcement strip above a nav bar, which reading only the first
    //     element would stop short of and leave the logo underneath us;
    //   · the client's MARK itself. A donor can hang the logo below its bar (a
    //     centred lockup that overhangs), and the logo is the specific thing
    //     this defect covered, so it is measured directly rather than inferred.
    //
    // Both are capped at 45% of the viewport: a full-bleed hero whose class
    // happens to contain "header" is not a header, and neither is a masthead
    // image the width of the page.
    "function headerBottom(x1){var vw=window.innerWidth||0,vh=window.innerHeight||0,cap=vh*0.45,b=0,cand=[];",
    "try{cand=Array.prototype.slice.call(document.querySelectorAll('header,[role=\"banner\"],[class*=\"header\" i],[class*=\"navbar\" i],[class*=\"topbar\" i],[class*=\"masthead\" i],nav'));}catch(e){}",
    "try{if(document.elementsFromPoint){var xs=[8,Math.round(vw/4),Math.round(vw/2),Math.round(vw*3/4),Math.max(0,vw-8)];",
    "for(var i=0;i<xs.length;i++){var st=document.elementsFromPoint(xs[i],3)||[];for(var j=0;j<st.length;j++)cand.push(st[j]);}}}catch(e){}",
    "for(var pass=0;pass<4;pass++){var grew=b;",
    "for(var k=0;k<cand.length;k++){var el=cand[k];",
    "if(!el||el===document.body||el===root||ours(el)||!vis(el))continue;",
    "var r=el.getBoundingClientRect();",
    "if(r.top>b+10||r.bottom<=0)continue;",
    "if(r.width<vw*0.55)continue;",
    "if(r.height>cap)continue;",
    "if(r.bottom>grew)grew=r.bottom;}",
    "if(grew<=b)break;b=grew;}",
    // …and the mark. Only small images in OUR column and in the top band count:
    // a hero photograph is not a logo, so anything wider than 60% of the page or
    // taller than a third of the screen is excluded by size.
    "var marks=[];try{marks=Array.prototype.slice.call(document.querySelectorAll('img,svg,picture,[class*=\"logo\" i],[id*=\"logo\" i],[class*=\"brand\" i]'));}catch(e){}",
    "for(var m=0;m<marks.length;m++){var mk=marks[m];if(ours(mk)||!vis(mk))continue;",
    "var mr=mk.getBoundingClientRect();",
    "if(mr.top>cap||mr.left>=x1)continue;",
    "if(mr.width<24||mr.height<14)continue;",
    "if(mr.width>vw*0.6||mr.height>vh*0.34)continue;",
    "if(mr.bottom>b)b=mr.bottom;}",
    "return Math.max(0,Math.min(Math.round(b),Math.round(cap)));}",

    // ---- PLACING THE OPEN CARD ---------------------------------------------
    // Once the visitor opens the card (or rollback mode auto-opens it), it moves
    // to the tallest clear band in the left gutter: below the header, and not
    // across one of the client's controls. It scrolls internally, so a shorter
    // band costs reading room rather than content.
    //
    // If no band is big enough to be worth opening into, we fall back to "below
    // the header, full remaining height" — the header invariant is absolute, the
    // control-avoidance is best-effort — and say which happened in
    // data-wss-placement, so a render can tell the two apart instead of guessing.
    "var MIN_BAND=200;",
    "function placeCard(){try{",
    "if(!c||c.hidden||phone())return;",
    "var vh=window.innerHeight||1,cr=c.getBoundingClientRect(),x0=cr.left-6,x1=cr.right+6;",
    "var lo=Math.round(headerBottom(x1))+12,hi=Math.max(lo+40,Math.round(vh)-16);",
    "root.style.setProperty('--wss-floater-top',lo+'px');",
    "root.style.setProperty('--wss-floater-maxh',(hi-lo)+'px');",
    "var need=Math.min(c.scrollHeight+4,hi-lo);",
    "var bands=controls(x0,x1,lo,hi),gaps=[],cur=lo;",
    "for(var i=0;i<bands.length;i++){var bd=bands[i];",
    "if(bd[1]<=cur)continue;",
    "var end=Math.min(bd[0]-8,hi);if(end-cur>=40)gaps.push([cur,end]);",
    "cur=Math.max(cur,bd[1]+8);if(cur>=hi)break;}",
    "if(hi-cur>=40)gaps.push([cur,hi]);",
    "var best=null,g;",
    "for(g=0;g<gaps.length;g++)if(gaps[g][1]-gaps[g][0]>=need){best=gaps[g];break;}",
    "if(!best)for(g=0;g<gaps.length;g++)if(!best||(gaps[g][1]-gaps[g][0])>(best[1]-best[0]))best=gaps[g];",
    "if(best&&(best[1]-best[0])>=MIN_BAND){",
    "root.style.setProperty('--wss-floater-top',Math.round(best[0])+'px');",
    "root.style.setProperty('--wss-floater-maxh',Math.round(Math.min(need,best[1]-best[0]))+'px');",
    "f.setAttribute('data-wss-placement','clear');",
    "}else f.setAttribute('data-wss-placement','header-only');",
    "}catch(e){}}",

    "function scrim(){if(s)s.className=(!c.hidden&&phone())?'on':'';}",
    // placeCard runs in the SAME synchronous block that unhides the card, so the
    // browser never paints the un-placed position — there is no frame in which
    // the panel is over the logo.
    "function open(){c.hidden=false;placeCard();p.style.display='none';p.setAttribute('aria-expanded','true');scrim();}",
    "function shut(){c.hidden=true;p.style.display='';p.setAttribute('aria-expanded','false');scrim();}",
    "p.addEventListener('click',function(){remember(false);open();});",
    "var x=c.querySelector('.wss-close');if(x)x.addEventListener('click',function(){remember(true);shut();});",
    // On a phone, tapping the page outside the card closes it — the gesture
    // people already expect, so nobody is trapped hunting for a control.
    "if(s)s.addEventListener('click',function(){remember(true);shut();});",
    "document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!c.hidden){remember(true);shut();}});",

    // ---- KEEPING OFF THE CLIENT'S BOTTOM BAR --------------------------------
    // Donors park sticky "Call now" bars at the bottom of a phone screen, and
    // the pill is the one thing of ours a phone shows unprompted. Measure what
    // is fixed to the bottom-LEFT and lift by that much — never guess an
    // offset. Same mechanism as the chat widget's --wss-chat-clear, sampling
    // the other side of the screen. Our own elements are skipped by id.
    //
    // AND OFF THE CLIENT'S CTA. A bottom bar is the easy case because it is
    // fixed; the hard case is an in-flow "Request a quote" button that happens
    // to land in the bottom-left of the first screen, which is where several of
    // these donors put it — the pill was measured sitting on top of exactly that
    // at 390. The second scan below hit-tests the pill's OWN rectangle against
    // the client's controls and lifts until it is clear, starting from the
    // unlifted position every pass so the lift can never ratchet itself upward
    // across repeated measurements.
    "var clearTimer=null;",
    "function measure(){clearTimer=null;try{",
    "if(!phone()||!document.elementsFromPoint){root.style.setProperty('--wss-floater-clear','0px');return;}",
    "root.style.setProperty('--wss-floater-clear','0px');",
    "var vh=window.innerHeight||0,vw=window.innerWidth||0,clear=0,seen=[],xs=[12,64,150,Math.round(vw/2)],ys=[vh-2,vh-20,vh-48,vh-80];",
    "for(var i=0;i<xs.length;i++){for(var j=0;j<ys.length;j++){",
    "if(xs[i]<0||ys[j]<0)continue;",
    "var stack=document.elementsFromPoint(xs[i],ys[j])||[];",
    "for(var k=0;k<stack.length;k++){var el=stack[k];",
    "if(!el||el===root||el===document.body||seen.indexOf(el)>=0)continue;seen.push(el);",
    "if(String(el.id||'').indexOf('wss-')===0||f.contains(el))continue;",
    "var st=getComputedStyle(el);",
    "if(st.position!=='fixed'&&st.position!=='sticky')continue;",
    "if(st.display==='none'||st.visibility==='hidden'||st.pointerEvents==='none')continue;",
    "var r=el.getBoundingClientRect();",
    "if(r.width<44||r.height<24||r.top>=vh||r.bottom<vh-28)continue;",
    "if(r.left>Math.min(vw,320))continue;",
    "clear=Math.max(clear,vh-r.top+10);}}}",
    // Capped: a bar taller than a third of the screen is not something we can
    // climb over, and shoving the pill into the middle of the page would be a
    // worse intrusion than sitting near it.
    "var CAP=Math.min(280,vh*0.34);",
    "clear=Math.min(clear,CAP);",
    // …AND OFF THE CLIENT'S OWN CONTROLS. The pill's rectangle is read with the
    // lift reset to zero, so every pass starts from the same baseline and the
    // lift can never ratchet across repeated measurements.
    //
    // WHY THIS IS A SEARCH AND NOT A LOOP THAT KEEPS CLIMBING. The first version
    // lifted above whatever it hit and tried again, which on the roofing donor
    // at 390 walked the pill 200px up a stack of five service links and parked
    // it on the fifth — measured, not imagined. So the whole travel band is
    // enumerated instead: the resting place, and the slot just above each of the
    // client's controls. Candidates are tried from the LOWEST up, so the pill
    // moves as little as it has to, and the first one that covers nothing wins.
    // If nothing in reach is clear, the least-covering candidate wins — which in
    // the worst case is the bottom-bar lift we started from, i.e. exactly the
    // old behaviour, never worse than it.
    "if(p&&getComputedStyle(p).display!=='none'){",
    "var pr=p.getBoundingClientRect(),px=pr.left,pw=pr.width,ph=pr.height,pbot=pr.bottom;",
    "if(pw>4&&ph>4){",
    "var hiY=pbot-clear,loY=pbot-CAP-ph;",
    "var bands=controls(px-4,px+pw+4,loY-2,hiY+2),cands=[hiY];",
    "for(var b=0;b<bands.length;b++)cands.push(bands[b][0]-8);",
    "cands.sort(function(a,b){return b-a;});",
    "var bestBot=hiY,bestArea=-1;",
    "for(var e=0;e<cands.length;e++){var bt=cands[e],tp=bt-ph;",
    "if(bt>hiY||pbot-bt>CAP||tp<loY-2)continue;",
    "var ar=0;",
    "for(var b2=0;b2<bands.length;b2++){var ov=Math.min(bt,bands[b2][1])-Math.max(tp,bands[b2][0]);if(ov>0)ar+=ov;}",
    "if(bestArea<0||ar<bestArea){bestArea=ar;bestBot=bt;}",
    "if(!ar)break;}",
    "clear=Math.max(0,Math.min(Math.round(pbot-bestBot),CAP));}}",
    "root.style.setProperty('--wss-floater-clear',Math.max(0,Math.round(clear))+'px');",
    "}catch(e){}}",
    "function queue(){if(clearTimer)clearTimeout(clearTimer);clearTimer=setTimeout(measure,90);}",
    // The card is re-placed on load and on resize, and NOT on scroll: the
    // obstacles it dodges are the ones on screen when it opened, and a panel
    // that hops around as you scroll would be a worse intrusion than the one
    // being fixed. The pill, which is what a phone gets, does track scroll —
    // it is small, and what it must not cover moves.
    "function replace_(){if(!phone())placeCard();}",
    "queue();setTimeout(queue,900);setTimeout(queue,2400);",
    "setTimeout(replace_,700);setTimeout(replace_,2000);",
    "window.addEventListener('resize',function(){scrim();queue();replace_();},{passive:true});",
    "window.addEventListener('scroll',queue,{passive:true});",

    // ---- AND FINALLY, HONOR THE ROLLBACK SWITCH -----------------------------
    // Default: leave the hidden card alone and show the pill on every viewport.
    // Rollback only: restore the old desktop auto-open, still respecting the
    // visitor's session dismissal and still never auto-opening on a phone.
    pillFirst ? "" : "if(!phone()&&!dismissed())open();",
    "}catch(e){}})();",
  ].join("");

  return `<style id="wss-floater-css">${CSS}</style>`
    + '<button id="wss-scrim" type="button" aria-label="Close" tabindex="-1"></button>'
    + `<div id="wss-floater">${card}</div>`
    // The pill is a real disclosure control now that it has two states worth
    // telling a screen reader apart: it IS the closed state of the card.
    + `<button id="wss-pill" type="button" aria-controls="wss-plan-card" aria-expanded="false">&#36;${esc(price)} site plan<span class="wss-pill-more"> &middot; see what&rsquo;s included</span></button>`
    + `<script>${script}</script>`;
}

// The environment this panel is configured from. Named as data so a refusal can
// print the variable an operator actually has to set, instead of "unconfigured".
// Re-exported under its historical name here because callers and tests already
// read CHECKOUT_ENV_NAME off this module; lib/checkout-links.js owns the value.
const CHECKOUT_ENV_NAME = CHECKOUT_URL_ENV_NAME;

/**
 * resolveSignupConfig({ prospect, facts, slug, env, resolveRileyLine })
 *   -> { ok, signup, reason, warnings, diagnostics }
 *
 * THE ONE READER. Every build path asks THIS function what the sign-up panel
 * should contain; none of them assembles the object itself.
 *
 * WHY THIS FUNCTION EXISTS AT ALL
 * lib/mirror-lane-build.js has two build paths — the LeadMiner truth-packet
 * path and the resolver path. The packet path built a `signup` object inline;
 * the resolver path had no `signup` key at all. Nothing failed, because
 * content-inject treats an absent config as "no panel wanted": `const floater =
 * signup ? buildSignupFloater(signup) : ""`. So every mirror built from a
 * seeded or mined prospect — which is every one of the four live plumbing
 * mirrors, verified on the served bytes 2026-08-06 — shipped with no Client ID,
 * no Riley CTA and no price. The revenue surface was missing and no report said
 * so. This is the same defect class as the logo that reached one build path and
 * not the other, and it gets the same answer: ONE reader, no second opinion.
 *
 * NOTHING HERE IS A LITERAL. Riley's line resolves through lib/riley-line (the
 * module that exists because a retired number once printed itself from a
 * fallback) and the Client ID is DERIVED by lib/client-reference from the
 * prospect id, so the code on the panel is the same code the email prints and
 * the same code Riley recomputes when it is read to her over the phone.
 *
 * `ok:false` is a real answer, not an error: it means there is nothing
 * legitimate to show — no Riley line and no checkout — and the caller must
 * record that fact rather than quietly rendering nothing.
 */
function resolveSignupConfig({
  prospect = {},
  facts = {},
  slug = "",
  env = process.env,
  resolveRileyLine = defaultResolveRileyLine,
  prospectCheckoutUrl = defaultProspectCheckoutUrl,
} = {}) {
  // allowAgencyLine is TRUE because this panel speaks for the agency: it opens
  // with the WSS Labs mark and "site & AI team", so the number reads as our
  // concierge, never as a second number on the client's own front desk.
  const riley = resolveRileyLine({ client: prospect, facts, env, allowAgencyLine: true }) || {};
  const clientId = clientReferenceCode(prospect);
  // THE BUY LINK IS MINTED PER PROSPECT, not read out of one static variable.
  // GHOST_AGENCY_CHECKOUT_URL has never been set in production, so this panel
  // shipped with no way to pay on every mirror the line ever built — while
  // lib/checkout-links.js sat one require away with a signed, prospect-bound
  // link the checkout route already knows how to verify. That URL still wins
  // when an operator sets it; otherwise we mint. "" means no button, never a
  // dead one — see prospectCheckoutUrl for both fail-closed cases.
  const checkoutUrl = String(prospectCheckoutUrl({ prospect, env }) || "").trim();
  const hasCheckout = /^https:\/\//i.test(checkoutUrl);
  const hasRiley = /^tel:/i.test(String(riley.telHref || ""));
  const domain = slug ? `${slug}.wss-ai.com` : "";

  const warnings = [];
  if (!clientId) warnings.push("no_client_id");
  if (!hasRiley) warnings.push(`no_riley_line:${riley.reason || "unresolved"}`);
  if (!hasCheckout) warnings.push(`no_checkout_url:${CHECKOUT_ENV_NAME}|${CHECKOUT_SECRET_ENV_NAME}`);

  const diagnostics = {
    client_id: clientId || "",
    riley_display: hasRiley ? String(riley.display || "") : "",
    riley_source: String(riley.source || ""),
    checkout_configured: hasCheckout,
    domain,
  };

  if (!hasRiley && !hasCheckout) {
    return {
      ok: false,
      signup: null,
      // Both halves named, because either one alone is enough to show a panel —
      // so an operator needs to know that BOTH are missing, and which is which.
      // The checkout half now has two ways to be satisfied, so both are named:
      // an explicit URL, or the signing secret a minted link needs.
      reason: `signup_panel_unconfigured: no Riley line (${riley.reason || "unresolved"}) and no checkout link (set https ${CHECKOUT_ENV_NAME} or ${CHECKOUT_SECRET_ENV_NAME})`,
      warnings,
      diagnostics,
    };
  }

  return {
    ok: true,
    signup: {
      ...(clientId ? { clientId } : {}),
      ...(hasRiley ? { rileyTel: riley.telHref, rileyDisplay: String(riley.display || "") } : {}),
      ...(hasCheckout ? { checkoutUrl } : {}),
      ...(domain ? { domain } : {}),
    },
    reason: "",
    warnings,
    diagnostics,
  };
}

module.exports = {
  buildSignupFloater,
  resolveSignupConfig,
  CHECKOUT_ENV_NAME,
  CHECKOUT_SECRET_ENV_NAME,
  SETUP_FEE,
  FLOATER_CSS: CSS,
};
