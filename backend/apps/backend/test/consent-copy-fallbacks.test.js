"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const { composeOrganicEmail } = require("../lib/organic-email");
const { localCompose } = require("../lib/supervised-held-drafts");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
}

function anthropicReply(text) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text }] }),
  });
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
}

afterEach(restoreEnvironment);

test("supervised local fallback is consent-first and carries the compliance footer", () => {
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_SENDER_PHONE = "(949) 339-5562";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";

  const composed = localCompose({
    dryRun: true,
    prospect: {
      business_name: "Cedar Plumbing",
      city: "Irvine",
      industry: "plumbing",
    },
  });

  assert.equal(
    composed.subject,
    "talk to your website and it changes — for Cedar Plumbing in Irvine",
  );
  assert.match(composed.body, /reply and I'll build you a free custom preview/i);
  assert.match(composed.body, /I never touch your current site/i);
  assert.match(composed.body, /Irvine competitor & search research/i);
  assert.match(composed.body, /Not interested\? Reply STOP and you won't hear from me again\./);
  assert.match(composed.body, /655 S Main St, Suite 200, Orange, CA 92868/);
  assert.doesNotMatch(
    composed.subject + composed.body,
    /https?:\/\/|stripe|checkout|countdown|expir(?:e|es|ed|ation)|live until|delete it|\{\{(?:PREVIEW_LINK|REPORT_LINK)\}\}/i,
  );
});

test("organic composer rejects an old pre-built-preview response", async () => {
  const subject = "talk to your website and it changes — for Cedar Plumbing in Irvine";
  anthropicReply(
    `SUBJECT: ${subject}\n\nHi Cedar Plumbing team,\n\nI already built your site and put the preview live. Open {{PREVIEW_LINK}}, then use the checkout to launch it before the countdown expires.\n\nReply if you want changes. I never touch your current site.\n\n— Mark Woodward`,
  );

  const composed = await composeOrganicEmail({
    prospect: {
      business_name: "Cedar Plumbing",
      city: "Irvine",
      industry: "plumbing",
    },
  });

  assert.deepEqual(composed, { fail: "consent_mechanics_forbidden" });
});

test("organic composer accepts only a reply-first future-build offer", async () => {
  const subject = "talk to your website and it changes — for Cedar Plumbing in Irvine";
  const body = [
    "Hi Cedar Plumbing team,",
    "I'm Mark Woodward, and I run a small AI-powered web studio in California for local plumbing businesses. I keep the cost low because AI handles much of the repetitive work, while I stay responsible for the finished result.",
    "Riley is your AI web person by call. You can ask to reword a headline, or swap a photo, and the edit happens while you're on the phone.",
    "If you'd like, reply and I'll build you a free custom preview with your input. There is no charge or obligation, and I never touch your current site.",
    "— Mark Woodward",
  ].join("\n\n");
  anthropicReply(`SUBJECT: ${subject}\n\n${body}`);

  const composed = await composeOrganicEmail({
    prospect: {
      business_name: "Cedar Plumbing",
      city: "Irvine",
      industry: "plumbing",
    },
  });

  assert.equal(composed.subject, subject);
  assert.equal(composed.body, body);
  assert.doesNotMatch(
    composed.subject + composed.body,
    /https?:\/\/|stripe|checkout|countdown|expir(?:e|es|ed|ation)|live until|delete it|\{\{(?:PREVIEW_LINK|REPORT_LINK)\}\}/i,
  );
});
