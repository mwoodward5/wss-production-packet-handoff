"use strict";

// lib/element-resolve.js — "THE LOGO IN THE TOP LEFT" MUST BE ENOUGH.
//
// Given a page x-ray (lib/page-xray.js) and a customer's own words, return the
// element they mean, what they want done to it, a confidence, and the reason.
//
// =====================================================================
// THE RECORDED FAILURES THIS EXISTS TO ANSWER
// =====================================================================
// Verbatim, from the owner's own calls:
//
//   "I need to know the specific element that represents your logo to make it
//    larger and move it right"
//        -> The caller said "the logo, top left". That is a complete
//           instruction to any human. THIS MODULE IS THE TRANSLATION, and the
//           question it produced must never be asked again: a business owner
//           does not know what an element is, and being asked is the fastest
//           way to lose the sale. When two candidates are genuinely close this
//           asks ONE plain question ABOUT THE THING — "the one next to your
//           phone number, or the big one in the middle?" — never about markup.
//
//   "I can't move whole sections around on the page"
//        -> reorder() below. Two sections, a common parent, and the sibling
//           rects that make the result checkable afterwards.
//
//   "the logo is now stretched and cut off and cropped... the graphic is too
//    big for the box it was given"
//        -> planResize() does the aspect arithmetic ONCE, here, and measures
//           the result against the box it has to live in. A resize that would
//           not fit comes back with the two numbers that prove it, before the
//           customer has to phone back.
//
//   And measured: the engine reported "landed" for changes with zero visible
//   effect.
//        -> Every target carries a selector page-xray already PROVED resolves
//           to exactly one element on the live page. And refineForVerb() moves
//           a text request off the box and onto the words, which is the exact
//           shape of "make the main headline orange" applying cleanly to
//           section#top and changing nothing the customer could see.
//
// =====================================================================
// THE RULE ABOUT PROMISES
// =====================================================================
// A verb this module reports as supported must be a verb the executor can
// actually keep. The support table below is derived from the op list in
// lib/site-change-plan.js — style_override, insert_html, replace_text,
// seo_page, undo, replace_copy, copy_block, tracking_tag, swap_image,
// legal_page — and nothing else. Everything outside it returns a plain
// refusal SENTENCE for Riley to say. A promise the executor cannot keep is
// the defect we are removing, so an honest "I can't do that yet, but I can
// do X" beats a confident plan that dies in the planner.
//
// =====================================================================
// WIRING NOTE FOR lib/site-change-plan.js (owned by the riley-flow workflow —
// do not edit it; this is the exact change for whoever does)
// =====================================================================
// 1. It composes with page-xray. Same browser rule, same reason:
//
//        const xr  = await xray(origin, { browser: await warmBrowser, buildHash });
//        const req = await resolve(xr, instruction, { context: callState });
//
//    `resolve` is async ONLY because of the optional vision tie-break. With
//    `useVision:false` it never touches the network and never throws.
//
// 2. WHERE IT REPLACES A REFUSAL. "Cannot identify logo element" becomes
//    req.target — a name, a rect, and a selector already proven unique. When
//    req.question is set, Riley asks that one sentence instead of guessing;
//    when req.refusal is set, Riley says req.refusal.say verbatim.
//
// 3. WHERE IT REPLACES ARITHMETIC. For a resize, req.geometry carries
//    natural/current/proposed and `fits`. Feed proposed.css_hint to the
//    planner instead of letting it invent transform:scale() again.
//
// 4. WHAT IT DOES NOT DO. It does not write CSS, does not deploy, does not
//    verify. composeOverrideCss still writes the rule; edit-verify still
//    proves it landed. This decides WHICH THING and WHAT TO IT.

const { findByName } = require("./page-xray");

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Two candidates within this many points are a genuine coin-flip: ask. */
const AMBIGUITY_MARGIN = 1.5;

/** Below this, we are guessing. Ask, or offer what is on the page. */
const MIN_CONFIDENCE = 0.34;

/**
 * The weakest noun match that is still worth acting on.
 *
 * Below this the only thing that matched was a synonym every element of that
 * kind carries — "block" for a section, "link" for a link — which is not the
 * caller naming anything. See the grounding check in resolve().
 */
const MIN_NOUN_TO_ACT = 3.5;

/** Vision is a mid-call cost. One call, small answer, hard ceiling. */
const VISION_TIMEOUT_MS = 4_000;
const VISION_MODEL = "claude-opus-5";
const VISION_MAX_TOKENS = 300;

/** A resize this far past its container is reported as not fitting. */
const FIT_TOLERANCE_PX = 2;

// ---------------------------------------------------------------------------
// WHAT THE EXECUTOR CAN ACTUALLY KEEP
// ---------------------------------------------------------------------------
/**
 * Every verb, and the op in lib/site-change-plan.js that carries it out.
 * `supported:false` entries carry the sentence Riley says — written to be
 * spoken to a busy tradesperson, so: what we cannot do, then what we can,
 * in one breath. No jargon, no apology paragraph, no "element".
 */
const VERB_SUPPORT = Object.freeze({
  resize: { supported: true, op: "style_override" },
  move: { supported: true, op: "style_override" },
  swap: { supported: true, op: "style_override", needs: "both things sitting in the same row" },
  reorder: { supported: true, op: "style_override", needs: "both blocks sitting in the same stack" },
  restyle: { supported: true, op: "style_override" },
  retext: { supported: true, op: "replace_copy" },
  hide: { supported: true, op: "style_override" },
  replace_image: { supported: true, op: "swap_image", needs: "a link to the picture" },
  add_text: { supported: true, op: "copy_block" },

  animate: {
    supported: false,
    say: "I can't add movement or animation to that yet. I can make it bigger, move it, or change its colour right now if you'd like.",
  },
  relink: {
    supported: false,
    say: "I can't repoint a link from here yet. I can change the wording, the size or the colour of it today, and I'll get the link sorted for you separately.",
  },
  add_feature: {
    supported: false,
    say: "I can't add a whole new feature like that from here. I can change anything that's already on the page — wording, pictures, colours, sizes, where things sit — and I'll pass the rest to the team.",
  },
  unknown: {
    supported: false,
    say: "I want to make sure I get this right — tell me what you'd like changed and I'll take care of it.",
  },
});

// ---------------------------------------------------------------------------
// PURE TEXT READING — no browser, no network, all unit-testable
// ---------------------------------------------------------------------------

/** Lowercase, curly quotes flattened, punctuation kept where it carries meaning. */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Words that are never the name of a thing on a page. "it" and "get" were not
// here, and both cost a live resolution: "move IT to the right" matched a
// button reading "$ Launch my SITE now" because "site" contains "it", and
// "GET rid of that chat bubble" matched a "Get driving directions" link. A
// two-letter word has no business being matched against anything.
const STOPWORDS = new Set([
  "the", "a", "an", "my", "our", "your", "please", "can", "could", "would",
  "you", "just", "and", "is", "it", "it's", "its", "that", "this", "these",
  "those", "there", "then", "them", "they", "so", "i", "we", "do", "does",
  "be", "to", "of", "on", "in", "at", "for", "with", "want", "like", "need",
  "needs", "make", "let's", "lets", "okay", "ok", "get", "got", "rid", "put",
  "take", "give", "keep", "go", "goes", "come", "look", "see", "should",
  "will", "shall", "now", "please", "thing", "bit", "one", "some", "any",
  "all", "up", "down", "out", "off", "over", "about", "into", "onto", "as",
  "if", "when", "while", "from", "by", "or", "but", "not", "no", "yes",
  // How people actually start a sentence on the phone. None of them is ever
  // the name of something on a page, and left in they made "actually make it
  // a bit smaller" look like the caller had named a new thing.
  "actually", "also", "maybe", "perhaps", "still", "well", "anyway", "sorry",
  "yeah", "yep", "nah", "hmm", "erm", "um", "right", "listen", "look", "say",
  "think", "reckon", "wondering", "wonder", "know",
]);

/**
 * The shortest word allowed to match by containment.
 *
 * A substring match on a short word is not evidence. Measured on the live
 * Rimrock mirror before this existed: "it" matched the word "site" inside a
 * button label and won the whole resolution.
 */
const MIN_SUBSTRING_WORD = 4;
const MIN_WORD = 3;

/**
 * Words that survive stopword removal but still do not name a thing.
 *
 * "that" makes a sentence anaphoric, but "get rid of THAT CHAT BUBBLE" names
 * something as well — and on a mirror with no chat widget, carrying the
 * previous turn's target made "get rid of that chat bubble" delete the hero
 * photograph. Measured on the live Rimrock mirror. So "it" only means the
 * thing from last turn when the caller named nothing else: everything left
 * after this list is a naming attempt, and a naming attempt that finds
 * nothing must be answered, not silently redirected.
 */
const NOT_A_NOUN = new Set([
  "move", "shift", "slide", "reposition", "nudge", "drag", "shove", "scoot",
  "bump", "push", "pull", "shunt", "swap", "switch", "trade", "exchange",
  "flip", "hide", "remove", "delete", "resize", "shrink", "enlarge", "change",
  "replace", "use", "add", "insert", "include", "stick", "drop", "upload",
  "send", "reword", "rename", "brighter", "darker", "warmer", "cooler",
  "left", "right", "top", "bottom", "middle", "centre", "center", "side",
  "instead", "rather", "than", "over", "under", "below", "above", "beside",
  "next", "please", "again", "back", "more", "less", "much", "little", "new",
  "different", "another", "same", "way", "little", "bit",
]);

function words(text) {
  return normalize(text)
    .replace(/[^a-z0-9%$.\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function contentWords(text) {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

/**
 * "the part that says we hold the line" -> "we hold the line"
 * '"REQUEST A QUOTE" button'            -> "request a quote"
 *
 * Quoted text is the strongest signal a caller can give — they are reading
 * the page back to us — so it is pulled out before anything else and scored
 * highest.
 */
function readQuotedText(utterance) {
  const raw = String(utterance || "");
  const quoted = /["']([^"']{2,80})["']/.exec(raw);
  if (quoted) return normalize(quoted[1]);
  const said = /\b(?:that\s+)?(?:says|saying|reads|reading|labell?ed|titled|called|headed)\s+(?:it\s+)?(.{2,80}?)(?:\s*[,.?!]|\s+(?:and|but|then|instead|to)\b|$)/i.exec(raw);
  if (said) return normalize(said[1]);
  return "";
}

/** Words a caller uses for a place on the page. */
const ZONE_WORDS = Object.freeze({
  top: ["top", "up top", "upper", "above", "header", "up there", "very top"],
  bottom: ["bottom", "lower", "underneath", "down the bottom", "very bottom", "footer", "down at the bottom"],
  middle: ["middle", "centre", "center", "midway"],
  left: ["left", "left side", "left hand"],
  right: ["right", "right side", "right hand"],
});

/**
 * Where the caller says the thing IS, versus where they want it to GO.
 *
 * "move it to the right side instead of the left" contains both, and reading
 * them the same way is how a resolver ends up looking for something that is
 * already on the right. The preposition decides: "to/onto/over to/across to"
 * is a DESTINATION, "instead of/rather than/from" is where it is NOW, and a
 * bare "on/in/at the left" is a locator.
 */
function readPlaces(utterance) {
  const text = normalize(utterance);
  const locator = new Set();
  const destination = new Set();

  const scan = (fragment, into) => {
    for (const [zone, forms] of Object.entries(ZONE_WORDS)) {
      if (forms.some((f) => fragment.includes(f))) into.add(zone);
    }
  };

  // Destination first, and its phrase is REMOVED before locators are read, so
  // "to the right" cannot also register as "it is on the right".
  let rest = text;
  const destRe = /\b(?:to|onto|over to|across to|into)\s+the\s+([a-z\s-]{2,24}?)(?=\s+(?:side|instead|rather|of|and|so|please)\b|[,.?!]|$)/g;
  let m;
  while ((m = destRe.exec(text)) !== null) {
    scan(m[1], destination);
    rest = rest.replace(m[0], " ");
  }
  const wasRe = /\b(?:instead of|rather than|from)\s+the\s+([a-z\s-]{2,24}?)(?=\s+(?:side|and|so|please)\b|[,.?!]|$)/g;
  const wasNow = new Set();
  while ((m = wasRe.exec(text)) !== null) {
    scan(m[1], wasNow);
    rest = rest.replace(m[0], " ");
  }
  scan(rest, locator);
  for (const z of wasNow) locator.add(z);

  return {
    locator: [...locator],
    destination: [...destination],
    // Kept separate because it is a CHECK, not a search term: if the caller
    // says "instead of the left" and the thing we picked is already on the
    // right, we have the wrong thing.
    currently: [...wasNow],
  };
}

/** "the bar that stays when I scroll" — a behaviour, not a place. */
function readBehaviour(utterance) {
  const t = normalize(utterance);
  const sticky = /\b(stays?|sticks?|follows?|stuck|fixed|floating|floats?)\b/.test(t)
    && /\b(scroll|scrolling|down the page|as i go|when i move)\b/.test(t)
    || /\bsticky\b/.test(t) || /\bthat follows me\b/.test(t);
  return { sticky: Boolean(sticky) };
}

/** "the big one" / "the little one at the bottom". */
function readSize(utterance) {
  const t = normalize(utterance);
  if (/\b(big|biggest|large|largest|huge|main|great big)\b/.test(t)) return "large";
  if (/\b(small|smallest|little|tiny|wee)\b/.test(t)) return "small";
  return "";
}

/**
 * "twice as big" -> 2. "half the size" -> 0.5. "50% bigger" -> 1.5.
 * "200 pixels wide" -> { targetPx: 200, axis: "width" }.
 *
 * A caller never says "scale factor". They say twice, double, a bit, way. Each
 * of these is a number, and the number is what the arithmetic below needs.
 */
function readAmount(utterance) {
  const t = normalize(utterance);

  const px = /\b(\d{2,4})\s*(?:px|pixels?)\b/.exec(t);
  if (px) {
    const axis = /\b(wide|width|across)\b/.test(t) ? "width"
      : /\b(tall|high|height)\b/.test(t) ? "height" : "";
    return { kind: "absolute", px: Number(px[1]), axis, phrase: px[0] };
  }

  const pct = /\b(\d{1,3})\s*(?:%|percent)\s+(bigger|larger|smaller)\b/.exec(t);
  if (pct) {
    const f = Number(pct[1]) / 100;
    return { kind: "factor", factor: Math.round((pct[2] === "smaller" ? 1 - f : 1 + f) * 100) / 100, phrase: pct[0] };
  }

  // EVERY PATTERN SWALLOWS ITS OWN COMPARATIVE, and that is not cosmetic.
  // `phrase` is subtracted from the sentence before the nouns are read, so
  // "twice as big" has to match ALL THREE WORDS. When it matched only
  // "twice", the leftover "big" scored as a noun against the hero's synonym
  // "the big image at the top" AND as a size adjective — and "make the logo
  // twice as big" came back asking which of two things the caller meant. The
  // amount is not a description of the thing.
  const named = [
    [/\b(?:twice|double|2x|two times)(?:\s+as)?(?:\s+(?:big|large|wide|tall|high|the size))?/, 2],
    [/\b(?:three times|triple|3x)(?:\s+as)?(?:\s+(?:big|large|wide|tall))?/, 3],
    [/\bhalf(?:\s+(?:the\s+)?(?:size|as\s+big|as\s+large|as\s+wide|as\s+tall))?/, 0.5],
    [/\b(?:a third|third the size)/, 0.34],
    [/\b(?:way|much|a lot|far|loads)\s+(?:bigger|larger|taller|wider)/, 1.75],
    [/\b(?:way|much|a lot|far|loads)\s+(?:smaller|tinier|shorter|narrower)/, 0.6],
    [/\b(?:a bit|a little|slightly|touch|tad|smidge)\s+(?:bigger|larger|taller|wider)/, 1.2],
    [/\b(?:a bit|a little|slightly|touch|tad|smidge)\s+(?:smaller|tinier|shorter|thinner|narrower)/, 0.85],
    [/\b(?:bigger|larger|enlarge|blow (?:it )?up|increase)/, 1.4],
    [/\b(?:taller|deeper|wider|broader)/, 1.3],
    [/\b(?:smaller|shrink|reduce|tinier|cut (?:it )?down)/, 0.7],
    [/\b(?:shorter|thinner|narrower)/, 0.75],
  ];
  for (const [re, factor] of named) {
    const hit = re.exec(t);
    if (hit) return { kind: "factor", factor, phrase: hit[0] };
  }

  // `\d x` last: "2x" is already caught above, and a bare number this late is
  // more likely a phone number or a year than a scale factor.
  const times = /\b(\d(?:\.\d)?)\s*(?:x|times)\s+(?:as\s+)?(?:big|large|bigger|larger|the size)/.exec(t);
  if (times) return { kind: "factor", factor: Number(times[1]), phrase: times[0] };

  return { kind: "", factor: null, phrase: "" };
}

/** Which way a resize runs when the caller names an axis. */
function readAxisWord(utterance) {
  const t = normalize(utterance);
  if (/\b(wider|width|across|broader|narrower|thinner|skinnier)\b/.test(t)) return "width";
  if (/\b(taller|height|higher|deeper|shorter|shallower)\b/.test(t)) return "height";
  return "";
}

/**
 * "should go below the hero" -> { relation: "below", other: "hero" }
 *
 * THE GUARD IS THE POINT. "move it over to the right" also contains a relation
 * word, and read naively it becomes "put this thing below a thing called 'to
 * the right'" — a reorder that can only fail. A relation needs an OBJECT: a
 * thing on the page, not a direction. So a captured phrase that starts with a
 * preposition, or that is nothing but direction words, is not a relation.
 */
const RELATION_OBJECT_IS_A_DIRECTION = /^(to|from|by|at|on|in|towards?|here|there)\b/;
const DIRECTION_ONLY = /^(?:the\s+)?(?:left|right|top|bottom|middle|centre|center|side|hand|one|there|here|\s)+$/;

function readRelation(utterance) {
  const t = normalize(utterance);
  const re = /\b(below|under|underneath|beneath|above|over|on top of|before|after|next to|beside)\s+(?:the\s+)?([a-z0-9 '"-]{2,40}?)(?=\s*[,.?!]|\s+(?:please|instead|and|so)\b|$)/;
  const m = re.exec(t);
  if (!m) return null;
  const other = m[2].trim();
  if (!other || RELATION_OBJECT_IS_A_DIRECTION.test(other) || DIRECTION_ONLY.test(other)) return null;
  const word = m[1];
  const relation = /below|under|underneath|beneath|after/.test(word) ? "below"
    : /above|over|on top of|before/.test(word) ? "above" : "beside";
  return { relation, other, phrase: m[0] };
}

/**
 * readRequest(utterance) -> { verb, slots }
 *
 * The verb table is ordered: the more specific readings are tested first,
 * because "swap the logo with the phone button" also contains the word that
 * would otherwise read as a plain move.
 */
function readRequest(utterance) {
  const raw = String(utterance || "");
  const t = normalize(raw);
  const quoted = readQuotedText(raw);
  const places = readPlaces(raw);
  const amount = readAmount(raw);
  const relation = readRelation(raw);

  // The amount is subtracted before the nouns are read. See readAmount.
  const withoutAmount = amount.phrase ? t.replace(amount.phrase, " ") : t;

  const slots = {
    utterance: raw,
    quoted,
    places,
    amount,
    relation,
    axis: readAxisWord(raw),
    size: readSize(withoutAmount),
    behaviour: readBehaviour(raw),
    anaphoric: /\b(it|that|this|the same one|them)\b/.test(t) && !/\bit says\b/.test(t),
    words: contentWords(withoutAmount),
  };

  const has = (re) => re.test(t);
  let verb = "unknown";

  // A LINK TO A PICTURE OUTRANKS EVERY OTHER READING. It is the one thing a
  // caller supplies that only one op can consume, and it is unambiguous.
  const imageLink = /https?:\/\/\S+\.(?:jpe?g|png|webp|gif|avif)\b/i.test(t);
  // "put a photo of my new truck on there" is not a move, and it read as one
  // because "put" is a move word. When a picture noun is in the sentence
  // alongside a placing verb, the picture wins — placing a PICTURE somewhere
  // is a swap_image, not a nudge.
  const placingAPicture = has(/\b(photo|photograph|picture|image|shot|snap)\b/)
    && has(/\b(put|use|add|replace|swap out|stick|drop|upload|send|different|new|another)\b/);

  if (imageLink) verb = "replace_image";
  else if (has(/\b(swap|switch|trade|exchange|flip)\b/) && has(/\b(with|and|for|round|around)\b/)) verb = "swap";
  else if (relation && has(/\b(go|goes|move|put|sit|sits|belongs?|should be|drop|shift)\b/)) verb = "reorder";
  else if (has(/\b(animate|animation|fade|slide in|bounce|spin|scroll(?:ing)? effect|parallax|hover effect)\b/)) verb = "animate";
  else if (has(/\b(link|links?\s+to|point(?:s|ing)?\s+(?:it\s+)?(?:to|at)|url|goes to my)\b/) && !has(/\bunlink\b/)) verb = "relink";
  else if (has(/\b(hide|remove|get rid of|take (?:it |that )?(?:off|down|away)|delete|don't want)\b/)) verb = "hide";
  else if (placingAPicture) verb = "replace_image";
  else if (has(/\b(bigger|smaller|larger|resize|size|shrink|enlarge|blow up|twice|double|half|wider|taller|shorter|narrower|thinner|broader|deeper|\d+\s*(?:px|pixels?))\b/)
    && !has(/\b(font|text|wording|words)\s+(?:should\s+)?say\b/)) verb = "resize";
  else if (has(/\b(move|shift|slide|put|reposition|nudge|centre|center|drag|shove|scoot|bump|push|pull|shunt)\b/)) verb = "move";
  else if (has(/\b(replace|swap out|upload)\b/)) verb = "replace_image";
  else if (has(/\b(should say|change (?:the )?(?:wording|text|copy)|reword|rename|call it|say instead|spelled|spelling|typo)\b/)) verb = "retext";
  else if (has(/\b(colou?r|colourful|colorful|brighter|darker|warmer|cooler|bolder|bold|italic|font|greyscale|grayscale|washed out|pop|vibrant|saturate|dull|drab)\b/)
    // "make the main headline text bright orange" names a colour and never the
    // word "colour". Without this it read as an unknown verb on the live page.
    || (NAMED_COLOURS.test(t) && has(/\b(make|turn|change|paint|go)\b/))) verb = "restyle";
  else if (has(/\b(add|put in|include|insert)\b/) && has(/\b(paragraph|sentence|line|blurb|bit of text|wording|note)\b/)) verb = "add_text";
  else if (has(/\b(add|put in|build|create|install)\b/)) verb = "add_feature";

  // "make the hero image more colourful" reads as restyle even though it names
  // an image, because the request is about how the existing picture LOOKS. The
  // planner prompt already carries this rule; it has to be true here too or the
  // two disagree about the same sentence.
  if (verb === "replace_image" && has(/\b(colou?rful|brighter|darker|warmer|pop|vibrant|washed out|dull)\b/)) {
    verb = "restyle";
  }

  // WHICH WORDS NAME THE THING BEING CHANGED.
  //
  // "swap the logo with the phone call button" and "the social block should go
  // below the hero" each name TWO things. Scoring the whole sentence against
  // every element lets the second thing win: in the reorder, "hero" is an
  // exact name match and outscores the social block, so the page would have
  // moved the hero. The subject is the words before "with"/the relation; the
  // other half is read separately, by pickPartner and pickRelated.
  slots.wordsAll = slots.words;
  slots.subject = withoutAmount;
  if (verb === "swap") {
    slots.subject = withoutAmount.split(/\s+(?:with|and|for)\s+/)[0];
  } else if (verb === "reorder" && relation) {
    slots.subject = withoutAmount.replace(relation.phrase, " ");
  }
  if (slots.subject !== withoutAmount) slots.words = contentWords(slots.subject);

  return { verb, slots, support: VERB_SUPPORT[verb] || VERB_SUPPORT.unknown };
}

// ---------------------------------------------------------------------------
// THE TREE, DERIVED — page-xray emits a flat document-order walk with depth
// ---------------------------------------------------------------------------
/**
 * The walk is pre-order DFS, so an element's ancestors always precede it and
 * carry a smaller depth. That makes "nearest recorded ancestor" a backwards
 * scan — but NEAREST RECORDED IS NOT NEAREST. Invisible and skipped nodes are
 * never emitted, so the true parent may be missing. Every answer here is
 * therefore CHECKED BY GEOMETRY: an ancestor must actually contain the child's
 * box, or it is not returned at all. A wrong parent would put a resize inside
 * the wrong box and report a fit that is not real.
 */
function contains(outer, inner, slack = 1) {
  return outer.x - slack <= inner.x
    && outer.y - slack <= inner.y
    && outer.x + outer.w + slack >= inner.x + inner.w
    && outer.y + outer.h + slack >= inner.y + inner.h;
}

/**
 * OUR OWN FURNITURE IS NOT THEIR PAGE.
 *
 * Live mirrors carry the WSS Labs sign-up floater, and its markup is
 * `wss-`-prefixed — page-xray minted `a[class~="wss-btn-primary"]` and
 * `button#wss-pill` on the Rimrock capture. Measured there: "swap the logo
 * with the phone call button" picked OUR agent line out of that panel as the
 * customer's call button, so the swap was refused for not sharing a parent
 * with the header — correctly, and about the wrong element entirely.
 *
 * A caller talking about "my site" never means our overlay. This is the same
 * species of error as shipping a manufacturer's badge as a client's logo:
 * being ON the page is not being PART OF the business's page.
 */
const OUR_OWN_WIDGET = /(^|[^a-z])wss-|#wss|\bwss_/i;

function looksOurs(el) {
  if (!el) return false;
  if (OUR_OWN_WIDGET.test(String(el.selector || ""))) return true;
  return (el.hints || []).some((h) => OUR_OWN_WIDGET.test(String(h)));
}

/**
 * ANYTHING INSIDE OUR PANEL IS OURS.
 *
 * Checking the element alone was not enough: the floater's phone link minted
 * as `a[href="tel:+19493395562"]` — our agent line, with nothing in the
 * selector to say whose it is — and won "the phone call button" over the
 * client's own number. The panel around it is the thing that carries the
 * `wss-` marking, so ownership is inherited the way it is in the DOM.
 */
function isOurs(elements, el) {
  if (looksOurs(el)) return true;
  if (!Array.isArray(elements)) return false;
  return ancestorsOf(elements, el).some(looksOurs);
}

function elementsOf(xr) {
  const view = (xr && xr.desktop) || xr || {};
  return Array.isArray(view.elements) ? view.elements : [];
}

function viewOf(xr) {
  return (xr && xr.desktop) || xr || {};
}

/**
 * `el.index` IS AN IDENTITY, NOT AN ARRAY POSITION.
 *
 * page-xray ranks every measured element by interest, caps the list, and puts
 * the survivors back in document order — each keeping the index it had in the
 * uncapped walk. So on a real page the indices are SPARSE: the element at
 * array position 40 might be index 96. Walking backwards from `el.index` looks
 * right, passes against any fixture built with contiguous indices, and reads
 * the wrong entries on every live capture — which is what it did. Measured on
 * the Rimrock mirror: every ancestor lookup returned null, so a resize could
 * not say whether it would fit and a swap refused two things that share a row.
 */
const POSITIONS = new WeakMap();

function positionOf(elements, el) {
  let map = POSITIONS.get(elements);
  if (!map) {
    map = new Map();
    for (let i = 0; i < elements.length; i += 1) map.set(elements[i], i);
    POSITIONS.set(elements, map);
  }
  const at = map.get(el);
  return at === undefined ? elements.findIndex((e) => e && e.index === el.index) : at;
}

/**
 * THE ANCESTORS, FROM DEPTH ALONE.
 *
 * Walking backwards through a document-order DFS and keeping a RUNNING
 * MINIMUM DEPTH traces exactly the ancestor path: an entry is an ancestor iff
 * its depth is below every depth seen since `el`. That is a property of the
 * walk, so it survives the cap dropping entries, and it is a DOM fact rather
 * than an inference.
 *
 * An earlier version made geometry the judge — the first shallower entry had
 * to contain the child's box or the answer was "no ancestor". On the fixture
 * that was fine. On the LIVE Rimrock mirror it returned an empty chain for the
 * logo, because the header is position:fixed and a fixed element's document
 * rect drifts against its own children's. The result: a resize that could not
 * say whether it would fit, and a swap that refused two things sitting in the
 * same header. Containment is still measured — it is just reported, not used
 * to deny that a parent exists.
 */
function ancestorsOf(elements, el) {
  const out = [];
  if (!el) return out;
  const from = positionOf(elements, el);
  if (from < 0) return out;
  let minDepth = el.depth;
  for (let i = from - 1; i >= 0; i -= 1) {
    const cand = elements[i];
    if (!cand || cand.depth >= minDepth) continue;
    minDepth = cand.depth;
    out.push(cand);
    if (minDepth === 0) break;
  }
  return out;
}

/** The immediate recorded ancestor, or null at the root. */
function containerOf(elements, el) {
  return ancestorsOf(elements, el)[0] || null;
}

/**
 * The ancestor that would actually STOP a resize, which is not the parent.
 *
 * A logo's immediate parent is usually the <a> wrapped tightly around it —
 * measured on the fixture and on the live mirror, exactly the element's own
 * box. Checking a resize against that reports "it will not fit" for every
 * resize, including the ones that are fine, because a shrink-wrapping wrapper
 * grows with its child. The first ancestor with real slack is the first one
 * that was sized by something other than this element, so it is the first one
 * that can refuse. The skipped wrappers are named in the result rather than
 * silently dropped.
 */
const WRAPPER_SLACK_PX = 4;

function constrainingBoxOf(elements, el) {
  const wrappers = [];
  for (const anc of ancestorsOf(elements, el)) {
    const slackW = anc.rect.w - el.rect.w;
    const slackH = anc.rect.h - el.rect.h;
    if (slackW <= WRAPPER_SLACK_PX && slackH <= WRAPPER_SLACK_PX) {
      wrappers.push(anc);
      continue;
    }
    return {
      box: anc,
      wrappers,
      wrappers_skipped: wrappers.map(plainName),
      // Reported, not enforced. A fixed header and its own children live in
      // different document coordinate spaces, so a box that does not enclose
      // its child is normal rather than wrong — but a fit measured across
      // that boundary is not trustworthy, and this is how a caller knows.
      encloses: contains(anc.rect, el.rect),
    };
  }
  return { box: null, wrappers, wrappers_skipped: wrappers.map(plainName), encloses: null };
}

/**
 * WHAT TO ACTUALLY MOVE.
 *
 * The logo is an <img> inside an <a> that hugs it exactly, and that <a> is
 * the flex child. A margin on the <img> shifts it inside a box that is the
 * same size as the <img> — which is to say, it does nothing, and reports
 * success. site-change-plan.js's own catalog says the same thing in prose:
 * "the clickable wrapper AROUND the logo — move/reposition THIS, not the img".
 * This is that sentence as a measurement: the handle is the outermost wrapper
 * that adds no space, because that is the element the layout is arranging.
 */
function layoutHandleOf(elements, el) {
  const { box, wrappers } = constrainingBoxOf(elements, el);
  const handle = wrappers.length ? wrappers[wrappers.length - 1] : el;
  return { handle, box, wrappers, moved_up: handle !== el };
}

/** Nearest-to-root chain of recorded ancestors. */
function ancestorChain(elements, el) {
  return ancestorsOf(elements, el);
}

function commonAncestor(elements, a, b) {
  const idsA = new Set(ancestorsOf(elements, a).map((e) => e.index));
  for (const anc of ancestorsOf(elements, b)) {
    if (idsA.has(anc.index)) return anc;
  }
  return null;
}

/** Everything recorded inside `el` — array positions, not indices. See above. */
function descendantsOf(elements, el) {
  const out = [];
  const from = positionOf(elements, el);
  if (from < 0) return out;
  for (let i = from + 1; i < elements.length; i += 1) {
    const cand = elements[i];
    if (!cand) continue;
    if (cand.depth <= el.depth) break;
    out.push(cand);
  }
  return out;
}

const SOCIAL_HOST = /(facebook|instagram|twitter|x\.com|tiktok|youtube|linkedin|pinterest|yelp)\./i;

/**
 * A topic a caller can name that classifyName does not produce a name for.
 * MEASURED, never inferred: "social" is returned only when a link inside the
 * block actually points at a social host. "the social media block" is one of
 * the recorded requests and there is no other way to hear it.
 */
function topicOf(elements, el) {
  const kids = descendantsOf(elements, el);
  const socialLinks = kids.filter((k) => SOCIAL_HOST.test(String(k.href || "")));
  if (!(socialLinks.length >= 2 || (socialLinks.length === 1 && kids.length <= 6))) return null;

  // ONLY THE TIGHTEST BLOCK OWNS THE TOPIC. The page's root <div> also
  // "contains social links" — measured, it scored as high as the social block
  // itself and made "the social media block should go below the hero" a
  // coin-flip between a section and the whole page. If a descendant of this
  // element contains every one of the same links, that descendant is the
  // block the caller means and this one is merely an ancestor of it.
  const ids = new Set(socialLinks.map((k) => k.index));
  for (const kid of kids) {
    if (ids.has(kid.index)) continue;
    const inner = descendantsOf(elements, kid);
    if (!inner.length) continue;
    const covered = inner.filter((k) => ids.has(k.index)).length;
    if (covered === ids.size) return null;
  }
  return { topic: "social", evidence: socialLinks.slice(0, 4).map((k) => k.href) };
}

/**
 * The nearest named thing beside `el` — what makes "the one next to your phone
 * number" sayable. Prefers a horizontal neighbour (same row), then vertical.
 */
function neighbourOf(elements, el) {
  let best = null;
  let bestGap = Infinity;
  for (const other of elements) {
    if (!other || other.index === el.index) continue;
    if (!other.name || !other.nameable) continue;
    if (contains(other.rect, el.rect) || contains(el.rect, other.rect)) continue;
    const sameRow = Math.abs((other.rect.y + other.rect.h / 2) - (el.rect.y + el.rect.h / 2)) < Math.max(24, el.rect.h);
    if (!sameRow) continue;
    const gap = other.rect.x > el.rect.x
      ? other.rect.x - (el.rect.x + el.rect.w)
      : el.rect.x - (other.rect.x + other.rect.w);
    if (gap < -4) continue;
    if (gap < bestGap) { bestGap = gap; best = other; }
  }
  return best ? { el: best, gap_px: Math.round(bestGap) } : null;
}

// ---------------------------------------------------------------------------
// TRIANGULATION — one score per SIGNAL, never one score per word
// ---------------------------------------------------------------------------
/**
 * The difference between this and a bag-of-words match: each signal
 * contributes AT MOST its ceiling, so an element that matches the noun AND
 * the position beats one that matches the noun twice. That is what
 * "triangulate — never rely on one signal" means arithmetically.
 *
 * Ceilings, highest first, because that is the order these are trustworthy in:
 *   text they quoted   6   they are reading the page back to us
 *   the noun           6   "logo", "button", "photo"
 *   behaviour          3   "stays when I scroll" — true or false, no opinion
 *   position           3   "top left"
 *   size               2   "the big one"
 *   role / tag         2   weakest: every page has many buttons
 */
const CEILING = Object.freeze({ text: 6, noun: 6, behaviour: 3, position: 3, size: 2, role: 2 });

/**
 * Words that name a KIND, not a THING.
 *
 * page-xray gives every <section> the synonyms "block" and "part of the page",
 * and every <a> the synonym "link". Scored like a real name, they made "the
 * social media block" match every section on the page equally — measured on
 * the live Rimrock mirror, which has no social block at all, two anonymous
 * sections tied exactly and Riley asked "the one 7 screens down, or the one 3
 * screens down?". Nobody can answer that. A word that fits everything is not
 * the caller naming anything, and it is scored accordingly.
 */
const GENERIC_SYNONYM = new Set([
  "block", "part of the page", "section", "link", "heading", "text", "words",
  "copy", "box", "field", "image", "picture", "symbol",
]);
const GENERIC_NAME = /^(section|paragraph|icon|embed|small heading|input field)$/i;
const GENERIC_SCORE = 2;

function textScore(el, slots) {
  if (!slots.quoted) return { score: 0, why: "" };
  const own = normalize(el.text || "");
  if (!own) return { score: 0, why: "" };
  if (own === slots.quoted) return { score: CEILING.text, why: `it reads exactly "${String(el.text).slice(0, 40)}"` };
  if (own.includes(slots.quoted) || slots.quoted.includes(own)) {
    return { score: CEILING.text - 1, why: `it reads "${String(el.text).slice(0, 40)}"` };
  }
  const want = new Set(contentWords(slots.quoted));
  if (!want.size) return { score: 0, why: "" };
  const got = contentWords(own).filter((w) => want.has(w));
  const overlap = got.length / want.size;
  if (overlap >= 0.6) return { score: 3, why: `its wording matches — "${String(el.text).slice(0, 40)}"` };
  if (overlap >= 0.34) return { score: 1.5, why: `some of its wording matches` };
  return { score: 0, why: "" };
}

function nounScore(el, slots, topic) {
  const name = normalize(el.name || "");
  const syn = (el.synonyms || []).map(normalize);
  const hints = (el.hints || []).map(normalize);
  const said = slots.words;
  if (!said.length) return { score: 0, why: "" };

  let best = 0;
  let why = "";
  const matched = new Set();
  const bid = (score, reason, word) => {
    if (word) matched.add(word);
    if (score > best) { best = score; why = reason; }
  };

  // THE GAP BETWEEN AN EXACT NAME AND A PARTIAL ONE IS LOAD-BEARING.
  //
  // These mirrors carry a logo in the header AND one in the footer, which
  // page-xray names "logo" and "logo image". A caller saying "the logo" means
  // the one they can see. Scoring the partial at 5 against the exact at 6 put
  // those two 1.4 apart — inside the ambiguity band — so "make the logo twice
  // as big" asked a needless question about two logos. An exact whole-name
  // match is a different class of evidence from a substring, and the numbers
  // now say so.
  for (const w of said) {
    if (!name && !syn.length && !hints.length && !topic) break;
    if (w.length < MIN_WORD) continue;
    const generic = GENERIC_SYNONYM.has(w);
    if (name === w) bid(generic ? GENERIC_SCORE : CEILING.noun, `it is the ${el.name}`, w);
    else if (name && name.split(/\s+/).includes(w)) bid(generic ? GENERIC_SCORE : 4.5, `it is the ${el.name}`, w);
    else if (name && w.length >= MIN_SUBSTRING_WORD && name.includes(w)) {
      bid(generic ? GENERIC_SCORE : 3.5, `its name — ${el.name} — contains "${w}"`, w);
    }
    if (syn.some((s) => s === w)) bid(generic ? GENERIC_SCORE : 4.5, `"${w}" is another word for the ${el.name || el.tag}`, w);
    else if (syn.some((s) => s.split(/\s+/).includes(w))) bid(generic ? GENERIC_SCORE : 3.5, `"${w}" is another word for the ${el.name || el.tag}`, w);
    // A hint word is EVIDENCE, not a guess: the page's own id/class/aria text
    // carries it. Scored below the name because a class called "card" on a
    // wrapper is weaker than a thing actually named "card".
    if (hints.includes(w)) bid(3, `the page's own markup calls it "${w}"`, w);
    // A TOPIC IS AS STRONG AS A NAME, because it was measured: this block was
    // called social because its own links point at Facebook and Instagram.
    // Every <section> on the page answers to the synonym "block", so without
    // this the services section and the social block tie.
    if (topic && topic.topic === w) {
      bid(CEILING.noun, `it holds your ${w} links (${topic.evidence.length} of them)`, w);
    }
  }

  // MATCHING TWO DIFFERENT WORDS IS BETTER EVIDENCE THAN MATCHING ONE TWICE.
  // The per-signal ceiling stops one word being counted over and over; this
  // lets "the social block" beat a plain section that only answers to "block".
  const bonus = Math.min(1, Math.max(0, matched.size - 1) * 0.5);
  return { score: Math.min(best, CEILING.noun) + (best > 0 ? bonus : 0), why };
}

/**
 * "picture", "photo", "video" — is this thing one, does it hold one, or
 * neither?
 *
 * Measured on the fixture: "the big picture at the top needs to be brighter"
 * scored the HEADER within a point of the hero, because the header's synonym
 * list contains "the top of the page" and the word "top" was doing all the
 * work. The header holds a logo; it does not hold a picture. The page's own
 * naming already tells a logo from a photo, so this reads it rather than
 * guessing — and a candidate holding no imagery at all is pushed away.
 */
const WANTS_PICTURE = /^(picture|photo|photograph|image|images|video|footage|banner|graphic)$/;
const IS_MEDIA_TAG = /^(img|svg|video|picture|canvas)$/;

function mediaScore(elements, el, slots) {
  if (!slots.words.some((w) => WANTS_PICTURE.test(w))) return { score: 0, why: "" };
  const isPhotoish = (e) => IS_MEDIA_TAG.test(e.tag)
    && !/logo|icon|avatar/.test(String(e.name || "").toLowerCase());
  if (isPhotoish(el)) return { score: 2, why: "it is a picture" };
  if (IS_MEDIA_TAG.test(el.tag)) return { score: 1, why: "it is an image" };
  const kids = descendantsOf(elements, el);
  if (kids.some(isPhotoish)) return { score: 1.5, why: "it holds the picture" };
  if (kids.some((k) => IS_MEDIA_TAG.test(k.tag))) return { score: 0.5, why: "" };
  return { score: -1, why: "" };
}

function positionScore(el, slots) {
  const wanted = slots.places.locator;
  if (!wanted.length) return { score: 0, why: "" };
  const zone = normalize(el.zone || "");
  const hits = wanted.filter((z) => zone.includes(z));
  // "top" also means "above the fold" to a caller who has not scrolled.
  const foldBonus = wanted.includes("top") && el.fold === "above" && !zone.includes("top") ? 1 : 0;
  if (!hits.length && !foldBonus) {
    // Saying "top left" about something 4 screens down is a real mismatch, and
    // silently scoring it zero lets it win on other signals. Push it away.
    return { score: -1.5, why: "" };
  }
  const score = Math.min(CEILING.position, hits.length * 2 + foldBonus);
  return { score, why: `it is ${el.zone}` };
}

function behaviourScore(el, slots) {
  if (!slots.behaviour.sticky) return { score: 0, why: "" };
  const pos = normalize((el.style && el.style.position) || "");
  if (el.fixed || pos === "sticky" || pos === "fixed") {
    return { score: CEILING.behaviour, why: "it stays put when the page scrolls" };
  }
  return { score: -1.5, why: "" };
}

function sizeScore(el, slots, stats) {
  if (!slots.size) return { score: 0, why: "" };
  const area = el.rect.w * el.rect.h;
  if (slots.size === "large") {
    return area >= stats.p75 ? { score: CEILING.size, why: "it is one of the bigger things on the page" } : { score: 0, why: "" };
  }
  return area <= stats.p25 ? { score: CEILING.size, why: "it is one of the smaller things on the page" } : { score: 0, why: "" };
}

function roleScore(el, slots) {
  const said = new Set(slots.words);
  if (said.has(normalize(el.tag)) || said.has(normalize(el.role))) {
    return { score: CEILING.role, why: `it is a ${el.role || el.tag}` };
  }
  return { score: 0, why: "" };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * rank(xr, slots) -> candidates, best first.
 *
 * Only elements with a PROVEN selector are eligible, because a target without
 * one cannot be acted on — offering it would be the "matched nothing, reported
 * success" failure with extra steps.
 */
function rank(xr, slots, { limit = 6 } = {}) {
  const elements = elementsOf(xr);
  const areas = elements.map((e) => e.rect.w * e.rect.h).sort((a, b) => a - b);
  const stats = { p25: percentile(areas, 0.25), p75: percentile(areas, 0.75) };

  const scored = [];
  for (const el of elements) {
    if (!el.selector) continue;
    if (isOurs(elements, el)) continue; // see isOurs — our overlay is not their site
    const topic = topicOf(elements, el);
    const parts = {
      text: textScore(el, slots),
      noun: nounScore(el, slots, topic),
      behaviour: behaviourScore(el, slots),
      position: positionScore(el, slots),
      size: sizeScore(el, slots, stats),
      role: roleScore(el, slots),
      media: mediaScore(elements, el, slots),
    };
    let score = 0;
    const why = [];
    for (const part of Object.values(parts)) {
      score += part.score;
      if (part.why) why.push(part.why);
    }
    if (score <= 0) continue;

    // Tiebreakers only. Each is worth less than any single real signal, so a
    // big above-the-fold thing can never out-rank the thing they named.
    if (el.nameable) score += 0.5;
    if (el.fold === "above") score += 0.4;
    if (el.clipped_out) score -= 2;
    if (el.topmost === false) score -= 0.3;

    scored.push({
      index: el.index,
      name: el.name,
      plain: plainName(el),
      selector: el.selector,
      selector_stable: Boolean(el.selector_stable),
      tag: el.tag,
      role: el.role,
      text: el.text,
      zone: el.zone,
      fold: el.fold,
      rect: el.rect,
      image: el.image,
      style: el.style,
      href: el.href,
      src: el.src,
      topic: topic ? topic.topic : "",
      score: Math.round(score * 10) / 10,
      signals: {
        text: parts.text.score, noun: parts.noun.score, behaviour: parts.behaviour.score,
        position: parts.position.score, size: parts.size.score, role: parts.role.score,
        media: parts.media.score,
      },
      why: [...new Set(why)],
      el,
    });
  }

  scored.sort((a, b) => b.score - a.score
    || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h)
    || a.index - b.index);
  return scored.slice(0, limit);
}

/**
 * Confidence, from the MARGIN rather than the raw score, because a raw score
 * only says how much the phrase matched — not whether anything else matched it
 * just as well. And a match with no noun and no quoted text is a position
 * guess, so it is capped no matter how clean the margin looks.
 */
function confidenceOf(candidates) {
  if (!candidates.length) return 0;
  const top = candidates[0];
  const second = candidates[1];
  const margin = second ? top.score - second.score : top.score;
  let c = 1 - Math.exp(-Math.max(0, margin) / 2.2);
  if (second) c = Math.max(c, 0.05);
  const sig = top.signals || {};
  // `carried` is the element from the turn before, resolved through "it". That
  // is a naming as strong as any word in this sentence — it is the thing they
  // just named — so it is not treated as an unnamed position guess.
  const named = sig.noun > 0 || sig.text > 0 || top.carried === true;
  if (!named) c = Math.min(c, 0.45);
  if (sig.text >= CEILING.text - 1) c = Math.max(c, 0.8);
  return Math.round(Math.min(0.98, c) * 100) / 100;
}

// ---------------------------------------------------------------------------
// PLAIN SPEECH — nothing below this line may say "element" or "selector"
// ---------------------------------------------------------------------------
function plainName(el) {
  if (!el) return "that";
  if (el.name && !/^button "/.test(el.name) && !/^link "/.test(el.name)) return el.name;
  if (el.name) return el.name.replace(/^(button|link) "(.+)"$/, (_, k, t) => `"${t}" ${k}`);
  const t = String(el.text || "").trim();
  if (t) return `the bit that says "${t.slice(0, 34)}"`;
  if (el.tag === "img") return "the picture";
  if (el.tag === "video") return "the video";
  return "that part of the page";
}

/** "your logo, up in the top left" — a thing plus where it is. */
/**
 * The same name with the article a person would use.
 *
 * plainName gives the bare noun, which is right inside a list. In a sentence
 * it reads like a machine — measured on the live run: "I'll make main
 * headline orange". The things that belong to the business get "your";
 * everything else gets "the".
 */
const THEIRS = /^(logo|header|footer|hero|navigation menu|call button|phone number|main headline|form|map)$/;

function theThing(el) {
  const name = plainName(el);
  if (/^(the|your|a) /i.test(name) || /^["']/.test(name)) return name;
  return `${THEIRS.test(name) ? "your" : "the"} ${name}`;
}

function describePlainly(cand) {
  if (!cand) return "";
  const where = String(cand.zone || "").replace("centre", "middle");
  return `${plainName(cand.el || cand)}, ${where}`;
}

/**
 * ONE plain question about the thing itself.
 *
 * Never "which element" and never a list of five. The tiebreak is chosen from
 * what ACTUALLY differs between the two, in the order a person would use:
 * what it says, what it sits next to, where it is, how big it is.
 */
function askBetween(elements, a, b) {
  const ea = a.el || a;
  const eb = b.el || b;

  const ta = String(ea.text || "").trim();
  const tb = String(eb.text || "").trim();
  if (ta && tb && ta !== tb) {
    return `the one that says "${ta.slice(0, 28)}", or the one that says "${tb.slice(0, 28)}"?`;
  }

  const na = neighbourOf(elements, ea);
  const nb = neighbourOf(elements, eb);
  if (na && nb && na.el.index !== nb.el.index) {
    return `the one next to ${theThing(na.el)}, or the one next to ${theThing(nb.el)}?`;
  }
  if (na && !nb) {
    return `the one next to ${theThing(na.el)}, or the other one?`;
  }

  const za = String(ea.zone || "");
  const zb = String(eb.zone || "");
  if (za && zb && za !== zb) {
    return `the one ${za.replace("centre", "middle")}, or the one ${zb.replace("centre", "middle")}?`;
  }

  const areaA = ea.rect.w * ea.rect.h;
  const areaB = eb.rect.w * eb.rect.h;
  if (Math.abs(areaA - areaB) / Math.max(areaA, areaB) > 0.25) {
    return areaA > areaB ? "the big one, or the smaller one?" : "the small one, or the bigger one?";
  }
  return `the one ${za || "up top"}, or the other one?`;
}

/**
 * When nothing matched: name what IS there, in their words.
 *
 * The one thing this must never do is hand the question back — "what do you
 * mean?" is the refusal that lost a call. Reading the page out to them is an
 * answer; asking them to describe it again is not.
 */
function offerPlainList(xr, { limit = 4 } = {}) {
  const seen = new Set();
  const picks = [];
  // page-xray's cropPriority already ranks what a caller is most likely to
  // mean — logo 1, call button 2, hero 3. Reading the page out in DOCUMENT
  // order instead offered "header, call button, logo and navigation menu" on
  // the live mirror: four pieces of header furniture and nothing they can see
  // below it. Generic names are dropped, because "section" tells them nothing.
  const ordered = elementsOf(xr)
    .filter((el) => el.selector && el.nameable && el.name && !GENERIC_NAME.test(el.name) && !isOurs(elementsOf(xr), el))
    .sort((a, b) => (a.cropPriority || 99) - (b.cropPriority || 99) || a.index - b.index);
  const take = (el) => {
    // "logo" and "logo image" are the header and footer marks. Reading both
    // out sounds like the page has two different things on it.
    const key = el.name.replace(/"[^"]*"/, "").replace(/\s+image$/, "").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    picks.push(el);
    return true;
  };
  for (const el of ordered) {
    if (picks.length >= limit - 1) break;
    take(el);
  }
  // AND ONE THING FROM FURTHER DOWN. Ranked purely by priority, the list came
  // back "the logo, the header, the call button and the phone number" —
  // measured on the live mirror, four pieces of header furniture and nothing
  // the caller can see when they scroll. A list that describes only the top
  // 144 pixels of a 9,000-pixel page is not a description of their site.
  // Keep going past the ones already covered: the footer logo is below the
  // fold but reads as "logo", which is already in the list.
  for (const el of ordered) {
    if (el.fold === "below" && take(el)) break;
  }
  for (const el of ordered) {
    if (picks.length >= limit) break;
    take(el);
  }
  if (!picks.length) return "";
  const names = picks.map((el) => theThing(el));
  const last = names.pop();
  return names.length ? `${names.join(", ")} and ${last}` : last;
}

// ---------------------------------------------------------------------------
// THE ARITHMETIC — done here, once, so nobody downstream has to
// ---------------------------------------------------------------------------
/**
 * planResize(elements, cand, slots) -> geometry
 *
 * ASPECT RATIO IS NOT OPTIONAL. "the logo is now stretched and cut off and
 * cropped" happened because a resize moved one axis and left the other. So:
 * ONE axis is driven, the other is computed from the picture's OWN ratio, and
 * the pair is checked against the box it has to live in. `fits:false` with two
 * numbers beside it is the answer that stops the customer phoning back.
 *
 * NEVER transform:scale(). Measured on a live call: scale() grew the paint and
 * left the layout box, so the header reserved the old width and the mark hung
 * 17px off the edge. height/width grow the box and the picture together.
 */
function planResize(elements, cand, slots) {
  const el = cand.el || cand;
  const cur = { w: Math.round(el.rect.w), h: Math.round(el.rect.h) };
  const amount = slots.amount;
  const isMedia = /^(img|svg|video|picture)$/.test(el.tag) || Boolean(el.image);
  const isText = Boolean(String(el.text || "").trim()) && !isMedia;

  const out = {
    kind: isText ? "type_size" : "box",
    current: cur,
    natural: (el.image && el.image.natural) || null,
    aspect_source: "",
    aspect: null,
    proposed: null,
    property: "",
    css_hint: "",
    container: null,
    fits: null,
    warnings: [],
    question: null,
  };

  // WORDS ARE SIZED BY TYPE SIZE, NOT BY BOX HEIGHT. Growing a heading's box
  // does nothing a caller can see; growing its font is the whole change.
  if (isText) {
    const px = parseFloat(String((el.style && el.style.fontSize) || "")) || 0;
    if (!px) {
      out.warnings.push({ kind: "no_measured_type_size", detail: "the page did not report a type size for this, so the new size cannot be calculated" });
      return out;
    }
    const factor = amount.kind === "factor" ? amount.factor
      : amount.kind === "absolute" ? amount.px / px : null;
    if (!factor) {
      out.question = "how much bigger — a little, or twice the size?";
      return out;
    }
    const next = Math.round(px * factor * 10) / 10;
    out.property = "font-size";
    out.current_type_px = px;
    out.proposed = { font_px: next };
    out.css_hint = `font-size:${next}px`;
    return out;
  }

  // Pictures keep their own ratio; a box with no picture keeps the ratio it
  // is displaying at, and says so rather than pretending it measured one.
  // The exact ratio drives the arithmetic; the rounded one is for reading.
  // Rounding first and multiplying second put the answer a pixel out.
  // ONLY A PICTURE HAS A RATIO TO KEEP.
  //
  // A box has whatever shape its contents give it. Measured on the live
  // Rimrock header: "the bar that stays when I scroll should be a bit shorter"
  // came back proposing 1280x144 -> 1088x122, narrowing a full-width header
  // by 192px because it carried the box's current ratio forward. Nobody asked
  // for that. A picture's ratio is a property OF THE PICTURE; a box's is a
  // coincidence of this render.
  const nat = out.natural;
  const keepsRatio = Boolean(nat && nat.w && nat.h);
  let aspectExact = null;
  if (keepsRatio) {
    aspectExact = nat.w / nat.h;
    out.aspect_source = "the picture's own dimensions";
  } else if (cur.w && cur.h) {
    out.aspect_source = "not applicable — this is a box, not a picture, so the other side is left alone";
  }
  out.ratio_locked = keepsRatio;
  out.aspect = keepsRatio ? Math.round(aspectExact * 1000) / 1000 : null;

  let axis = slots.axis || amount.axis || (isMedia ? "height" : "");
  if (!axis) {
    // A plain box with no axis named is genuinely ambiguous, and guessing is
    // how something ends up the wrong shape. One plain question, about the
    // thing, not the markup.
    out.question = "taller, or wider?";
    return out;
  }

  let nextW;
  let nextH;
  if (amount.kind === "absolute") {
    if (axis === "width") { nextW = amount.px; nextH = keepsRatio ? amount.px / aspectExact : cur.h; }
    else { nextH = amount.px; nextW = keepsRatio ? amount.px * aspectExact : cur.w; }
  } else if (amount.kind === "factor") {
    if (axis === "width") { nextW = cur.w * amount.factor; nextH = keepsRatio ? nextW / aspectExact : cur.h; }
    else { nextH = cur.h * amount.factor; nextW = keepsRatio ? nextH * aspectExact : cur.w; }
  } else {
    out.question = "how much bigger — a little, or twice the size?";
    return out;
  }

  nextW = Math.round(nextW);
  nextH = Math.round(nextH);
  out.proposed = { w: nextW, h: nextH };
  out.property = axis;
  // width:auto is the load-bearing half for a PICTURE. Pinning both axes is
  // what stretches a logo; driving one and letting the browser derive the
  // other cannot. For a box there is no second axis to derive, so naming one
  // would be inventing a change nobody asked for.
  if (keepsRatio) {
    out.css_hint = axis === "height"
      ? `height:${nextH}px;width:auto;max-width:100%`
      : `width:${nextW}px;height:auto;max-width:100%`;
  } else {
    out.css_hint = axis === "height" ? `height:${nextH}px` : `width:${nextW}px`;
  }

  if (nat && nat.w && nat.h && nextW > nat.w * 1.5) {
    out.warnings.push({
      kind: "upscaled",
      detail: `it would be drawn ${nextW}px wide from a picture that is only ${nat.w}px — it will look soft`,
    });
  }

  const { box, wrappers_skipped, encloses } = constrainingBoxOf(elements, el);
  if (box) {
    const room = { w: Math.round(box.rect.w), h: Math.round(box.rect.h) };
    const fitsW = nextW <= room.w + FIT_TOLERANCE_PX;
    const fitsH = nextH <= room.h + FIT_TOLERANCE_PX;
    out.container = { name: plainName(box), selector: box.selector, room, wrappers_skipped, encloses };
    out.fits = encloses === false ? null : (fitsW && fitsH);
    if (encloses === false) {
      out.warnings.push({
        kind: "fit_not_trustworthy",
        detail: `${plainName(box)} is ${room.w} x ${room.h}, but it does not sit around this the way the page measured it — the two were measured against different reference points, so whether the new size fits has to be checked by looking at the rebuilt page`,
      });
    } else if (!fitsH) {
      out.warnings.push({
        kind: "taller_than_its_box",
        detail: `at ${nextH}px it would be taller than ${plainName(box)}, which is ${room.h}px — that is the shape that got cut off before`,
      });
    }
    if (!fitsW) {
      out.warnings.push({
        kind: "wider_than_its_box",
        detail: `at ${nextW}px it would be wider than ${plainName(box)}, which is ${room.w}px`,
      });
    }
  } else {
    out.warnings.push({
      kind: "box_not_measured",
      detail: "the box it sits in could not be measured, so whether the new size fits is unknown — render and look before calling it done",
    });
  }
  return out;
}

/** move: which way, and the honest note about what makes it possible. */
function planMove(elements, cand, slots) {
  const el = cand.el || cand;
  const dest = slots.places.destination[0]
    || (slots.places.locator.length === 1 && !slots.places.currently.length ? slots.places.locator[0] : "");
  if (!dest) return { question: "whereabouts do you want it — left, right, or in the middle?" };

  const { handle, box: parent, moved_up } = layoutHandleOf(elements, el);
  const parentDisplay = normalize((parent && parent.style && parent.style.display) || "");
  const inRow = /flex|grid/.test(parentDisplay);

  const plan = {
    direction: dest,
    // The element the rule must name. Usually the target; sometimes the
    // wrapper around it, and then it says so rather than quietly substituting.
    apply_to: { name: plainName(handle), selector: handle.selector },
    apply_to_wrapper: moved_up
      ? `a margin on ${plainName(el)} would move it inside a box exactly its own size — the rule has to name the wrapper around it`
      : null,
    within: parent ? { name: plainName(parent), selector: parent.selector, display: parentDisplay } : null,
    method: "",
    css_hint: "",
    must_render_to_confirm: true,
    warnings: [],
  };

  if (dest === "left" || dest === "right" || dest === "middle") {
    if (inRow) {
      plan.method = "push it along the row it already sits in";
      plan.css_hint = dest === "right" ? "margin-left:auto;margin-right:0"
        : dest === "left" ? "margin-right:auto;margin-left:0"
          : "margin-left:auto;margin-right:auto";
    } else {
      plan.method = "shift it inside the block it sits in";
      plan.css_hint = dest === "right" ? "margin-left:auto;margin-right:0;display:block"
        : dest === "left" ? "margin-right:auto;margin-left:0;display:block"
          : "margin-left:auto;margin-right:auto;display:block";
      plan.warnings.push({
        kind: "not_a_row",
        detail: `${plainName(parent) || "the block around it"} is not laid out as a row, so this nudges it rather than re-ordering a row — the result has to be looked at`,
      });
    }
  } else if (dest === "top" || dest === "bottom") {
    plan.method = "move it up or down inside the block it sits in";
    plan.css_hint = dest === "top" ? "margin-top:0" : "margin-top:auto";
    plan.warnings.push({
      kind: "vertical_move_is_coarse",
      detail: "moving something up or down inside its own block only has room to move as far as that block allows",
    });
  }

  // The check the caller handed us for free. "instead of the left" is a claim
  // about where it is NOW, and if it is already on the right we have the wrong
  // thing — better to notice here than after a deploy.
  for (const was of slots.places.currently) {
    if (!normalize(el.zone).includes(was)) {
      plan.warnings.push({
        kind: "not_where_they_said_it_was",
        detail: `they said it is currently on the ${was}, but this one is ${el.zone} — worth checking it is the right one`,
      });
    }
  }
  return plan;
}

/** swap: only honest when both things share one row. */
function planSwap(elements, a, b) {
  // Same reason as planMove: order applies to the flex CHILD, which for a
  // logo is the anchor wrapped round it, not the image itself.
  const ea = layoutHandleOf(elements, a.el || a).handle;
  const eb = layoutHandleOf(elements, b.el || b).handle;
  const parent = commonAncestor(elements, ea, eb);
  if (!parent) {
    return {
      possible: false,
      say: `I can't swap those two round — they aren't sitting in the same part of the page. I can move each of them on its own instead.`,
    };
  }
  const display = normalize((parent.style && parent.style.display) || "");
  const isRow = /flex|grid/.test(display);
  const firstIsA = ea.rect.x <= eb.rect.x;
  return {
    possible: true,
    within: { name: plainName(parent), selector: parent.selector, display },
    method: isRow ? "reorder the row they share" : "turn the block they share into a row, then reorder it",
    css_hint: isRow
      ? `${firstIsA ? "first" : "second"}{order:2} ${firstIsA ? "second" : "first"}{order:1}`
      : "display:flex on the block they share, then order on each",
    must_render_to_confirm: true,
    warnings: isRow ? [] : [{
      kind: "not_a_row_yet",
      detail: `${plainName(parent)} is laid out as ${display || "a plain block"}, so making the swap possible changes how it lays out — the spacing has to be compared before and after`,
    }],
    before: [
      { name: plainName(ea), selector: ea.selector, x: Math.round(ea.rect.x) },
      { name: plainName(eb), selector: eb.selector, x: Math.round(eb.rect.x) },
    ],
  };
}

/**
 * reorder: "the social media block should go below the hero".
 *
 * This is the verb the system said outright it could not do. It can, when the
 * two blocks share a parent — and the sibling rects come back with it so the
 * result is CHECKABLE: re-x-ray afterwards and the order either changed or it
 * did not. That is the difference between shipping this and claiming it.
 */
function planReorder(elements, moving, anchor, relation) {
  const em = moving.el || moving;
  const ea = anchor.el || anchor;
  const parent = commonAncestor(elements, em, ea);
  if (!parent) {
    return {
      possible: false,
      say: `I can't move ${theThing(em)} under ${theThing(ea)} — they're not part of the same stack on the page.`,
    };
  }
  const pm = containerOf(elements, em);
  const pa = containerOf(elements, ea);
  const siblings = pm && pa && pm.index === parent.index && pa.index === parent.index;
  if (!siblings) {
    return {
      possible: false,
      say: `I can't shift ${theThing(em)} to under ${theThing(ea)} — one of them sits inside the other's part of the page rather than beside it.`,
    };
  }

  const display = normalize((parent.style && parent.style.display) || "");
  const isStack = /flex|grid/.test(display);
  const kids = elements.filter((e) => {
    const p = containerOf(elements, e);
    return p && p.index === parent.index;
  }).sort((x, y) => x.rect.y - y.rect.y);

  const order = kids.map((k, i) => ({
    position: i + 1,
    name: plainName(k),
    selector: k.selector,
    top: Math.round(k.rect.y),
    height: Math.round(k.rect.h),
    gap_below: i + 1 < kids.length ? Math.round(kids[i + 1].rect.y - (k.rect.y + k.rect.h)) : null,
  }));

  return {
    possible: true,
    relation,
    moving: { name: plainName(em), selector: em.selector },
    anchor: { name: plainName(ea), selector: ea.selector },
    within: { name: plainName(parent), selector: parent.selector, display },
    method: isStack ? "reorder the stack they share" : "make the stack they share a vertical stack, then reorder it",
    must_render_to_confirm: true,
    // THE ACCEPTANCE TEST, HANDED OVER WITH THE PLAN. Re-x-ray after the
    // deploy: the two must have swapped places in this list, and the gaps
    // must still be close to these numbers. A reorder that "applied" but left
    // the order alone is exactly the silent failure this codebase has paid for.
    verify: {
      expect: relation === "below"
        ? `${plainName(em)} sits lower down the page than ${plainName(ea)}`
        : `${plainName(em)} sits higher up the page than ${plainName(ea)}`,
      order_before: order,
      gap_tolerance_px: 24,
    },
    warnings: isStack ? [] : [{
      kind: "stack_becomes_flex",
      detail: `${plainName(parent)} is laid out as ${display || "a plain block"} today. Re-ordering means turning it into a vertical stack, which can change the spacing between every block in it — compare the gaps above against the rebuilt page before telling the customer it is done`,
    }],
  };
}

const RESTYLE_INTENT = [
  [/\b(more colou?rful|colorful|vibrant|pop|less grey|less gray|not so grey|not so gray|greyscale|grayscale)\b/, { kind: "saturate", amount: 1.45 }],
  [/\b(brighter|lighter|lighten)\b/, { kind: "brighten", amount: 1.15 }],
  [/\b(darker|darken|deeper)\b/, { kind: "darken", amount: 0.88 }],
  [/\b(warmer|warm it)\b/, { kind: "warmer", amount: 12 }],
  [/\b(cooler|cool it)\b/, { kind: "cooler", amount: -12 }],
  [/\b(washed out|dull|drab|flat|faded)\b/, { kind: "saturate", amount: 1.4 }],
  [/\b(bold|bolder|heavier)\b/, { kind: "weight", amount: 700 }],
];

const NAMED_COLOURS = /\b(red|orange|yellow|green|blue|navy|purple|pink|black|white|grey|gray|gold|silver|teal|cream|brown|maroon)\b/;

function planRestyle(cand, slots) {
  const el = cand.el || cand;
  const t = normalize(slots.utterance);
  const isMedia = /^(img|svg|video|picture)$/.test(el.tag) || Boolean(el.image) || Boolean(el.style && el.style.backgroundImage);
  const plan = { surface: isMedia ? "picture" : "words", intent: null, colour: "", must_render_to_confirm: true, warnings: [] };

  const colour = NAMED_COLOURS.exec(t);
  if (colour) plan.colour = colour[1];

  for (const [re, intent] of RESTYLE_INTENT) {
    if (re.test(t)) { plan.intent = intent; break; }
  }
  if (!plan.intent && plan.colour) plan.intent = { kind: "recolour", to: plan.colour };
  if (!plan.intent) plan.intent = { kind: "unspecified" };

  if (isMedia && plan.intent.kind === "saturate") {
    const fit = normalize((el.style && el.style.objectFit) || "");
    plan.note = "this changes how the picture already there looks — it does not fetch a different picture";
    if (fit) plan.object_fit = fit;
  }
  return plan;
}

/**
 * refineForVerb — the single most expensive mistake this can prevent.
 *
 * Measured on a live customer site: "make the main headline text bright
 * orange" was planned as a rule on the hero section. The rule applied, the
 * section's own colour changed, the headline kept the colour its utility class
 * gives it, and the customer was told it was live. Colour, font and type size
 * are INHERITED — an element that has its own value ignores its parent. So a
 * request about WORDS has to land on the words.
 *
 * The mirror image is true for pictures: "make the hero more colourful" lands
 * on the hero's picture or video, not on the box around it.
 */
function refineForVerb(elements, cand, verb, slots) {
  const el = cand.el || cand;
  const t = normalize(slots.utterance);
  const aboutWords = /\b(text|words|wording|headline|heading|writing|font|type|letters|caption|title)\b/.test(t)
    || /\b(colou?r|bold|italic|bigger|smaller)\b/.test(t);
  const aboutPicture = /\b(picture|photo|image|video|background|banner)\b/.test(t)
    || /\b(colou?rful|brighter|darker|washed out|saturate|greyscale|grayscale)\b/.test(t);

  const isContainer = /^(div|section|header|footer|main|aside|nav|article)$/.test(el.tag);
  if (!isContainer) return { target: cand, moved: null };

  const kids = descendantsOf(elements, el).filter((k) => k.selector);

  if ((verb === "restyle" || verb === "resize") && aboutPicture) {
    // BIGGEST IS NOT THE SAME AS THE PICTURE. Measured on the live Rimrock
    // hero: the largest media child is a 1280x128 decorative <svg> divider,
    // beating the 399x300 photograph on area alone — so "make the hero image
    // more colourful" would have filtered a background squiggle. Rank by what
    // the thing IS first (a video, then a named photograph, then any image,
    // and an unnamed vector last), and only then by size.
    const rankMedia = (k) => (k.tag === "video" ? 0
      : (k.tag === "img" && k.name && !/logo|icon/i.test(k.name)) ? 1
        : k.tag === "img" ? 2 : 3);
    const media = kids
      .filter((k) => /^(img|video|svg)$/.test(k.tag))
      .sort((a, b) => rankMedia(a) - rankMedia(b) || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h))[0];
    if (media) {
      return {
        target: decorate(media),
        moved: {
          from: plainName(el),
          to: plainName(media),
          reason: "the request is about how the picture looks, and a rule on the box around a picture does not reach the picture",
        },
      };
    }
  }

  if ((verb === "restyle" || verb === "resize") && aboutWords) {
    const heading = kids
      .filter((k) => /^h[1-6]$/.test(k.tag) && String(k.text || "").trim())
      .sort((a, b) => a.tag.localeCompare(b.tag) || a.index - b.index)[0];
    const anyText = heading || kids.find((k) => String(k.text || "").trim());
    if (anyText) {
      return {
        target: decorate(anyText),
        moved: {
          from: plainName(el),
          to: plainName(anyText),
          reason: "colour, font and type size are inherited — a rule on the section around the words changes the section and leaves the words exactly as they were",
        },
      };
    }
  }
  return { target: cand, moved: null };
}

/** Wrap a raw x-ray element in the candidate shape the rest of this returns. */
function decorate(el) {
  return {
    index: el.index,
    name: el.name,
    plain: plainName(el),
    selector: el.selector,
    selector_stable: Boolean(el.selector_stable),
    tag: el.tag,
    role: el.role,
    text: el.text,
    zone: el.zone,
    fold: el.fold,
    rect: el.rect,
    image: el.image,
    style: el.style,
    href: el.href,
    src: el.src,
    score: null,
    // A candidate that did not come out of rank() still has to answer the same
    // questions rank()'s output answers — confidenceOf reads these, and an
    // element carried over from the previous turn used to crash it.
    signals: { text: 0, noun: 0, behaviour: 0, position: 0, size: 0, role: 0, media: 0 },
    why: [],
    el,
  };
}

// ---------------------------------------------------------------------------
// VISION — the last resort, and only for a genuine coin-flip
// ---------------------------------------------------------------------------
/**
 * When position, name and text have all been used and two candidates are still
 * within a point and a half of each other, the crops are the only evidence
 * left. This is the one place a vision model earns its cost.
 *
 * IT IS NEVER THE FALLBACK. If it is slow, unavailable, unsure, or names
 * something that is not one of the two, the answer is the plain question —
 * which was always a correct outcome. Vision only ever saves the caller from
 * being asked; it can never cause a wrong pick to be presented as certain.
 */
function cropFor(xr, cand) {
  const crops = (xr && xr.crops) || (xr && xr.desktop && xr.desktop.crops) || [];
  for (const crop of crops) {
    if (!crop || !crop.buffer) continue;
    if (crop.index === cand.index) return crop;
    if (crop.selector && cand.selector && crop.selector === cand.selector) return crop;
  }
  return null;
}

function visionPrompt(utterance, a, b) {
  return `A business owner is on the phone about their own website. They said:

"${String(utterance).trim()}"

Two things on the page could be what they mean. Image 1 is ${describePlainly(a)}, ${Math.round(a.rect.w)} by ${Math.round(a.rect.h)} pixels${a.text ? `, reading "${String(a.text).slice(0, 40)}"` : ""}. Image 2 is ${describePlainly(b)}, ${Math.round(b.rect.w)} by ${Math.round(b.rect.h)} pixels${b.text ? `, reading "${String(b.text).slice(0, 40)}"` : ""}.

Answer with JSON only, no other text and no XML tags of any kind:
{"pick": 1 | 2 | null, "confidence": 0.0-1.0, "because": "<one short sentence in plain words a non-designer would use>"}

Use null for "pick" if the two are genuinely equally good matches for what they said. Being unsure is a useful answer — a wrong guess costs this business owner their change.`;
}

/**
 * The default vision caller. Raw fetch on purpose: it matches how
 * lib/site-change-plan.js already talks to Anthropic, and it stays injectable
 * so every test below runs without a network or a key.
 */
async function defaultVision({ prompt, images, timeoutMs = VISION_TIMEOUT_MS, fetchImpl = fetch, model = VISION_MODEL }) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return { ok: false, reason: "anthropic_key_unset" };

  const content = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.base64 },
  }));
  content.push({ type: "text", text: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: VISION_MAX_TOKENS,
        // Mid-call. A tie-break between two pictures does not need reasoning
        // tokens, and the caller is waiting. Disabled thinking is accepted at
        // effort `high` or below on this model; `low` is the fastest honest
        // setting. No temperature/top_p — they are rejected outright here.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content }],
      }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, reason: `anthropic_${(json && json.error && json.error.type) || res.status}` };
    const text = (json.content || []).map((c) => c.text || "").join("");
    // What the tie-break COST, reported rather than assumed. Two crops and a
    // short answer is a small call, but "small" is a claim and this is the
    // measurement behind it.
    const usage = json.usage || {};
    return {
      ok: true,
      text,
      model,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
      },
    };
  } catch (e) {
    const why = e && e.name === "AbortError" ? "vision_timeout" : `vision_unreachable:${String((e && e.message) || e).slice(0, 60)}`;
    return { ok: false, reason: why };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the decision out of the reply without trusting its shape. */
function readVisionAnswer(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const pick = parsed.pick === 1 || parsed.pick === 2 ? parsed.pick : null;
    const confidence = Number(parsed.confidence);
    return {
      pick,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      because: String(parsed.because || "").slice(0, 160),
    };
  } catch {
    return null;
  }
}

async function breakTieWithVision(xr, slots, a, b, opts) {
  const cropA = cropFor(xr, a);
  const cropB = cropFor(xr, b);
  if (!cropA || !cropB) return { used: false, reason: "no_crops_for_both" };

  const call = opts.vision || defaultVision;
  const answer = await call({
    prompt: visionPrompt(slots.utterance, a, b),
    images: [
      { base64: cropA.buffer.toString("base64"), media_type: cropA.type === "png" ? "image/png" : "image/jpeg" },
      { base64: cropB.buffer.toString("base64"), media_type: cropB.type === "png" ? "image/png" : "image/jpeg" },
    ],
    timeoutMs: opts.visionTimeoutMs || VISION_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl || fetch,
    model: opts.visionModel || VISION_MODEL,
  }).catch((e) => ({ ok: false, reason: `vision_threw:${String((e && e.message) || e).slice(0, 60)}` }));

  if (!answer || !answer.ok) return { used: false, reason: (answer && answer.reason) || "vision_failed" };
  const read = readVisionAnswer(answer.text);
  if (!read || !read.pick || read.confidence < 0.6) {
    return { used: true, decided: false, reason: read ? "vision_not_confident" : "vision_unparseable", raw: String(answer.text || "").slice(0, 200) };
  }
  return {
    used: true,
    decided: true,
    pick: read.pick,
    confidence: read.confidence,
    because: read.because,
    usage: answer.usage || null,
    // The pixels the verdict was read off, by digest. A visual answer that
    // does not name what it looked at is the defect this codebase exists to
    // catch, so the crops it saw travel with the decision.
    saw: [
      { name: plainName(a.el || a), sha256: cropA.sha256 },
      { name: plainName(b.el || b), sha256: cropB.sha256 },
    ],
  };
}

// ---------------------------------------------------------------------------
// resolve — the whole thing
// ---------------------------------------------------------------------------
/**
 * resolve(xray, utterance, options) -> Resolution
 *
 * NEVER THROWS and never returns a target it is not entitled to. Three honest
 * shapes come out of it, and the caller reads them in this order:
 *
 *   refusal  -> say refusal.say verbatim; there is no plan.
 *   question -> ask question, then call again with the answer appended.
 *   target   -> act, using target.selector and whichever plan is set.
 *
 * @param {object}  xray       lib/page-xray.js result (ok:true)
 * @param {string}  utterance  the customer's own words
 * @param {object}  options
 *   context       { lastTarget }  what "it" refers to, from the turn before
 *   useVision     escalate a genuine tie to the crops (default true)
 *   vision        injectable caller; defaults to the Anthropic vision call
 *   fetchImpl     injectable fetch, for tests
 */
async function resolve(xray, utterance, options = {}) {
  const opts = { useVision: true, ...options };
  const said = String(utterance || "").trim();

  const base = {
    ok: false,
    utterance: said,
    verb: null,
    target: null,
    partner: null,
    geometry: null,
    plan: null,
    question: null,
    refusal: null,
    say: "",
    confidence: 0,
    candidates: [],
    vision: null,
  };

  if (!said) {
    return { ...base, refusal: { reason: "nothing_said", say: VERB_SUPPORT.unknown.say }, say: VERB_SUPPORT.unknown.say };
  }
  if (!xray || xray.ok === false || !elementsOf(xray).length) {
    const say = "I can't see your site at the minute — give me a moment and I'll pick this straight back up.";
    return { ...base, refusal: { reason: "no_xray", say }, say };
  }

  const elements = elementsOf(xray);
  const { verb, slots, support } = readRequest(said);
  base.verb = { kind: verb, ...support };

  // AN UNREADABLE REQUEST IS NOT A REFUSAL — IT IS A PROMPT TO READ THE PAGE
  // OUT. "Tell me what you'd like changed" hands the question straight back to
  // a caller who already asked it, which is the shape of the sentence that
  // lost a call. Naming what is actually on their page is an answer.
  if (verb === "unknown") {
    const offer = offerPlainList(xray);
    const q = offer
      ? `I'm looking at your site now — I can see ${offer}. Which of those did you want changed?`
      : "I'm looking at your site now. Which part would you like changed?";
    return { ...base, question: q, say: q };
  }
  if (!support.supported) {
    return { ...base, refusal: { reason: `verb_not_implemented:${verb}`, say: support.say }, say: support.say };
  }

  // THE MISSING LINK BLOCKS EVERY PHOTO EQUALLY, so asking which one first
  // spends a question that changes nothing. Measured live: "put a photo of my
  // new truck on there" asked the caller to choose between two photographs
  // and would then have had to ask for the picture anyway.
  if (verb === "replace_image" && !/https?:\/\/\S+/i.test(said)) {
    const say = "I can put a different picture in there — text me the link to the one you want and I'll drop it straight in. Or I can brighten up the one that's there now if that'd do it.";
    return { ...base, refusal: { reason: "no_image_link", say }, say };
  }

  // ---- who they mean -----------------------------------------------------
  let candidates = rank(xray, slots);

  // "move IT to the right side" — the turn before is the only place "it" can
  // come from. Resolving it silently to the highest-scoring thing on the page
  // is how a caller ends up watching the wrong thing move.
  const carried = opts.context && opts.context.lastTarget;
  // Did they name anything at all this turn? See NOT_A_NOUN.
  const namedSomething = slots.words.some((w) => !NOT_A_NOUN.has(w));
  if (slots.anaphoric && !namedSomething && carried) {
    const prior = elements.find((e) => e.selector === carried.selector || e.index === carried.index);
    if (prior) {
      const kept = decorate(prior);
      kept.why = [`this is the ${plainName(prior)} we were just talking about`];
      kept.score = 99;
      kept.carried = true;
      candidates = [kept, ...candidates.filter((c) => c.index !== prior.index)];
    }
  }

  if (!candidates.length) {
    const offer = offerPlainList(xray);
    const say = offer
      ? `I'm looking at your site now — I can see ${offer}. Which of those did you mean?`
      : "I'm looking at your site now. Tell me which part you'd like changed and I'll sort it.";
    return { ...base, question: say, say, candidates: [] };
  }

  let confidence = confidenceOf(candidates);
  let top = candidates[0];
  const second = candidates[1];
  let ambiguous = Boolean(second) && (top.score - second.score) <= AMBIGUITY_MARGIN;

  // ONE THING ON THIS PAGE IS CALLED THAT. Measured on the live Rimrock
  // mirror: "make the hero image more colourful" put the hero 1.5 ahead of a
  // photograph inside it — exactly on the ambiguity line — and asked a
  // needless question. When the caller used a word that is one candidate's
  // whole name and not the other's, that is not a coin flip.
  // Also when the caller used a real word for one and only a kind-word for
  // the other: measured live, "make the main headline text bright orange" put
  // the h1 against a paragraph 14 screens down that answered only to "text".
  if (ambiguous
    && (top.signals.noun >= CEILING.noun || top.signals.noun >= 4.5)
    && second.signals.noun <= GENERIC_SCORE) {
    ambiguous = false;
    confidence = Math.max(confidence, 0.6);
  }

  // THEY NAMED SOMETHING THIS PAGE HAS NOT GOT.
  //
  // Measured: "the social media block should go below the hero" on a mirror
  // with ZERO social links scored two anonymous <section>s at a dead tie —
  // both answered to the synonym "block", which every section answers to —
  // and produced "the one 7 screens down, or the one 3 screens down?". That
  // question is unanswerable and makes the caller feel stupid. Without a real
  // name, quoted words, or a behaviour to go on, the honest move is to read
  // the page out instead of guessing between two boxes.
  const groundedOn = top.signals.noun >= MIN_NOUN_TO_ACT
    || top.signals.text > 0
    || top.signals.behaviour > 0
    || top.carried === true;
  if (!groundedOn) {
    const offer = offerPlainList(xray);
    const q = offer
      ? `I'm not seeing that on your site — what I can see is ${offer}. Which of those did you mean?`
      : "I'm not seeing that one on your site. Tell me what it sits next to and I'll find it.";
    return { ...base, question: q, say: q, candidates, confidence };
  }

  // ---- the coin-flip, and the one place vision is worth its cost ---------
  let vision = null;
  if (ambiguous && opts.useVision !== false) {
    vision = await breakTieWithVision(xray, slots, top, second, opts);
    if (vision.decided) {
      const picked = vision.pick === 1 ? top : second;
      const other = vision.pick === 1 ? second : top;
      picked.why = [...picked.why, `looking at both, this is the one — ${vision.because}`];
      candidates = [picked, other, ...candidates.slice(2)];
      top = picked;
      ambiguous = false;
      confidence = Math.max(confidence, Math.min(0.9, vision.confidence));
    }
  }

  if (ambiguous) {
    const q = askBetween(elements, top, second);
    return {
      ...base,
      question: q,
      say: q,
      candidates,
      confidence,
      vision,
    };
  }

  if (confidence < MIN_CONFIDENCE) {
    const q = second ? askBetween(elements, top, second) : `did you mean ${describePlainly(top)}?`;
    return { ...base, question: q, say: q, candidates, confidence, vision };
  }

  // ---- put the change on the right thing ---------------------------------
  const refined = refineForVerb(elements, top, verb, slots);
  const target = refined.target;
  if (refined.moved) target.why = [...(top.why || []), refined.moved.reason];

  const out = {
    ...base,
    ok: true,
    target,
    candidates,
    confidence,
    vision,
    refined: refined.moved,
  };

  // ---- and say what it is --------------------------------------------------
  switch (verb) {
    case "resize": {
      const geometry = planResize(elements, target, slots);
      out.geometry = geometry;
      if (geometry.question) {
        return { ...out, ok: false, question: geometry.question, say: geometry.question };
      }
      const bad = geometry.warnings.filter((w) => /taller_than|wider_than/.test(w.kind));
      out.say = bad.length
        ? `I can make ${theThing(target.el)} bigger, but ${bad[0].detail}. Want me to go as big as it'll sit, or shall I make the space around it bigger too?`
        : `Right — ${theThing(target.el)} ${geometry.proposed && geometry.proposed.font_px
          ? `up to ${geometry.proposed.font_px} point`
          : `from ${geometry.current.w} by ${geometry.current.h} to ${geometry.proposed.w} by ${geometry.proposed.h}`}. Give me a minute.`;
      break;
    }
    case "move": {
      const plan = planMove(elements, target, slots);
      if (plan.question) return { ...out, ok: false, question: plan.question, say: plan.question };
      out.plan = plan;
      out.say = `Right — ${theThing(target.el)} over to the ${plan.direction}. Give me a minute.`;
      break;
    }
    case "swap": {
      const partner = pickPartner(xray, slots, target, candidates);
      if (!partner) {
        const q = `which two do you want swapped round — ${describePlainly(target)} and what else?`;
        return { ...out, ok: false, question: q, say: q };
      }
      const plan = planSwap(elements, target, partner);
      out.partner = partner;
      out.plan = plan;
      if (!plan.possible) return { ...out, ok: false, refusal: { reason: "not_in_one_row", say: plan.say }, say: plan.say };
      out.say = `Right — ${theThing(target.el)} and ${theThing(partner.el)} swapped round. Give me a minute.`;
      break;
    }
    case "reorder": {
      const anchor = pickRelated(xray, slots.relation && slots.relation.other, target);
      if (!anchor) {
        const q = `what should ${theThing(target.el)} sit under?`;
        return { ...out, ok: false, question: q, say: q };
      }
      const plan = planReorder(elements, target, anchor, (slots.relation && slots.relation.relation) || "below");
      out.partner = anchor;
      out.plan = plan;
      if (!plan.possible) return { ...out, ok: false, refusal: { reason: "not_siblings", say: plan.say }, say: plan.say };
      out.say = `Right — ${theThing(target.el)} moved ${plan.relation} ${theThing(anchor.el)}. Give me a minute.`;
      break;
    }
    case "restyle": {
      const plan = planRestyle(target, slots);
      out.plan = plan;
      const what = theThing(target.el);
      if (plan.intent.kind === "unspecified") {
        const q = `what would you like ${what} to look like — brighter, or a different colour?`;
        return { ...out, ok: false, question: q, say: q };
      }
      const doing = {
        recolour: `make ${what} ${plan.colour}`,
        saturate: `give ${what} a lot more colour`,
        brighten: `brighten ${what} up`,
        darken: `deepen ${what}`,
        warmer: `warm ${what} up`,
        cooler: `cool ${what} down`,
        weight: `make ${what} bolder`,
      }[plan.intent.kind] || `change how ${what} looks`;
      out.say = `Right — I'll ${doing}. Give me a minute.`;
      break;
    }
    case "replace_image": {
      const url = /(https?:\/\/[^\s"']+)/i.exec(said);
      if (!url) {
        const say = `I can put a different picture in there — text me the link to the one you want and I'll drop it straight in. Or I can brighten up the one that's there now if that'd do it.`;
        return { ...out, ok: false, refusal: { reason: "no_image_link", say }, say };
      }
      out.plan = { source_url: url[1], replaces: { name: plainName(target.el), selector: target.selector } };
      out.say = `Right — new picture in place of ${theThing(target.el)}. Give me a minute.`;
      break;
    }
    case "retext": {
      out.plan = { current: target.text || "", from: { name: plainName(target.el), selector: target.selector } };
      out.say = target.text
        ? `Right — that reads "${String(target.text).slice(0, 40)}" at the minute. What would you like it to say?`
        : `Right — what would you like it to say?`;
      break;
    }
    case "hide": {
      out.plan = { hides: { name: plainName(target.el), selector: target.selector }, css_hint: "display:none", must_render_to_confirm: true };
      out.say = `Right — ${theThing(target.el)} off the page. Give me a minute.`;
      break;
    }
    case "add_text": {
      out.plan = { anchor: { name: plainName(target.el), selector: target.selector }, position: (slots.relation && slots.relation.relation) === "above" ? "before" : "after" };
      out.say = `Right — I'll put that in next to ${theThing(target.el)}. Give me a minute.`;
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * The second thing in "swap X with Y" — scored against the tail of the phrase.
 *
 * A SWAPPABLE PARTNER BEATS A HIGHER-SCORING ONE. Measured on the live
 * Rimrock mirror: "the phone call button" matches four things — a header CTA,
 * a nav call button, a number inside a card, and one in the footer. The
 * top-scored was in a different part of the page from the logo, so the swap
 * was refused for not sharing a parent: a true statement about the wrong
 * pair. When the caller asks to swap two things, the reading that makes the
 * swap possible is the reading they meant.
 */
function pickPartner(xray, slots, target, candidates) {
  const elements = elementsOf(xray);
  const tail = /\b(?:with|and|for)\s+(.{2,50})$/i.exec(slots.utterance);
  const pool = tail
    ? rank(xray, readRequest(tail[1]).slots).filter((c) => c.index !== target.index)
    : candidates.filter((c) => c.index !== target.index && c.score > 1);
  if (!pool.length) return null;

  const targetEl = target.el || target;
  const best = pool[0];
  // SHARING THE ROOT IS NOT SHARING A ROW. Everything on a page shares the
  // outermost <div>, so "has a common ancestor" picks nothing. The DEEPEST
  // shared ancestor is the measure of how close together two things actually
  // sit, and closest-together is what a swap needs.
  const depthOfShared = (c) => {
    const anc = commonAncestor(elements, targetEl, c.el || c);
    return anc ? anc.depth : -1;
  };
  const bestDepth = depthOfShared(best);
  let closest = best;
  let closestDepth = bestDepth;
  for (const c of pool) {
    const d = depthOfShared(c);
    if (d > closestDepth) { closest = c; closestDepth = d; }
  }
  if (closest.index !== best.index) {
    closest.why = [...(closest.why || []), `it is the one sitting in the same part of the page as ${theThing(targetEl)}`];
  }
  return closest;
}

/** The thing named after "below"/"above" in a reorder. */
function pickRelated(xray, phrase, target) {
  if (!phrase) return null;
  const found = findByName(xray, phrase, { limit: 3 });
  if (found.ok) {
    const hit = (found.matches || []).find((m) => m.index !== target.index && m.selector);
    if (hit) return decorate(hit);
  }
  const sub = readRequest(phrase);
  const ranked = rank(xray, sub.slots).filter((c) => c.index !== target.index);
  return ranked[0] || null;
}

module.exports = {
  resolve,
  // pure, exported so every rule above is testable without a browser
  readRequest,
  readQuotedText,
  readPlaces,
  readAmount,
  readRelation,
  readSize,
  readBehaviour,
  rank,
  confidenceOf,
  planResize,
  planMove,
  planSwap,
  planReorder,
  planRestyle,
  refineForVerb,
  containerOf,
  constrainingBoxOf,
  ancestorChain,
  commonAncestor,
  descendantsOf,
  neighbourOf,
  topicOf,
  plainName,
  theThing,
  describePlainly,
  askBetween,
  offerPlainList,
  readVisionAnswer,
  visionPrompt,
  defaultVision,
  positionOf,
  layoutHandleOf,
  mediaScore,
  VERB_SUPPORT,
  AMBIGUITY_MARGIN,
  MIN_CONFIDENCE,
  MIN_NOUN_TO_ACT,
  CEILING,
};
