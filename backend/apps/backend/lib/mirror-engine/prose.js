"use strict";

// lib/mirror-engine/prose.js — an empty optional value must take its SENTENCE
// with it, not leave a hole in the middle of one.
//
// THE DEFECT THIS FILE EXISTS TO END (observed on deployed mirrors):
//
//   donor:     <p class="hero-note">Ask for {{OWNER_NAME}} · {{CITY}}, {{REGION}}</p>
//   rendered:  "Ask for  · Sterling, VA"
//
//   donor:     <p>Call {{BUSINESS_NAME}} and ask for {{OWNER_NAME}} to start …</p>
//   rendered:  "Call AllTech Services, Inc and ask for  to start the conversation."
//
// Both PASSED every existing gate. tokenScan is clean (nothing raw survived),
// the parse gate is clean (the HTML is valid), identityScan is clean (no donor
// atom leaked). The output is simply not English. A blank is the CORRECT value
// — TRUTH LAW forbids inventing an owner name — so the bug is not the blank,
// it is the donor writing prose around a slot that is allowed to be empty.
//
// hydrate.js already collapses a whole ELEMENT via data-collapse-if-empty. That
// cannot help here for two reasons: the phrase is a fragment INSIDE an element
// (removing the <p> would delete the city too), and on the compiled-SPA donors
// the copy lives in minified .js template literals where there is no element to
// collapse at all.
//
// So this module adds three things:
//
//  1. PHRASE MARKERS — [[NEED:TOKEN[,TOKEN…]]]…[[/NEED]] wrap the fragment that
//     only makes sense when those tokens are ALL non-blank. Plain text, inert in
//     HTML, JS string literals and JSON alike, so a compiled donor can carry
//     them. When any listed token is blank the whole fragment disappears.
//     (Deliberately NOT the same semantics as data-collapse-if-empty, which
//     removes an element when EVERY listed token is blank. A phrase needs all
//     of its values; an element survives while any of its values survives.
//     Different question, different name.)
//
//     A token may be written !TOKEN, which NEEDS that token to be BLANK. That
//     one character is what lets a donor carry the fallback as well as the
//     thing it replaces:
//
//       [[NEED:PHONE]]<a class="primary" href="tel:…">Call …</a>[[/NEED]]
//       [[NEED:!PHONE]]<a class="primary" href="/contact">Request a quote</a>[[/NEED]]
//
//     Deleting a call CTA is only half the job — a phone-less business still
//     has to convert somebody, so the lead form has to inherit the primary
//     slot rather than the page losing its loudest button. Same marker, same
//     parser, same close tag: "keep this fragment when these conditions hold".
//
//  2. UNGUARDED-SLOT LINT — after collapsing, any OPTIONAL token that is blank
//     for THIS build and still sits welded to literal copy is a defect. The
//     test is structural, not linguistic: the slot is safe only when the token
//     is the entire value of its container (whole attribute, whole string
//     literal, whole element body, whole line). Anything else means literal
//     characters will close over an empty hole.
//
//  3. RENDERED-TEXT ARTIFACT SCAN — the backstop that reads what a human reads.
//     "QC PASS is never proof, always render the DOM": this runs over
//     document.body.innerText from a real browser, where a collapsed slot shows
//     up as "for ·", "for to", a line that ends in "and", or an orphan comma.
//
// Precision over recall, everywhere. A false failure blocks a good mirror, so
// every pattern here is one that cannot occur in copy anybody wrote on purpose.

const PHRASE_OPEN_RE = /\[\[NEED:([A-Z_,!\s]+)\]\]/;
const PHRASE_CLOSE = "[[/NEED]]";
// Any marker residue in shipped bytes means the collapse pass did not run over
// that file. Fail closed on it exactly like a raw {{TOKEN}}.
const PHRASE_RESIDUE_RE = /\[\[NEED:[A-Z_,!\s]*\]\]|\[\[\/NEED\]\]/;

/**
 * One condition from a phrase marker's token list.
 *   "PHONE"  -> PHONE must be NON-blank
 *   "!PHONE" -> PHONE must be BLANK
 * Returns null for a malformed entry ("!" alone), which the caller treats as a
 * donor defect rather than silently satisfying.
 */
function phraseCondition(entry, isBlankToken) {
  const raw = String(entry).trim();
  const negated = raw.startsWith("!");
  const token = (negated ? raw.slice(1) : raw).trim();
  if (!/^[A-Z_]+$/.test(token)) return null;
  return negated ? isBlankToken(token) : !isBlankToken(token);
}

/**
 * collapsePhrases(text, isBlankToken)
 * Replaces every [[NEED:A,!B]]…[[/NEED]] span with its inner text when EVERY
 * listed condition holds (A has a value, B is blank), and with "" otherwise.
 * Innermost-first so nesting behaves; unbalanced or malformed markers throw (a
 * donor defect that must never ship silently).
 */
function collapsePhrases(text, isBlankToken) {
  let out = String(text);
  let guard = 0;
  for (;;) {
    if (++guard > 5000) throw new Error("phrase collapse did not converge");
    const open = PHRASE_OPEN_RE.exec(out);
    if (!open) break;
    // Innermost open marker: the last one before the first close marker.
    const closeAt = out.indexOf(PHRASE_CLOSE, open.index);
    if (closeAt === -1) throw new Error(`unclosed [[NEED:${open[1].trim()}]] phrase marker`);
    let lastOpen = open;
    for (;;) {
      const re = new RegExp(PHRASE_OPEN_RE.source, "g");
      re.lastIndex = lastOpen.index + lastOpen[0].length;
      const next = re.exec(out);
      if (!next || next.index > closeAt) break;
      lastOpen = next;
    }
    const tokens = lastOpen[1].split(",").map((t) => t.trim()).filter(Boolean);
    const bodyStart = lastOpen.index + lastOpen[0].length;
    const conditions = tokens.map((t) => phraseCondition(t, isBlankToken));
    if (!tokens.length || conditions.some((c) => c === null)) {
      throw new Error(`malformed [[NEED:${lastOpen[1].trim()}]] phrase marker`);
    }
    const keep = conditions.every(Boolean);
    const body = out.slice(bodyStart, closeAt);
    out = out.slice(0, lastOpen.index) + (keep ? body : "") + out.slice(closeAt + PHRASE_CLOSE.length);
  }
  if (out.includes(PHRASE_CLOSE)) throw new Error("stray [[/NEED]] with no opening marker");
  return out;
}

// ---------------------------------------------------------------------------
// Unguarded-slot lint
// ---------------------------------------------------------------------------
// A slot is SAFE only when the token fills its whole container. Pairs are
// checked by STRICT adjacency — `"{{OWNER_NAME}}, Operator"` has a quote on the
// left and looks fine until you notice the comma on the right, which is exactly
// how ", Operator" shipped.
const SAFE_PAIRS = new Set(['""', "''", "``", "><", "()", "[]", "{}"]);

function lineAround(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  return { start, end, line: text.slice(start, end) };
}

/**
 * unguardedSlots(text, { isBlankToken, tokens })
 * Returns [{ token, excerpt, index }] for blank OPTIONAL tokens welded into
 * literal copy. Run AFTER element collapse and phrase collapse, BEFORE
 * substitution — anything still standing is genuinely going to render.
 */
function unguardedSlots(text, { isBlankToken, tokens }) {
  const src = String(text);
  const hits = [];
  for (const token of tokens) {
    if (!isBlankToken(token)) continue;
    const needle = `{{${token}}}`;
    let i = -1;
    while ((i = src.indexOf(needle, i + 1)) >= 0) {
      const prev = i > 0 ? src[i - 1] : "";
      const next = src[i + needle.length] || "";
      if (SAFE_PAIRS.has(prev + next)) continue;
      const { start, end, line } = lineAround(src, i);
      // A token alone on its own line has nothing to weld to.
      if (line.trim() === needle) continue;
      // Nothing but whitespace on either side within the line is equally safe.
      const before = src.slice(start, i);
      const after = src.slice(i + needle.length, end);
      if (!before.trim() && !after.trim()) continue;
      hits.push({
        token,
        index: i,
        excerpt: src.slice(Math.max(0, i - 60), i + needle.length + 60).replace(/\s+/g, " ").trim(),
      });
      if (hits.length >= 40) return hits;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Rendered-text artifact scan
// ---------------------------------------------------------------------------
// Word pairs that can only appear when something was deleted between them.
// Conservative on purpose: "and to" and "for the" are legal English and are NOT
// listed, because a gate that fails good copy gets switched off.
// "call to" ("Call to begin") and "ask to" ("Ask to see the estimate") are real
// headings on a real donor — they were caught by an earlier draft of this list
// and would have failed a perfectly good mirror. Only prepositions that cannot
// legally be followed by another preposition survive here.
const BROKEN_PAIRS = [
  ["for", ["to", "and", "or", "with", "in", "at", "on", "of"]],
  ["by", ["to", "and", "or", "for", "with", "in", "at", "on", "of"]],
  ["with", ["to", "for", "and", "or", "in", "at", "on", "of"]],
  ["from", ["to", "and", "or", "for", "with", "at", "on", "of"]],
  ["of", ["to", "and", "or", "for", "with", "in", "at", "on"]],
];
// ---------------------------------------------------------------------------
// A PHRASAL-VERB PARTICLE IS NOT A DANGLING PREPOSITION
// ---------------------------------------------------------------------------
// Same failure shape as the state-code exemption below, found the same way —
// by rendering. Two mirrors built, deployed and aliased cleanly, passed all
// thirteen other checks, and died on route_render over one FAQ heading each:
//
//   "What should I look for in a full-service HVAC provider in Texas?"
//   "What Should I Look for in Plumbing Services?"
//
// Nothing was deleted. In "look for", "for" is a PARTICLE bound to the verb,
// not a preposition looking for an object, so the next prepositional phrase
// ("in a provider") is ordinary English. The rule read "for in" as a collapsed
// slot and refused two perfectly good pages.
//
// The exemption is deliberately narrow, and in particular it is NOT "any
// preposition after a phrasal verb":
//
//   · "to" is never exempt. "Call AllTech and ask for to start the
//     conversation" IS a hole where the owner's name used to be, it is a real
//     defect in the corpus, and it stays caught — which is why the second word
//     is the discriminator rather than the verb alone. "for to" is not legal
//     English in any construction.
//   · only in/at/on qualify — the prepositions that genuinely head a following
//     phrase. "for and", "for or", "for with", "for of" stay caught.
//   · only after a listed verb that actually takes "for" as a particle. A bare
//     "for in" with no such verb in front of it is still a defect.
const FOR_PARTICLE_VERB = /\b(look|looks|looked|looking|ask|asks|asked|asking|search|searches|searched|searching|watch|watches|watched|watching|shop|shops|shopped|shopping|pay|pays|paid|paying|care|cares|cared|caring|check|checks|checked|checking|budget|budgets|budgeted|budgeting|plan|plans|planned|planning|prepare|prepares|prepared|preparing|account|accounts|accounted|accounting|allow|allows|allowed|allowing|aim|aims|aimed|aiming|opt|opts|opted|opting|settle|settles|settled|settling|qualify|qualifies|qualified|qualifying|charge|charges|charged|charging|wait|waits|waited|waiting|hope|hopes|hoped|hoping|apply|applies|applied|applying)\s+$/i;
const FOR_PARTICLE_NEXT = new Set(["in", "at", "on"]);

function isPhrasalForParticle(line, m) {
  if (String(m[0]).slice(0, 3).toLowerCase() !== "for") return false;
  if (!FOR_PARTICLE_NEXT.has(String(m[1]).toLowerCase())) return false;
  return FOR_PARTICLE_VERB.test(line.slice(0, m.index));
}

const BROKEN_PAIR_RES = BROKEN_PAIRS.map(([a, bs]) => ({
  name: `dangling_word:"${a} ${bs[0]}…"`,
  re: new RegExp(`\\b${a}\\s+(${bs.join("|")})\\b`, "i"),
  skip: (line, m) => isStateCode(m[1]) || isPhrasalForParticle(line, m),
}));

// ---------------------------------------------------------------------------
// A TWO-LETTER PROPER NOUN IS NOT A FUNCTION WORD
// ---------------------------------------------------------------------------
// Every rule below hunts for a hole where a value used to be. Two US postal
// codes are spelled exactly like the English words those rules hunt for:
//
//   OR — Oregon      "Portland, OR"            read as a trailing conjunction
//   IN — Indiana     "serving all of IN"       read as a stacked preposition
//
// This is what refused the owner's Portland run. Six plumbing mirrors built,
// deployed and aliased cleanly; all six died on route_render, and every single
// artifact was the state code: "PORTLAND · OR" (header chip), "PORTLAND, OR"
// (hero locality) and a stat tile whose entire value is "OR". Measured on the
// deployed pages, not inferred. The rule had been correct for a month because
// no run had ever targeted Oregon; the store holds exactly six OR prospects and
// they are these six.
//
// The state code is the value the engine ITSELF substituted for {{STATE}} — the
// precise opposite of a collapsed slot. So the exemption is deliberately narrow:
//   · only these two-letter codes, never "and"/"for"/"with"/"by"/"from";
//   · only when the code is UPPERCASE in the scanned text, so a genuinely
//     dangling lowercase conjunction ("Repairs, replacements, or") still fails;
//   · and, for a trailing code, only in locality shape — the whole line, or
//     after a comma/bullet/pipe/dash, as "City, ST" is always written.
// The list is every USPS state and territory code so the next run cannot be
// refused by a state nobody thought to test.
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

/** True only for a code written exactly as a state code is written: "OR", never "or". */
function isStateCode(word) {
  const w = String(word || "");
  return /^[A-Z]{2}$/.test(w) && STATE_CODES.has(w);
}

// The separators a locality is written with: "Portland, OR", "Portland · OR".
const LOCALITY_LEAD_RE = /[,·•|/–—-][ \t ]*$/;

/**
 * A trailing word that is really the state half of a locality — either standing
 * alone as its own value ("OR" in a stat tile) or following a locality
 * separator. `m.index` is where the connector match began on the trimmed line.
 */
function isTrailingStateCode(line, m) {
  if (!isStateCode(m[1])) return false;
  const before = String(line).slice(0, m.index);
  return !before.trim() || LOCALITY_LEAD_RE.test(before);
}

// A separator glued to a connective word ("Ask for ·") or to another separator,
// a line that starts or ends on a separator, a trailing conjunction, an orphan
// comma, an empty bracket pair.
const ARTIFACT_RULES = [
  // An em dash is normal punctuation ("Tell us what's going on — leak, age,
  // storm") and a live donor page proved it: an earlier draft that accepted
  // dashes here failed a perfectly good /our-process page. Only a BULLET or
  // PIPE directly after a preposition is a hole where a value used to be.
  { name: "connector_then_separator", re: /\b(?:for|by|from|with|of|ask for)\s+[·•|]/i },
  { name: "separator_then_separator", re: /[·•|]\s*[·•|]/ },
  //   is deliberate: donors separate chips with NON-BREAKING spaces
  // ("  ·  "), and [ \t] alone silently missed every one of them.
  { name: "line_starts_with_separator", re: /(?:^|\n)[ \t ]*[·•|,;:][ \t ]*\S/ },
  // A trailing ":" is a label ("Services:") and a trailing "," is a wrapped
  // address line. Only a bullet/pipe left hanging is unambiguously a hole.
  { name: "line_ends_with_separator", re: /\S[ \t ]*[·•|][ \t ]*(?:\n|$)/ },
  // "Call" and "Contact" are button labels; a line ending in a PREPOSITION is
  // not. Kept deliberately short for the same reason as BROKEN_PAIRS.
  // The skip is the state-code exemption below: "Portland, OR" ends in a proper
  // noun, not a conjunction. See isTrailingStateCode.
  {
    name: "line_ends_with_connector",
    re: /\b(and|or|for|with|by|from|led by)[ \t ]*(?:\n|$)/i,
    skip: isTrailingStateCode,
  },
  { name: "orphan_comma", re: /,\s*[,.;:]|\s+,/ },
  { name: "empty_brackets", re: /\(\s*\)|\[\s*\]|«\s*»|"\s*"/ },
  // A LEGAL SUFFIX IS NOT A SENTENCE END. "Simmons Plumbing and Mechanical
  // LLC. · All rights reserved" is a correct copyright line, and this rule read
  // the period in "LLC." as a full stop and the "·" after it as a sentence
  // opening with punctuation — failing route_render, which fails the whole
  // mirror. Every business named LLC./Inc./Co./Ltd. was refused for having a
  // legal suffix in its own name. The lookbehind exempts those abbreviations
  // (and single initials, as in "J. R. Smith · Plumbing") while still catching
  // the real defect this rule exists for: a genuine sentence followed by an
  // orphaned separator where a collapsed token used to be.
  // The lookbehind deliberately excludes the period itself — it tests the TOKEN
  // in front of the full stop. It is also case-sensitive: an /i flag would make
  // the trailing [A-Z] (single initials, "J. R. Smith") match any letter at all
  // and silently disable the whole rule, so both casings are listed instead.
  {
    name: "sentence_starts_with_punctuation",
    re: /(?<!\b(?:LLC|INC|CO|CORP|LTD|LP|LLP|PLLC|PC|GMBH|Llc|Inc|Co|Corp|Ltd|Pllc|[A-Z]))[.!?]\s+[,;:·•]/,
  },
  ...BROKEN_PAIR_RES,
];

/**
 * proseArtifacts(text) — scan RENDERED text (innerText). Returns
 * [{ rule, excerpt }]. Matching is per-line so an excerpt is readable and a
 * newline can never fake a "line ends with…" hit inside a paragraph.
 */
function proseArtifacts(text) {
  const hits = [];
  const lines = String(text || "").split(/\n+/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    for (const rule of ARTIFACT_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      // A rule may name the one shape that looks like its defect but is not.
      // Kept as a predicate rather than more regex because the question is
      // "what word is this", which a lookbehind cannot ask.
      if (typeof rule.skip === "function" && rule.skip(line, m)) continue;
      hits.push({
        rule: rule.name,
        excerpt: line.slice(Math.max(0, m.index - 45), m.index + m[0].length + 45).trim(),
      });
      if (hits.length >= 25) return hits;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Server-side HTML text scan
// ---------------------------------------------------------------------------
// The one artifact a browser HIDES: CSS collapses whitespace, so
// "ask for  to start" renders as "ask for to start" — grammatical-looking
// nonsense that innerText can never reveal. The double space survives in the
// bytes, and inside a single text node it is always a deleted value.
function htmlTextNodes(html) {
  const src = String(html || "")
    .replace(/<(script|style|noscript|template|svg|pre|code)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const nodes = [];
  let last = 0;
  const tagRe = /<[^>]*>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    last = m.index + m[0].length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

/** Double-space-inside-a-sentence artifacts in shipped HTML text nodes. */
function collapsedValueGaps(html) {
  const hits = [];
  for (const node of htmlTextNodes(html)) {
    for (const line of node.split("\n")) {
      const m = /\S {2,}\S/.exec(line);
      if (!m) continue;
      hits.push({
        rule: "collapsed_value_gap",
        excerpt: line.slice(Math.max(0, m.index - 45), m.index + m[0].length + 45).trim(),
      });
      if (hits.length >= 25) return hits;
    }
  }
  return hits;
}

module.exports = {
  collapsePhrases,
  phraseCondition,
  unguardedSlots,
  proseArtifacts,
  collapsedValueGaps,
  htmlTextNodes,
  PHRASE_RESIDUE_RE,
  ARTIFACT_RULES,
};
