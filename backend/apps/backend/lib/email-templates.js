"use strict";

const { emailGreetingName } = require("./owner-greeting");

// ---------------------------------------------------------------------------
// POLICY MIGRATION: CONSENT-FIRST -> PROOF-FIRST (owner directive 2026-07-30,
// applied to the text layer 2026-07-31).
//
// These bodies are the PLAIN-TEXT half of the same multipart email whose HTML
// half lives in lib/outreach-email-v2.js. When the HTML was inverted to
// proof-first ("I went ahead and rebuilt the site — here it is") the text half
// was left saying the opposite: "I have not built or published anything for
// {{business_name}}". Both parts shipped, in the same message. A recipient
// reading the text alternative — or any spam filter comparing the two — got a
// flat contradiction, and the sentence that was left behind was the FALSE one:
// lib/email.js now REFUSES to send sequence 1 unless a real preview exists.
//
// So this is not a softening of the consent promise. The consent promise was
// "we will not build anything until you ask"; the owner reversed that product
// decision, and the guarantees that survive it are restated below verbatim in
// every step: your current website is untouched, and one reply takes the
// preview down. The retired sentences are recorded here so the change is
// legible rather than silent:
//   step 1  "If you'd like, reply and I'll build you a free custom preview"
//   step 2  "Just following up on my note. I have not built or published
//            anything for {{business_name}}."
//   step 3  "This is my last note. I have not built or published anything for
//            {{business_name}}, and there is no deadline or pressure."
//
// The text layer stays LINK-FREE on purpose (test: "every sequence step is
// link-free"). The preview URL is carried by the HTML part, which is the part
// the proof gate proved exists.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE SUBJECT CONSTANT IS DECLARED HERE, ONCE (D4, 2026-07-31).
//
// It used to be declared in BOTH template layers. lib/outreach-email-v2.js
// dropped its copy in the proof-first rewrite — that layer composes subjects
// with pchSubject() over SUBJECT_POOL now, so a fixed string there had no
// consumer left. This file was still exporting the same value under a second,
// retired consent-first name, kept "because several callers still import it".
// No caller did: the only importer was test/outreach-email-v2.test.js, which
// renamed it on the way in. That shape is exactly how the two layers drift —
// one name gets edited, the other is read — and a test importing the dropped
// name from the layer that dropped it reads `undefined` and passes vacuously.
//
// So: one declaration, one export, one name, and the retired alias is deleted
// rather than left dangling.
//
// WHY THE PLAIN-TEXT LAYER OWNS IT. This is the only layer that consumes a
// fixed, merge-token subject: SEQUENCES below, read through render(), which
// api/proof/owner-email-smoke.js ships as the owner smoke subject. The HTML
// layer owns the live cold-outreach subject instead — lib/email.js overwrites
// output.subject with pchSubject() for every sequence-1 send — and it needs no
// constant to do that. Handing this string to the HTML layer would only force
// this file to require the HTML composer to read one line of copy.
//
// Locked by "the subject constant has exactly one canonical export and no
// second layer redeclares it" in test/outreach-email-v2.test.js, which also
// bans the retired identifier from both layers' source — so a future alias
// cannot be reintroduced quietly, in a comment or otherwise.
// ---------------------------------------------------------------------------
const PROOF_FIRST_SUBJECT =
  "{{business_name}} — I rebuilt your site, take a look";

const CONSENT_FIRST_BODY = [
  "Hi {{owner_or_team}},",
  "",
  "I'm {{sender_name}} — I run a small AI-powered web studio in California, and I build modern sites for local {{industry}} businesses for about a tenth of what a traditional agency charges. AI does the heavy lifting, so I can keep it that low without cutting corners.",
  "",
  "I came across {{business_name}} while researching {{industry}} in {{city}}, and I went ahead and rebuilt the site as a free live preview so you could see it instead of imagining it. The preview link is in this email. Your current website is untouched, and it stays that way.",
  "",
  'Here\'s the part people don\'t expect: your site comes with Riley, your own AI web person you can call anytime. You say "reword that headline," "swap that photo" — and it\'s done while you\'re on the phone, in real time. No ticket system, no emailing changes in, no waiting weeks on a freelancer for one small edit.',
  "",
  "What's included:",
  "- Riley (AI assistant) by call — unlimited edits, done live",
  "- WSS Connect — all your social accounts in one built-in feed",
  '- Voice search & AI upgrades, "near me" optimization, Google/Apple Maps registry + directory indexing, plus {{city}} competitor & search research',
  "- Lead-funnel widgets so visitors turn into calls",
  "- Hosting, SSL, custom domain setup, and unlimited edits — all included",
  "",
  "No charge and no obligation for the preview. If you want anything changed, reply and tell me. If you'd rather I take it down, say so and it's gone.",
  "",
  "[[IF:sender_phone]]Prefer to talk it through? Call me: {{sender_phone}}.[[/IF]]",
  "",
  "— {{sender_name}}, Mission Viejo, CA",
].join("\n");

// ---------------------------------------------------------------------------
// THE FOLLOW-UPS (steps 2 and 3), REWRITTEN 2026-08-10 — OWNER-APPROVED COPY.
//
// The old bodies broke three of the owner's own standing rules at once, and had
// done since the proof-first migration edited the CLAIM in them without
// revisiting the VOICE:
//
//   1. FIRST PERSON, AND A FOUNDER. "the preview I built for X", signed
//      "— {{sender_name}}, Mission Viejo, CA". The owner's directive on cold
//      outreach is that there is no founder anywhere in it: the sender is WSS
//      Labs. A named individual in a cold email invites a reply to a person who
//      is not the one who will answer, and it is the wrong shape for a company
//      that answers the phone as Riley.
//   2. "JUST FOLLOWING UP" — the opening line of the old step 2, and the first
//      entry on the banned-cliche list in the copywriting brief. It is filler
//      that announces the email has no new information in it.
//   3. NO NEW INFORMATION. Both notes restated step 1's guarantees and asked
//      nothing. The rewritten copy leads with the only fact that matters and
//      gives exactly one action.
//
// WHAT THE NEW COPY IS ALLOWED TO SAY, and what enforces it:
//
//   · "is ready to review" / "kept the preview available" — a PRESENT-TENSE
//     claim about a host, which nothing used to verify. lib/email.js now probes
//     the preview on this path and refuses the send on a non-200
//     (`preview_not_live`, lib/preview-liveness.js). The sentence is only ever
//     mailed when it is true.
//   · "Final email about the ... site" — TRUE, and structural rather than
//     promised: SEQUENCES["1"].steps has exactly three keys, and both schedulers
//     (api/cron/drip-scheduler.js and api/admin/run-campaign.js) iterate
//     [2, 3] and then return `sequence_complete`. There is no step 4 to write,
//     and render() throws `unknown_sequence_step` on one.
//   · No invented deadline, no scarcity, no "before it comes down on Friday".
//     The preview stays up; the reader is told they can end it, not that time
//     will.
//
// STILL LINK-FREE (test: "every sequence step is link-free"). These are the
// plain-text half; lib/outreach-email-v2.js renders the preview button in the
// HTML half of the same message, from the same URL the probe above just proved
// is serving.
// ---------------------------------------------------------------------------

const PROOF_FOLLOWUP_SUBJECT = "Did you see the site we built?";

const PROOF_FOLLOWUP_BODY = [
  "The website WSS Labs built for {{business_name}} is ready to review. The work is already done in the preview, so you can judge the site itself before paying anything.",
  "",
  "Reply PASS and we will take it down.",
  "",
  "WSS Labs",
].join("\n");

const PROOF_FINAL_NOTE_SUBJECT = "Final email about the {{business_name}} site";

const PROOF_FINAL_NOTE_BODY = [
  "WSS Labs built a website for {{business_name}} and kept the preview available for review. This is our final email about it.",
  "",
  "Reply PASS and we will take it down.",
  "",
  "WSS Labs",
].join("\n");

const WARM_REPLY_BODY = [
  "Hi {{owner_or_team}},",
  "",
  "Thanks for replying. Before I build anything, tell me what you want the site to feel like, which services matter most, and anything you definitely want kept or changed.",
  "",
  "I will use your input for the free custom preview and will never touch your current site.",
  "",
  "— {{sender_name}}, Mission Viejo, CA",
].join("\n");

const SEQUENCES = {
  1: {
    name: "cold_consent_first",
    steps: {
      1: { subject: PROOF_FIRST_SUBJECT, body: CONSENT_FIRST_BODY },
      // Steps 2 and 3 carry their OWN subjects now (2026-08-10). They used to
      // reuse step 1's, which lib/email.js then overwrote with a pchSubject()
      // rotation variant — so a follow-up shipped under a first-impression
      // pitch subject ("<Business> — I rebuilt your site, take a look") sent to
      // somebody who had already received exactly that. The override is scoped
      // to step 1 in lib/email.js; these two strings are what actually ships.
      2: { subject: PROOF_FOLLOWUP_SUBJECT, body: PROOF_FOLLOWUP_BODY },
      3: { subject: PROOF_FINAL_NOTE_SUBJECT, body: PROOF_FINAL_NOTE_BODY },
    },
  },
  2: {
    name: "warm_consent_followup",
    steps: {
      1: { subject: "Re: {{business_name}} — your input first", body: WARM_REPLY_BODY },
      2: { subject: "Re: {{business_name}} — Riley and live edits", body: WARM_REPLY_BODY },
      3: { subject: "Re: {{business_name}} — whenever you're ready", body: WARM_REPLY_BODY },
    },
  },
  3: {
    name: "consented_build_intake",
    steps: {
      1: { subject: "A few questions for {{business_name}}", body: WARM_REPLY_BODY },
      2: { subject: "Your input for {{business_name}}", body: WARM_REPLY_BODY },
      3: { subject: "No rush — {{business_name}}", body: WARM_REPLY_BODY },
    },
  },
};

/**
 * A line wrapped in [[IF:var]] … [[/IF]] is OPTIONAL: when `var` is empty the
 * whole line is REMOVED — together with the blank line above it — instead of
 * rendering with a hole in it or failing the send as a missing required var.
 *
 * This exists because the agency phone is configuration-only now
 * (lib/riley-line.js): a literal fallback number kept being mailed after the
 * line was retired. With nothing configured, the offer to call must DISAPPEAR.
 * "Call or text me: ." is a defect, and so is blocking a whole campaign on it.
 */
function applyOptionalBlocks(text, vars = {}) {
  return String(text).replace(/\n*\[\[IF:(\w+)\]\]([\s\S]*?)\[\[\/IF\]\]/g, (match, key, inner) => {
    const value = vars[key];
    const present = !(value === undefined || value === null || String(value).trim() === "");
    if (!present) return "";
    return match.slice(0, match.indexOf("[[IF:")) + inner;
  });
}

function render(sequence, step, vars = {}) {
  const sequenceDef = SEQUENCES[String(sequence)];
  const template = sequenceDef?.steps?.[String(step)];
  if (!template) {
    throw new Error(`unknown_sequence_step:${sequence}.${step}`);
  }

  // owner_or_team is the greeting token the templates open with ("Hi
  // {{owner_or_team}},"). The live send resolves it (lib/owner-greeting: a
  // verified owner's first name, else "<business> team"); every other caller —
  // and every test — passes only business_name, so derive it here from the same
  // helper when it is absent. Without this the token renders as an unresolved
  // __MISSING_owner_or_team__ and the send fails its own missing-vars gate.
  const filled = { ...vars };
  if (filled.owner_or_team === undefined || filled.owner_or_team === null || filled.owner_or_team === "") {
    filled.owner_or_team = emailGreetingName(filled, filled.business_name || "");
  }

  const fill = (value) =>
    value.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      filled[key] === undefined || filled[key] === null || filled[key] === ""
        ? `__MISSING_${key}__`
        : String(filled[key]),
    );

  const subject = fill(applyOptionalBlocks(template.subject, filled));
  const body = fill(applyOptionalBlocks(template.body, filled));
  const missing = [...(subject + body).matchAll(/__MISSING_(\w+)__/g)].map((match) => match[1]);

  return {
    name: sequenceDef.name,
    subject,
    body,
    missing: [...new Set(missing)],
  };
}

module.exports = {
  CONSENT_FIRST_BODY,
  PROOF_FIRST_SUBJECT,
  // Exported so the follow-up copy can be asserted against the SHIPPED constants
  // rather than against a second copy of the same words pasted into a test —
  // which is how the old bodies kept their banned phrases through three edits.
  PROOF_FOLLOWUP_SUBJECT,
  PROOF_FOLLOWUP_BODY,
  PROOF_FINAL_NOTE_SUBJECT,
  PROOF_FINAL_NOTE_BODY,
  SEQUENCES,
  applyOptionalBlocks,
  render,
};
