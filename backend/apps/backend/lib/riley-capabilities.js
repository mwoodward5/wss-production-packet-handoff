"use strict";

// lib/riley-capabilities.js — the honest answer to "can you do that?"
//
// WHY THIS FILE EXISTS. Riley has one universal tool (request_site_change) that
// accepts any change in plain words. That is the right shape — the owner's own
// point, that a smart agent needs eyes and not twelve hands. But a tool that
// accepts ANY sentence will also accept sentences the executor cannot execute,
// and the model, having no idea where the floor is, says yes to them. On a live
// call that becomes a promise: "I'll get that video swapped out for you" for a
// verb that does not exist, followed ten minutes later by a refusal the caller
// has to be told about.
//
// So the floor is written down HERE, once, from the executor's real verb list.
//
// THE VERB LIST IS NOT AN OPINION. lib/site-change-plan.js has exactly one
// place where a plan op becomes bytes: the apply loop, a chain of
// `kind === "<op>"` branches ending in `throw new Error("unknown op ...")`.
// Those branches ARE the capability surface of this product. Everything in
// EXECUTOR_VERBS below names one of them, and test/riley-capabilities.test.js
// reads the executor's source and fails if the two sets ever differ — so a verb
// added, renamed or deleted over there cannot leave Riley promising or refusing
// the wrong thing over here.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not decide whether a
// particular request will succeed. `style_override` exists, and "make the logo
// twice as big" still failed on a real site (job edit_1786487814000 family,
// 2026-08-11) because the rendered check could not prove it landed. Capability
// is the outer bound, not a forecast: this module answers "is there a verb for
// this at all", and lib/edit-timing.js answers "and how often does it land".
// Claiming more than that would be the same defect one layer up.
//
// THE ANSWER IS TIERED, NOT BINARY. Quick edits are a plain yes. Requests to
// MOVE or REORDER whole sections used to be one blanket bigger-build
// sentence; as of the 2026-08-17 power wave the SPLIT is real and honest:
// a reorder that NAMES its section and where it goes ("move the reviews
// above the gallery") is a supported edit — on a static donor the executor
// moves the bytes, and on a compiled build it comes back with the
// bigger-build sentence at apply time. A generic reorder with no names
// ("reorder the sections", "change the order around") still gets the
// bigger-build sentence up front, because nothing — not this layer, not the
// caller — has said what goes where. See TIERS below and
// lib/section-reorder.js for the parse both halves share.

/**
 * The twelve ops lib/site-change-plan.js can actually execute — eleven model
 * verbs plus the deterministic reorder lane.
 *
 * `family`  — the coarse bucket shared with lib/edit-timing.js, so a spoken
 *             duration and a spoken capability are talking about the same thing.
 * `plain`   — what it is, in the words a tradesperson uses.
 * `cues`    — phrases that indicate this verb. Ordered scanning, most specific
 *             family first (see classifyRequest); these are recognition hints,
 *             never a promise that the request will succeed.
 *
 * `reorder_section` carries NO cues on purpose: it is recognised by the shared
 * parser (lib/section-reorder.js parseSectionReorder), which both this module
 * and the executor call, so the two can never disagree about which sentences
 * are section moves. An empty cue list keeps it out of the family scan while
 * keeping it in the honest verb list.
 */
const EXECUTOR_VERBS = Object.freeze([
  Object.freeze({
    // LISTED BEFORE style_override ON PURPOSE. Both verbs are family "style",
    // and the family scan takes the FIRST verb whose cue matches, so the more
    // specific whole-site phrasings must be tested before the single-element
    // ones — "change the colour of my whole site" carries the word "colour",
    // which is a style_override cue, but a one-element verb is the wrong
    // promise for it.
    op: "restyle_site",
    family: "style",
    plain: "repaint the whole site in one new colour — every accent, button and highlight at once",
    cues: [
      /\b(?:whole|entire|complete|all)\b[^.]{0,25}\b(?:site|website|theme|palette|colou?rs?)\b/i,
      /\b(?:colou?r|colou?rs|theme|palette|recolou?r)\b[^.]{0,30}\b(?:whole|entire|everything|site|website)\b/i,
      /\bcolou?r scheme\b/i,
      /\brebrand\b/i,
    ],
  }),
  Object.freeze({
    op: "style_override",
    family: "style",
    plain: "change how something looks — colour, size, spacing, position, hide or show it",
    cues: [
      /\b(colou?r|bright|dark(er)?|light(er)?|shade|hue|orange|red|blue|green|black|white|grey|gray|yellow|purple|navy|gold)\b/i,
      /\b(bigger|larger|smaller|shrink|enlarge|resize|size|twice as big|font ?size)\b/i,
      /\b(bold|italic|underline|uppercase|font ?weight)\b/i,
      /\b(move|shift|centre|center|align|left|right|top|bottom|spacing|padding|margin|rounder|rounded|corner)\b/i,
      /\b(hide|show|remove the|get rid of|take (it|that) off)\b/i,
      // "swap the logo and the call button" — an in-place exchange the element
      // catalog itself serves (the header's flex row, flex-direction:row-reverse),
      // so it is a quick edit. Found while pinning the tier scan: this sentence
      // fell to out_of_scope and would have been spoken the one refusal —
      // for a change the executor does standing on its head. Image swaps are
      // scanned first (FAMILY_ORDER), so "swap the hero image" still lands image.
      /\bswap\b[^.]{0,60}\b(?:and|with|for)\b/i,
    ],
  }),
  Object.freeze({
    op: "replace_copy",
    family: "copy",
    plain: "re-word something already written on the page",
    cues: [
      /\b(change|reword|re-word|rewrite|fix|update|correct)\b[^.]{0,40}\b(headline|heading|title|wording|words|text|line|sentence|caption|label|tagline)\b/i,
      /\bshould (say|read)\b/i,
      /\bmake it say\b/i,
      /\bchange .{0,60}\bto say\b/i,
      // Contact details — "change my phone number to 555-1234", "change the
      // phone number on the site", "update our hours". These are the VAPI
      // tool description's OWN examples (api/admin/vapi-assistants.js), and
      // the executor re-words exactly this text in its replace_copy branch —
      // but the classifier refused all three and Riley spoke the one refusal
      // for the product's own advertised edits. The contact noun must sit
      // near an update VERB, so the styling sentences keep their verb:
      // "make the phone number bold" has no update verb and still scans as
      // style, and "we answer the phone twenty four hours a day" has no
      // update verb either, so it stays a content block.
      /\b(change|update|fix|correct|reword|re-word|rewrite|revise|amend|edit|replace)\b[^.]{0,40}\b(phone|mobile|cell|tel|telephone|fax|e-?mail|address|opening|hours|contact|numbers?)\b/i,
      /\b(new|different)\b[^.]{0,20}\b(phone|mobile|cell|tel|telephone|fax|e-?mail|address|opening|hours|contact|numbers?)\b/i,
    ],
  }),
  Object.freeze({
    op: "replace_text",
    family: "copy",
    plain: "replace an exact piece of text we can see on the page",
    cues: [
      /\breplace\b[^.]{0,30}\bwith\b/i,
      /\bswap .{0,30}\b(word|words|text|phrase)\b/i,
      // The noun-driven contact form: "the phone number is wrong on the
      // site", "our hours have changed" — the caller states the fact, not
      // the verb. The trigger after the noun (wrong / changed / updated /
      // now) is what keeps "we answer the phone twenty four hours a day"
      // from landing here — that sentence carries no trigger, and stays a
      // content block.
      /\b(phone|mobile|cell|tel|telephone|fax|e-?mail|address|hours|contact|numbers?)\b[^.]{0,30}\b(is wrong|are wrong|was wrong|were wrong|changed|has changed|have changed|updated|is now|are now)\b/i,
    ],
  }),
  Object.freeze({
    op: "copy_block",
    family: "content_block",
    plain: "add a new block of words next to something already on the page",
    cues: [
      /\badd (a )?(line|paragraph|sentence|section|note|blurb|bit)\b/i,
      /\bput a (line|note|paragraph|sentence)\b/i,
      /\bmention (that|we)\b/i,
    ],
  }),
  Object.freeze({
    op: "insert_html",
    family: "content_block",
    plain: "add a new visible element next to an existing heading",
    cues: [/\badd (a )?(button|banner|box|badge|callout)\b/i],
  }),
  Object.freeze({
    op: "swap_image",
    family: "image",
    plain: "put a different picture in place of one already on the site",
    cues: [
      /\b(photo|picture|image|pic|shot|headshot|logo)\b[^.]{0,40}\b(swap|change|replace|use|put|instead)\b/i,
      /\b(swap|change|replace|use|put)\b[^.]{0,40}\b(photo|picture|image|pic|shot|headshot)\b/i,
      /\bhero (image|photo|picture)\b/i,
    ],
  }),
  Object.freeze({
    // THE HERO VIDEO. A BIGGER-BUILD tier verb, deliberately NOT a quick edit:
    // the clip is a generated Seedance video pulled from the client's own
    // approved store, verified against its recorded sha256, then attached and
    // render-checked — a genuinely longer job than a colour change, and the
    // capability answer says so instead of promising instant. The cues are
    // recognition hints only; they never promise the swap will succeed (a site
    // with no approved clip in the store is refused at apply time, out loud).
    op: "set_hero_video",
    family: "hero_video",
    tier: "bigger_build",
    plain: "swap the hero video for a new one we generate for the business — a generated clip from their own approved video store, checked on the live page before it is called done",
    cues: [
      /\bhero video\b[^.]{0,40}\b(swap|change|replace|new|different|another|update|regenerate|out)\b/i,
      /\b(swap|change|replace|regenerate|update)\b[^.]{0,40}\bhero video\b/i,
      /\b(new|another|different)\b[^.]{0,20}\bhero video\b/i,
      /\b(generate|make|create|build|do)\b[^.]{0,30}\b(us |me )?(a |another |some )?(new|different)\b[^.]{0,20}\bvideo\b/i,
      /\b(swap|regenerate)\b[^.]{0,30}\bvideo\b/i,
      /\b(new|another|different)\b[^.]{0,25}\bvideo\b[^.]{0,25}\b(for|on)\b[^.]{0,25}\b(site|page|website|hero)\b/i,
      /\bseedance\b/i,
    ],
  }),
  Object.freeze({
    op: "tracking_tag",
    family: "tracking",
    plain: "install an analytics or advertising tag",
    cues: [
      /\b(google analytics|analytics|gtm|tag manager|ga4|google ads|meta pixel|facebook pixel|clarity)\b/i,
      /\b(G-[A-Z0-9]{6,}|GTM-[A-Z0-9]{4,}|AW-\d{6,})\b/,
    ],
  }),
  Object.freeze({
    op: "seo_page",
    family: "new_page",
    plain: "add a new page for one service the business already offers",
    cues: [/\bnew page\b/i, /\b(add|build|create|make) (a|another) page\b/i, /\bservice page\b/i, /\blanding page\b/i],
  }),
  Object.freeze({
    op: "legal_page",
    family: "new_page",
    plain: "add a privacy page",
    cues: [/\bprivacy (policy|page)\b/i],
  }),
  Object.freeze({
    op: "undo",
    family: "undo",
    plain: "put the site back the way it was before the last change",
    cues: [/\b(undo|revert|put it back|change it back|roll ?back|restore)\b/i],
  }),
  Object.freeze({
    op: "reorder_section",
    family: "structural",
    plain: "move a whole section above or below another one — 'the reviews above the gallery'",
    cues: [],
  }),
]);

/** Families in scanning order. Most specific first: "undo the privacy page" is
 *  an undo, not a new page; "add my Google Analytics" is tracking, not a block
 *  of copy. Order is the whole classifier — see the tests that pin it.
 *  "structural" is absent on purpose: reorder_section is recognised by the
 *  shared parser in classifyRequest, never by the cue scan. "hero_video" sits
 *  ahead of "image" so a video sentence is never mistaken for a picture one
 *  (and ahead of "style", whose swap-near-for cue would otherwise catch
 *  "swap the hero video for a new one"). */
const FAMILY_ORDER = Object.freeze(["undo", "tracking", "new_page", "hero_video", "image", "copy", "content_block", "style"]);

/** Every family the executor can reach, derived — never typed twice. */
const FAMILIES = Object.freeze([...new Set(EXECUTOR_VERBS.map((v) => v.family))]);

/** Families whose verbs run on the bigger-build tier, derived from the verbs
 *  that carry `tier: "bigger_build"` — never typed twice. */
const BIGGER_BUILD_FAMILIES = Object.freeze(
  FAMILIES.filter((f) => EXECUTOR_VERBS.some((v) => v.family === f && v.tier === "bigger_build")),
);

/** The quick-edit families: everything the model-planned verbs cover that is
 *  NOT tiered separately. The structural family is tiered separately (a named
 *  section move is a real edit, but it is not a styling verb), and so is the
 *  hero-video family: a generated clip swap is a real edit whose honest answer
 *  is "yes — and it is a bigger build than a colour change", never "instant". */
const QUICK_FAMILIES = Object.freeze(
  FAMILIES.filter((f) => f !== "structural" && !BIGGER_BUILD_FAMILIES.includes(f)),
);

// The ONE parser both halves of the system consult. lib/site-change-plan.js
// runs it to execute; this module runs it to answer "can you do that?" — the
// same function, the same sentence, so a promised reorder is always an
// attempted reorder and a refused one is always refused for a reason the
// executor actually hit. It has no requires, so this edge cannot cycle.
const { parseSectionReorder } = require("./section-reorder");

// ---------------------------------------------------------------------------
// TIERS — "yes", "bigger build", and "not ours"
// ---------------------------------------------------------------------------
// The owner's directive, after reading ~50 live calls: a capability answer is
// not a binary. Simple edits (text, colour, size, photo) are always yes.
// STRUCTURAL work — moving whole sections around, chiefly — is not a quick
// edit, and the honest answer is not "I can't", permanently, but "that one's
// a bigger build; here is what I CAN do right now". A follow-up wave will
// make structural edits real, so nothing here may hard-code impossibility.
//
// What keeps this honest is the same discipline as the verb list: the tier
// named STRUCTURAL is exactly the requests the quick-edit executor has no verb
// shaped like (a reorder is not a style_override — there is no rule that moves
// a rendered React section), while a rebuild lane (a different donor, a
// reassembled page) genuinely exists for it. The sentence offers both.
// ---------------------------------------------------------------------------
// TIERS — "yes", "yes for sections you can name", "bigger build", "not ours"
// ---------------------------------------------------------------------------
// The owner's directive, after reading ~50 live calls: a capability answer is
// not a binary. Simple edits (text, colour, size, photo) are always yes.
//
// STRUCTURAL work is now TWO answers, and the split is mechanical, not
// judgement: a request that names ONE section and where it goes parses (via
// lib/section-reorder.js) and is SUPPORTED — the executor moves the bytes on
// a static donor and returns the bigger-build sentence only on a compiled
// build, at apply time, when it actually knows which kind of site this is.
// A reorder with no names in it cannot parse — nobody has said what goes
// where — so it gets the bigger-build sentence up front, which now carries
// the invitation to name the section: that sentence is the door back into
// the supported case.
const STRUCTURAL_CUES = Object.freeze([
  // "move the reviews section above the gallery", "reorder the sections",
  // "could not move entire sections" — a move/reorder verb aimed at a section.
  /\b(?:move|reorder|re-?order|rearrange|re-?arrange|shuffle)\b[^.]{0,80}\b(?:whole |entire )?(?:sections?|blocks?)\b/i,
  // "the reviews section above the services" — the positional form, no verb:
  // needs a section noun, a positional word, and a SECOND section noun after
  // it, so "hide the section below" (a supported style verb) is not caught
  // by accident.
  /\b(?:sections?|blocks?)\b[^.]{0,30}\b(?:above|below|before|after|higher up|lower down|to the top|to the bottom)\b[^.]{0,40}\b(?:sections?|blocks?|gallery|reviews?|services?|testimonials?|hero|footer|about|contact|pricing|faq)\b/i,
  // "change the order of the sections" / "switch the order around".
  /\b(?:change|switch|swap|fix)\b[^.]{0,30}\bthe order\b/i,
]);

const isStructuralRequest = (instruction) => {
  const s = text(instruction);
  return s.trim().length > 0 && STRUCTURAL_CUES.some((re) => re.test(s));
};

/**
 * THE BIGGER-BUILD SENTENCE. Not "I can't" — and, since the power wave, not
 * the end of the road either: naming the section and where it goes turns
 * this exact request into one the editor can take now. The sentence obeys
 * the same law as the refusal: no homework (never ask which section, which
 * file), no duration, and no promise the rebuild lane has not been asked
 * for.
 */
const BIGGER_BUILD_SENTENCE =
  "That one's a bigger build — the kind of change that means reassembling the page, and I'd rather do that carefully than quickly. If you can name one section and where you want it — 'the reviews above the gallery' — I can move that for you now, same as I can change any words, colours, sizing or photos, add a section, or put a whole new page up. Want one of those while this one goes to the team as a rebuild?";

/**
 * THE HERO-VIDEO TIERING SENTENCE. The answer to "can you swap the hero
 * video?" is YES — the clip is generated for the business (Seedance, from
 * their own approved store) and attached to the hero — and it is
 * deliberately NOT an instant promise: generation, verification and the
 * rendered check make it a bigger build than a colour change. Same laws as
 * the other sentences: no homework (never ask for a file, a link or an ID —
 * the store is ours), no duration, and no customer-supplied-video promise
 * (their own video files stay a dashboard-upload future item, so the
 * sentence must never invite one).
 */
const HERO_VIDEO_SENTENCE =
  "I can do that — we generate the video for you and I'll swap the new clip into your hero, then check it on the live page before I call it done. That one's a bigger build than a word or colour change, so it won't be instant; stay with me and I'll tell you the moment it's through.";

/**
 * THE ONE REFUSAL. Everything that is neither a quick edit nor a rebuild —
 * work this product simply does not do — gets this sentence and nothing else.
 *
 * It obeys the rule api/vapi-tools/site-edit.js had to enforce by filtering the
 * planner's own words: a refusal may say what we could not do, and may NOT turn
 * round and ask the caller which section, which element, which file or which
 * link. That is the engineering, and it is ours. It also promises exactly one
 * thing this system can actually keep — that a person sees it — and makes the
 * one claim that is always true of a request no verb exists for: the live site
 * is untouched.
 */
const REFUSAL_SENTENCE =
  "That's not one I can do from here, and I'm not going to guess on your live site — I'm putting it in front of someone on our team today and we'll come back to you, with nothing on your site changed in the meantime.";

/** What Riley may say it can do, in the caller's words. Spoken, not listed. */
const CAPABILITY_SENTENCE =
  "I can change how anything on your site looks, re-word what's written on it, add a line or a section, move a whole section up or down the page, swap a picture out, swap the hero video for a new one we generate, repaint the whole site in a new colour, put a privacy page or a new service page up, install your analytics tag, and put the whole thing back the way it was.";

/**
 * The two gap-answers callers actually ask for, written down so the model stops
 * improvising them. Both are TRUE of the running system today:
 *   status check — site-edit-status speaks every state a job can reach;
 *   confirmation — notifyOwner emails the team on every terminal state; email
 *   straight to the customer from the voice lane is owner-rail-gated today
 *   (send-note's allowlist), so the honest sentence says the phone, not a send.
 */
const STATUS_CHECK_SENTENCE =
  "Any time — on this call or the next one — I can tell you exactly where a change stands: queued, building, live, or didn't go through.";
const EDIT_CONFIRMATION_SENTENCE =
  "Every change emails our team the moment it finishes, live or not. Emailing you straight from the call line isn't switched on yet, so the phone is how I'll confirm yours — stay on and I'll check it, or call back whenever suits you.";

function text(value) {
  return String(value == null ? "" : value);
}

/**
 * classifyRequest(instruction)
 *   -> { supported, tier, family, op, plain }
 *    | { supported:false, tier:"structural", family:"structural", op:null }
 *    | { supported:false, tier:"out_of_scope", family:"unsupported", op:null }
 *
 * Recognition only. A `supported: true` here means the executor HAS a verb
 * shaped like this request — not that this request will land.
 *
 * A NAMED SECTION MOVE IS CHECKED FIRST, on purpose. "Move the reviews above
 * the gallery" scans as a `move`, and `move` is a style_override cue — but no
 * CSS rule reorders a rendered section, so the honest answer is the
 * reorder_section verb, not a quick-edit promise the apply loop would have to
 * refuse. "Move the logo left" carries no section noun and does not parse, so
 * it stays a quick edit.
 *
 * A GENERIC structural request ("reorder the sections", "change the order
 * around") cannot parse — no section is named — and falls to the structural
 * tier's bigger-build sentence, which invites the caller to name the section
 * and thereby re-enter the supported case.
 */
function classifyRequest(instruction) {
  const s = text(instruction);
  if (!s.trim()) return { supported: false, tier: "out_of_scope", family: "unsupported", op: null, plain: null };
  const reorder = parseSectionReorder(s);
  if (reorder) {
    return { supported: true, tier: "structural", family: "structural", op: "reorder_section", plain: "move a whole section above or below another one — a real edit on sites whose sections are written into the page" };
  }
  if (isStructuralRequest(s)) {
    return { supported: false, tier: "structural", family: "structural", op: null, plain: "moving whole sections or reordering the page — a rebuild, unless you can name one section and where you want it" };
  }
  for (const family of FAMILY_ORDER) {
    for (const verb of EXECUTOR_VERBS) {
      if (verb.family !== family) continue;
      if (verb.cues.some((re) => re.test(s))) {
        // The verb's own tier travels with the answer. A bigger-build verb is
        // SUPPORTED — the executor has the branch — but its honest answer is
        // never the quick-edit silence; describeCapability speaks the tiering
        // sentence for it, and nothing in that sentence promises instant.
        return {
          supported: true,
          tier: verb.tier === "bigger_build" ? "bigger_build" : "quick",
          family: verb.family,
          op: verb.op,
          plain: verb.plain,
        };
      }
    }
  }
  return { supported: false, tier: "out_of_scope", family: "unsupported", op: null, plain: null };
}

/**
 * describeCapability(instruction) -> { supported, tier, family, op, say, next }
 *
 * `say` is null when the request IS a quick edit: there is nothing to say about
 * capability, the change simply goes through the normal confirm-and-apply path
 * and that path owns every sentence from there. A bigger-build verb (the hero
 * video swap) is supported but NOT quick, so its `say` is the tiering sentence:
 * honest that it runs, honest that it is not instant, a duration promised by
 * nobody here.
 */
function describeCapability(instruction) {
  const hit = classifyRequest(instruction);
  if (hit.supported) {
    const biggerBuild = hit.tier === "bigger_build";
    return {
      supported: true,
      tier: hit.tier,
      family: hit.family,
      op: hit.op,
      say: biggerBuild ? HERO_VIDEO_SENTENCE : null,
      next: biggerBuild
        ? [
          "Say the `say` line, then take it through request_site_change as normal — the verb exists and the executor answers for their site.",
          "Do NOT promise instant and do NOT put a time on it. If the timing tool returns a number, that number — and only that number — may be spoken.",
          "The clip is one WE generated for their business. Never ask them to send a video file; customer-supplied video is not supported yet.",
          "If the apply step refuses because their store holds no approved clip yet, say the refusal sentence it hands you and let the team lane take it.",
        ].join(" ")
        : "This is inside what the editor can do. Take it through request_site_change as normal — do not describe the mechanics, and do not promise it has landed until the tool says so.",
    };
  }
  if (hit.tier === "structural") {
    return {
      supported: false,
      tier: "structural",
      family: "structural",
      op: null,
      say: BIGGER_BUILD_SENTENCE,
      next: [
        "Say the `say` line and nothing beyond it. It is a bigger build, NOT a no — do not say moving sections is impossible.",
        "The sentence itself invites them to NAME one section and where it goes. If they do — 'the reviews above the gallery' — that is a real edit: take it through request_site_change like any other change and let the executor answer for their site.",
        "The quick edits you offer in that sentence are real: words, colours, sizing, photos, adding a section, a new page. If they want one, take it through request_site_change like any other change.",
        "If they want the rebuild, tell them you will have the team take it on — do not put a time on it, and do not ask which file, which section or how the page is built. That is ours to work out.",
      ].join(" "),
    };
  }
  return {
    supported: false,
    tier: "out_of_scope",
    family: "unsupported",
    op: null,
    say: REFUSAL_SENTENCE,
    next: [
      "Say the `say` line and nothing beyond it.",
      "Do NOT ask the caller to identify a section, an element, a file, a colour code or a link — if we could not work out what they meant, that is ours to solve.",
      "Do not offer a workaround you have not been given, and do not put a time on the follow-up.",
    ].join(" "),
  };
}

/**
 * capabilityBrief() — the block a prompt or a context tool can carry.
 * Derived from EXECUTOR_VERBS so it cannot drift from what runs.
 */
function capabilityBrief() {
  return {
    can_do: CAPABILITY_SENTENCE,
    families: FAMILIES,
    verbs: EXECUTOR_VERBS.map((v) => ({ op: v.op, family: v.family, plain: v.plain })),
    // The tiered model, in the grain the owner asked for: quick edits are a
    // plain yes; a NAMED section move is a real edit too (structural tier,
    // supported — the executor moves it on static sites and speaks the
    // bigger-build line only on compiled ones); an unnamed reorder is the
    // bigger-build sentence; everything else is the one refusal. Never read
    // as a list.
    tiers: {
      quick: { families: QUICK_FAMILIES, say: CAPABILITY_SENTENCE },
      bigger_build: {
        families: BIGGER_BUILD_FAMILIES,
        supported_ops: EXECUTOR_VERBS.filter((v) => v.tier === "bigger_build").map((v) => v.op),
        say: HERO_VIDEO_SENTENCE,
      },
      structural: {
        families: ["structural"],
        supported_ops: ["reorder_section"],
        named_move: { supported: true, say: null, note: "a move that names its section and where it goes is taken through request_site_change like any other edit" },
        say: BIGGER_BUILD_SENTENCE,
      },
      out_of_scope: { families: ["unsupported"], say: REFUSAL_SENTENCE },
    },
    bigger_build: BIGGER_BUILD_SENTENCE,
    status_check: STATUS_CHECK_SENTENCE,
    edit_confirmation: EDIT_CONFIRMATION_SENTENCE,
    refusal: REFUSAL_SENTENCE,
    rule: "Never promise a change outside the verb list. A section move that names its section and where it goes is a real edit — take it. An unnamed reorder gets the bigger-build sentence, which invites them to name it. The hero video swap is real too, and its own tiering sentence says honestly that it is not instant. Everything else gets the one refusal sentence, and that is the whole answer.",
  };
}

module.exports = {
  EXECUTOR_VERBS,
  FAMILIES,
  QUICK_FAMILIES,
  BIGGER_BUILD_FAMILIES,
  FAMILY_ORDER,
  STRUCTURAL_CUES,
  REFUSAL_SENTENCE,
  BIGGER_BUILD_SENTENCE,
  HERO_VIDEO_SENTENCE,
  CAPABILITY_SENTENCE,
  STATUS_CHECK_SENTENCE,
  EDIT_CONFIRMATION_SENTENCE,
  classifyRequest,
  describeCapability,
  capabilityBrief,
  isStructuralRequest,
};
