import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeadPayload, processLeadNotification, scoreLead } from "../lib/lead-processor.mjs";

test("lead payload normalizes contact, attribution, and consent", () => {
  const lead = normalizeLeadPayload({
    id: "form-1",
    form_id: "quote",
    name: "  Ada Owner  ",
    email_or_phone: "ADA@EXAMPLE.COM",
    message: " Need a new site. ",
    utm_source: "report-email",
    consent_given: true,
  });
  assert.equal(lead.data.name, "Ada Owner");
  assert.equal(lead.data.email, "ada@example.com");
  assert.equal(lead.data.phone, "");
  assert.equal(lead.utm_source, "report-email");
  assert.equal(lead.consent_given, true);
});

test("enterprise scoring requires an exact configured email domain", () => {
  const env = { SITEFORGE_ENTERPRISE_DOMAINS: "acme.com,example.org" };
  const enterprise = scoreLead({ name: "Ada", email: "ada@acme.com", phone: "555-0100", message: "A detailed request for a multi-location website.", consent_given: true }, { env });
  const lookalike = scoreLead({ name: "Ada", email: "ada@notacme.com", phone: "555-0100", message: "A detailed request for a multi-location website.", consent_given: true }, { env });
  assert.equal(enterprise.enterprise, true);
  assert.equal(enterprise.segment, "enterprise");
  assert.equal(lookalike.enterprise, false);
});

test("notifications retry three times, then queue metadata without PII", async () => {
  let attempts = 0;
  const failures = [];
  const result = await processLeadNotification({
    id: "lead-public-id",
    name: "Ada Owner",
    email: "ada@example.com",
    message: "Please call about a website.",
  }, {
    ownerEmail: "owner@example.com",
    projectName: "Acme Plumbing",
    leadId: "lead-db-id",
    env: { RESEND_API_KEY: "test-key", SITEFORGE_LEAD_FROM: "Site Leads <leads@example.com>" },
    fetchImpl: async () => { attempts += 1; return { ok: false, status: 503 }; },
    sleepImpl: async () => {},
    onFailure: async (failure) => failures.push(failure),
  });
  assert.equal(attempts, 4, "initial request plus three retries");
  assert.equal(result.failed, true);
  assert.equal(failures.length, 1);
  assert.deepEqual(Object.keys(failures[0]).sort(), ["attempts", "channel", "error_code", "failed_at", "lead_id", "response_status"].sort());
  assert.doesNotMatch(JSON.stringify(failures), /Ada|ada@example|Please call/);
});

test("configured Resend and Slack channels succeed without retries", async () => {
  const requests = [];
  const result = await processLeadNotification({ name: "Sam", phone: "555-0101", message: "Roofing quote" }, {
    ownerEmail: "owner@example.com",
    projectName: "Acme Roofing",
    env: {
      RESEND_API_KEY: "test-key",
      SITEFORGE_LEAD_FROM: "Site Leads <leads@example.com>",
      SITEFORGE_LEAD_WEBHOOK_URL: "https://hooks.slack.com/services/test",
    },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200 }; },
    sleepImpl: async () => {},
  });
  assert.equal(requests.length, 2);
  assert.equal(result.failed, false);
  assert.equal(result.channels.resend.ok, true);
  assert.equal(result.channels.slack.ok, true);
});
