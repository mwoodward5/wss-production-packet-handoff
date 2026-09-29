"use strict";

/**
 * RILEY'S TALKING POINTS — the homework, done before the phone rings.
 *
 * The lookup tool hands Riley a RECORD today: rating, review_count, a preview
 * URL, a status string. He then has to work out, mid-call, what any of it
 * means and what is worth saying. That reasoning is latency, and latency is the
 * complaint ("he talks over me" was measured as 3s tool calls, not eagerness).
 *
 * So this module does the thinking once, off the call, and returns SENTENCES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAW HERE IS HARDER THAN ANYWHERE ELSE IN THIS CODEBASE.
 *
 * A talking point is a claim about a real business, said out loud, to the owner
 * of that business, who knows the truth better than we do. This system has
 * already shipped unevidenced accusations in an email. On a call there is no
 * unsend. So:
 *
 *   Every point traces to a stored measurement, and carries `src` naming it.
 *   No point is ever generated to fill a slot. Six points is a good brief;
 *   two points is an honest brief; zero points is a brief that says so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* SPOKEN, AND WHY. Three fat, well-populated fields
 * in the record look like talking points and are not. Measured over the 198
 * live rows on 2026-08-11:
 *
 * 1. `record.opportunity.reasons` (170 rows). These are LEAD-SCORING reasons,
 *    written for us, about them: "High-ticket trade — margin to invest in a
 *    better site" (107 rows) and "Already spends on ads — pays to be found, but
 *    the site underdelivers" (111 rows). Read aloud to the owner these say we
 *    called because he looked like he could pay. They are also not reasons for
 *    his GRADE, which is what a brief needs. Excluded entirely.
 *
 * 2. `record.website_probe.signals` (173 rows) — the free text, verbatim. The
 *    two most common entries are judgments wearing a measurement's clothes:
 *    "built on divi — DIY template, upgradeable" (70) and the ads line (111).
 *    Divi is a commercial theme a professional may well have chosen; telling
 *    its owner it is DIY is an insult we cannot support, and "underdelivers"
 *    is a verdict on a site we did not test for conversions. The SPEAKABLE
 *    faults below are therefore rebuilt from the STRUCTURED booleans the probe
 *    also stored — mobile, https, hasSchema, hasReviews, thin, loadMs — and
 *    worded here, where the wording is reviewable, rather than lifted.
 *
 * 3. `record.build_ready.qualification.reasons` (184 rows). Every one of these
 *    is about our gate, not their business: "website axis grades B+ (88) —
 *    measured, and the grade gate is off". Internal. Excluded.
 *
 * AND THE FAULT GUARD THAT MATTERS MOST: a fault is only spoken when the probe
 * actually ran (`analyzed` and `exists` both true) AND the specific field is
 * strictly `false`. A missing probe field is NOT a fault — that distinction is
 * the whole difference between "your site has no mobile layout" and "we never
 * looked". `probe.mobile === true` style reads elsewhere in the codebase turn
 * an absent measurement into an accusation; this module refuses to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIDE POINTS. lib/owner-pride.js converts an owner-behind-v2 extraction into
 * renderable, proven claims, and it is wired in below. It will emit NOTHING
 * today: an owner-behind extraction is stored on 0 of 1,333 prospect rows —
 * the module exists, the miner does not yet produce its input. That is reported
 * rather than papered over, and the pride that DOES exist on 136 live rows is
 * used instead: the customer's own words, verbatim, with the name attached.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EMBARGO. docs/sales/objection-playbook.md documents 16 objections. Riley is
 * given 11 globally safe answers. Answers 9 (cancellation) and 10 (ownership)
 * promise terms that /terms does not yet carry; 14-16 require report- and
 * price-specific grounding this compact brief does not yet provide. They stay
 * out at the source rather than being handed to every call without their facts.
 * See EMBARGOED_OBJECTIONS and test/riley-brief.test.js.
 */

const { prideFromExtraction } = require("./owner-pride");
const { contactOf, ourWorkOf, reputationOf, siteProblemsOf } = require("./prospect-detail");
const { gradeRank } = require("./build-qualification");

// Above this on the WEBSITE axis, the site we are about to discuss is a decent
// site. Riley does not attack it. Matches the owner's own build rule (skip B-
// or better) so the call and the pipeline share one opinion of "good enough".
const DONT_ATTACK_AT_OR_ABOVE = "B-";

const MAX_POINTS = 6;
const MAX_FAULTS = 2;
const MAX_ANSWERS = 3;
const MAX_QUOTE_CHARS = 200;

/**
 * Answers lifted from docs/sales/riley-metaphor-bank.md, by row number, and
 * shortened to the sentence Riley actually needs when a caller asks "what does
 * that mean?". test/riley-brief.test.js asserts each `full` below is still
 * byte-identical to its row in the doc, so the doc stays the source of truth
 * and a silent edit there fails the suite instead of drifting.
 */
const METAPHORS = Object.freeze({
  mobile: Object.freeze({
    row: 1,
    full: "Your website should fit a phone as cleanly as it fits a desktop. It’s like having a service truck where every tool stays reachable whether you park in a driveway or a tight alley.",
  }),
  speed: Object.freeze({
    row: 2,
    full: "Your pages need to open fast. If a customer has to stand at the door waiting five seconds before anybody answers, there’s a good chance they walk to the next shop.",
  }),
  schema: Object.freeze({
    row: 5,
    full: "Schema is hidden labeling that tells Google, “this is the phone number, this is the service, this is the address, these are the reviews.” It’s like labeling the breakers in a panel so nobody has to guess what each one controls.",
  }),
  ssl: Object.freeze({
    row: 6,
    full: "SSL is the security lock on your website. It keeps information moving between the customer and your site from being easily intercepted, like locking the service van instead of leaving the doors wide open.",
  }),
  reviews: Object.freeze({
    row: 11,
    full: "Reviews show both customers and Google whether people trust you to finish the job. They work like word-of-mouth at scale: one happy homeowner tells the neighbor; 200 good reviews tell the whole town.",
  }),
  content: Object.freeze({
    row: 32,
    full: "Website content is simply the words, photos, and information that answer a customer’s questions. Good content should work like a good estimator: answer what the job is, what you handle, and why they should trust you.",
  }),
});

/** Playbook answers Riley may speak, verbatim. Keys are the objection number. */
const OBJECTIONS = Object.freeze([
  Object.freeze({ n: 1, on: "already has a website guy", say: "That’s fine. I’m not asking you to fire anybody. We already built yours, so just compare the two. If your guy’s doing a better job, keep him. If ours makes more sense, you’ll know." }),
  Object.freeze({ n: 2, on: "nephew built mine", say: "Nothing wrong with that. Keep him involved. We already built another version for you, so take a look. If there’s nothing there worth changing, you haven’t lost a dime." }),
  Object.freeze({ n: 3, on: "all my work is word of mouth", say: "That’s actually the best kind of business. The website isn’t replacing word of mouth. It’s what people see after somebody gives them your name. We just make sure the referral likes what he finds." }),
  Object.freeze({ n: 4, on: "$149 is too much", say: "Then don’t buy it unless it earns its keep. Look at what we built first. If you can’t see $149 worth of value in it, there’s no reason for me to talk you into it." }),
  Object.freeze({ n: 5, on: "already paying someone", say: "Then definitely don’t pay twice. Compare what they’re giving you with what we built. If theirs wins, stay put. If ours wins, then you can decide whether switching makes sense." }),
  Object.freeze({ n: 6, on: "burned by a marketing company", say: "I don’t blame you for being cautious. That’s exactly why we built the thing before asking you for money. No promises—you can open the link and judge what we actually did." }),
  Object.freeze({ n: 7, on: "how did you get my information", say: "Nothing private. We found the same public business information your customers can find online—your website, Google listing, services, photos and reviews—and used that to put the sample together." }),
  Object.freeze({ n: 8, on: "is this AI", say: "Fair. Riley isn’t there to pretend he’s you. He handles the basic stuff when you can’t answer—who’s calling, what they need, where they are—and gets it to you so you can take over." }),
  Object.freeze({ n: 11, on: "too busy, call me later", say: "Totally fine. There’s actually nothing for you to work on—we already built it. I’ll leave the link with you. Look at it whenever you get five minutes, and if you like it, you know where to find me." }),
  Object.freeze({ n: 12, on: "why is it so cheap", say: "We figured out how to build these without charging somebody five grand up front. We’d rather earn $149 a month by keeping it working than make our money before you’ve even seen the thing." }),
  Object.freeze({ n: 13, on: "I don’t understand computer stuff", say: "You shouldn’t have to understand it. You know your business. Tell Riley, ‘change my hours,’ ‘add water heaters,’ or ‘put this photo on the site.’ That’s the whole idea." }),
]);

/**
 * Withheld until /terms carries real cancellation and ownership language. Both
 * playbook answers commit us to SHOWING terms; there is nothing to show, so the
 * promise would be the lie. Riley takes the question and hands it on.
 */
const EMBARGOED_OBJECTIONS = Object.freeze([
  Object.freeze({ n: 9, on: "what if I want to cancel" }),
  Object.freeze({ n: 10, on: "do I own the site" }),
]);

const EMBARGO_INSTRUCTION =
  "If they ask about CANCELLING or about WHO OWNS the site: do not answer either one, and do not reassure. Say you will not guess at contract terms, take the question, and tell them Mark will put the answer in writing before they pay anything.";

const NEVER = Object.freeze([
  "Never say a number that is not in this brief. No traffic estimates, no lost-revenue math, no ranking positions.",
  "Never tell them their business is failing or that they are losing customers. We did not measure that.",
  EMBARGO_INSTRUCTION,
]);

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

// Google review bodies arrive carrying zero-width marks (U+200B..U+200F) and a
// BOM, plus hard newlines. All of it is invisible on a page and unspeakable on
// a call. Written as escapes on purpose: the literal characters are invisible
// in an editor too, and an invisible character inside a character class is how
// a regex silently becomes something else.
const INVISIBLE = new RegExp("[\\u200B-\\u200F\\uFEFF]", "g");

/** Whitespace- and mark-normalised. Not one VISIBLE character is changed. */
function speakable(value) {
  return text(value).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

function probeOf(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const probe = record.website_probe && typeof record.website_probe === "object" ? record.website_probe : {};
  // A fault may only be spoken from a probe that actually ran against a site
  // that actually answered. Anything else and every `false` below is really an
  // "unknown" wearing a fault's clothes.
  const ran = probe.analyzed === true && probe.exists === true;
  return { probe, ran };
}

/** Their measured faults, worded here, capped, and only when measured false. */
function speakableFaults(row) {
  const { probe, ran } = probeOf(row);
  if (!ran) return [];
  const out = [];

  if (probe.mobile === false) {
    out.push({
      topic: "mobile",
      say: "Your site doesn’t have a mobile layout — it doesn’t resize for a phone. You can see it yourself in about five seconds.",
      src: "record.website_probe.mobile=false",
    });
  }
  if (probe.https === false) {
    out.push({
      topic: "ssl",
      say: "Your site isn’t on a secure address, so some browsers put a warning in front of it.",
      src: "record.website_probe.https=false",
    });
  }
  if (probe.hasReviews === false) {
    out.push({
      topic: "reviews",
      say: "None of your reviews are shown anywhere on your own site — they’re all sitting over on Google.",
      src: "record.website_probe.hasReviews=false",
    });
  }
  const loadMs = Number(probe.loadMs);
  if (Number.isFinite(loadMs) && loadMs >= 4000) {
    out.push({
      topic: "speed",
      say: `Your homepage took ${(loadMs / 1000).toFixed(1)} seconds to answer when we checked it.`,
      src: `record.website_probe.loadMs=${Math.round(loadMs)}`,
    });
  }
  const words = Number(probe.wordCount);
  if (probe.thin === true && Number.isFinite(words) && words > 0) {
    out.push({
      topic: "content",
      say: `Your homepage has about ${words} words on it, so there isn’t much for a customer — or Google — to read.`,
      src: `record.website_probe.wordCount=${words}`,
    });
  }
  if (probe.hasSchema === false) {
    out.push({
      topic: "schema",
      say: "Your site doesn’t carry the hidden labels that tell Google which line is your phone number, your address and your reviews.",
      src: "record.website_probe.hasSchema=false",
    });
  }
  // The copyright year is only trustworthy where the probe wrote it out; the
  // year itself comes from that string, never from arithmetic on ageYears.
  for (const signal of Array.isArray(probe.signals) ? probe.signals : []) {
    const year = /copyright still says (\d{4})/i.exec(text(signal));
    if (year) {
      out.push({
        topic: "stale",
        say: `The copyright line at the bottom of your site still says ${year[1]}.`,
        src: "record.website_probe.signals[copyright]",
      });
      break;
    }
  }
  return out;
}

/** What OUR version demonstrably carries, from build evidence, not from hope. */
function whatOursCarries(row) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const ready = record.build_ready && typeof record.build_ready === "object" ? record.build_ready : {};
  const brand = ready.brand_evidence && typeof ready.brand_evidence === "object" ? ready.brand_evidence : {};
  const request = ready.mirror_request && typeof ready.mirror_request === "object" ? ready.mirror_request : {};
  const content = request.content && typeof request.content === "object" ? request.content : {};

  const carries = [];
  const src = [];
  // The logo only counts when the evidence says it came off THEIR domain. This
  // codebase has served a manufacturer's badge as a client's identity before.
  if (brand.logo_url && /own\b.*domain|registrable/i.test(text(brand.source))) {
    // No commas inside any item: these get read aloud as one list, and a comma
    // inside a list item is a stumble in the middle of the best sentence we have.
    carries.push("your own logo off your own site");
    src.push("build_ready.brand_evidence.source");
  }
  if (brand.accent && /measured_from_logo/i.test(text(brand.accent_origin))) {
    carries.push("your colour measured out of it");
    src.push("build_ready.brand_evidence.accent_origin");
  }
  const reviews = Array.isArray(content.reviews) ? content.reviews.filter((r) => text(r && r.text)) : [];
  if (reviews.length) {
    carries.push(`${reviews.length} of your real Google reviews with the customers’ names`);
    src.push("build_ready.mirror_request.content.reviews");
  }
  const hours = Array.isArray(content.hours) ? content.hours.filter((h) => text(h && (h.text || h.hours))) : [];
  if (hours.length) {
    carries.push("your hours");
    src.push("build_ready.mirror_request.content.hours");
  }
  return { carries, src };
}

/** One customer's words, verbatim and whole, or nothing. Never truncated. */
function customerQuote(row) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const reviews = record.build_ready
    && record.build_ready.mirror_request
    && record.build_ready.mirror_request.content
    && Array.isArray(record.build_ready.mirror_request.content.reviews)
    ? record.build_ready.mirror_request.content.reviews
    : [];

  const usable = reviews
    .map((review) => ({
      // Reviews arrive from Google with zero-width marks and hard newlines
      // inside them. Those are invisible on a page and unspeakable on a call,
      // so they are stripped; not one visible character is changed.
      body: speakable(review && review.text),
      author: text(review && review.author),
      rating: Number(review && review.rating),
    }))
    .filter((review) => review.body && review.author && review.body.length <= MAX_QUOTE_CHARS)
    // Shortest first: a quote Riley can actually deliver in one breath. A long
    // review is not shortened — a trimmed quote is a misquote.
    .sort((left, right) => left.body.length - right.body.length);

  return usable[0] || null;
}

/** The whole brief, for one row. Pure: no I/O, no clock, no env. */
function rileyBrief(row = {}, { includeObjections = true } = {}) {
  const contact = contactOf(row);
  const reputation = reputationOf(row);
  const problems = siteProblemsOf(row);
  const work = ourWorkOf(row);
  const record = row.record && typeof row.record === "object" ? row.record : {};

  const name = text(row.business_name || record.business_name || record.businessName);
  const where = [contact.city, contact.state].filter(Boolean).join(", ");
  const points = [];
  const topics = [];

  // 1. WHERE THEY STAND. The one fact that proves we looked them up rather
  //    than dialled a list, and the only flattering thing we can prove.
  if (reputation.rating && reputation.reviewCount) {
    points.push({
      say: `You’re at ${reputation.rating} stars across ${reputation.reviewCount.toLocaleString()} Google reviews.`,
      src: "record.rating + record.review_count",
    });
    topics.push("reviews");
  }

  // 2. WHAT IS ALREADY BUILT, and what of theirs is inside it.
  const ours = whatOursCarries(row);
  if (work.mirrorUrl) {
    const tail = ours.carries.length ? ` It’s got ${joinPlainly(ours.carries)}.` : "";
    points.push({
      say: `There’s a finished version of your site already built — nothing owed, nothing signed.${tail}`,
      src: ["preview_url", ...ours.src].join(" + "),
    });
  }

  // 3. THEIR SITE, but only the measured part, and only if it needs saying.
  const faults = speakableFaults(row);
  const websiteGrade = text(problems.websiteGrade && problems.websiteGrade.grade);
  const gradeIsGood = websiteGrade
    && gradeRank(websiteGrade) >= gradeRank(DONT_ATTACK_AT_OR_ABOVE);
  const spokenFaults = gradeIsGood ? [] : faults.slice(0, MAX_FAULTS);
  for (const fault of spokenFaults) {
    points.push({ say: fault.say, src: fault.src });
    topics.push(fault.topic);
  }

  // 4. THEIR OWN CUSTOMER, in their own words. The closest thing to a pride
  //    point that exists in the data today (see the header on owner-pride).
  const quote = customerQuote(row);
  if (quote && points.length < MAX_POINTS) {
    points.push({
      say: `One of your reviews, ${quote.author}’s, is on it word for word: “${quote.body}”`,
      src: "build_ready.mirror_request.content.reviews[shortest]",
    });
  }

  // 5. PRIDE, when the miner ever produces an owner-behind extraction. Wired,
  //    proven by test, and silent on every row in production today.
  const pride = prideFromExtraction(record.owner_behind, { clientDomain: hostOf(contact.theirWebsite) });
  if (pride && pride.sections) {
    for (const [key, entry] of prideLines(pride)) {
      if (points.length >= MAX_POINTS) break;
      points.push({ say: entry, src: `record.owner_behind → owner-pride.${key}` });
    }
  }

  const answers = [];
  for (const topic of dedupe(topics)) {
    const metaphor = METAPHORS[topic];
    if (metaphor && answers.length < MAX_ANSWERS) {
      answers.push({ on: topic, say: metaphor.full });
    }
  }

  const unknown = [];
  if (!contact.person) unknown.push("We have no name for whoever answers. Ask who you’re speaking to; never guess at one.");
  if (gradeIsGood) {
    unknown.push(`Their site measured ${websiteGrade} on our own scale — do not tell them it is bad. Lead with what ours carries and let them compare.`);
  }
  if (!faults.length && !gradeIsGood) {
    unknown.push("We have nothing measured against their current site. Do not invent a fault — talk about what ours already has.");
  }

  return {
    who: [name, where].filter(Boolean).join(" — "),
    points: points.slice(0, MAX_POINTS),
    answers,
    ...(includeObjections ? { objections: OBJECTIONS.map(({ on, say }) => ({ on, say })) } : {}),
    never: NEVER,
    unknown,
  };
}

function joinPlainly(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch { return ""; }
}

/** Pride sections rendered as spoken lines. Verbatim values, never reworded. */
function prideLines(pride) {
  const out = [];
  const s = pride.sections || {};
  if (s.tagline && s.tagline.value) out.push(["tagline", `Your own line — “${s.tagline.value}” — is on it.`]);
  if (s.heritage && s.heritage.value) out.push(["heritage", `It says ${s.heritage.value}.`]);
  if (s.ownership && s.ownership.value) out.push(["ownership", `It says ${s.ownership.value}.`]);
  if (Array.isArray(s.credentials) && s.credentials.length) {
    out.push(["credentials", `Your credentials are on it: ${s.credentials.map((c) => c.label).join(", ")}.`]);
  }
  if (Array.isArray(s.plans) && s.plans.length) {
    out.push(["plans", `Your plans are on it with your prices: ${s.plans.map((p) => `${p.name} at ${p.price}`).join(", ")}.`]);
  }
  return out;
}

module.exports = {
  DONT_ATTACK_AT_OR_ABOVE,
  EMBARGOED_OBJECTIONS,
  EMBARGO_INSTRUCTION,
  METAPHORS,
  NEVER,
  OBJECTIONS,
  customerQuote,
  rileyBrief,
  speakableFaults,
  whatOursCarries,
};
