"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const emailPath = require.resolve("../lib/email");
const emailSource = fs.readFileSync(emailPath, "utf8");
const { buildActivationEmail } = require("../lib/email");

const FORBIDDEN_ACTIVATION_OUTPUT = /8B5CF6|B65CFF|FF7B9C|Woodward Software Labs|wsl-logo-horizontal(?:\.png)?/i;

test("Mark-approved activation email design lock remains intact", () => {
  assert.match(emailSource, /DESIGN LOCK \(Mark-approved 2026-07-19\)/);
  assert.match(emailSource, /layout are FINAL\. Steel\/graphite\/amber/);
  assert.match(emailSource, /Do NOT restyle, "improve", or revert this template/);
  assert.doesNotMatch(emailSource, /wsl-logo-horizontal\.png/i);
});

test("activation output stays on the locked palette and renders a safe client logo", () => {
  const logoUrl = "https://assets.example.com/acme-logo.svg?version=2";
  const rendered = buildActivationEmail({
    businessName: "Acme Roofing",
    ownerEmail: "owner@example.com",
    pin: "123456",
    magicLink: "https://wss-ai.com/dashboard#t=contract",
    jobId: "job_design_lock_contract",
    businessLogoUrl: logoUrl,
  });

  assert.doesNotMatch(rendered.html, FORBIDDEN_ACTIVATION_OUTPUT);
  assert.doesNotMatch(rendered.text, /Woodward Software Labs/i);
  assert.match(rendered.html, /src="https:\/\/assets\.example\.com\/acme-logo\.svg\?version&#61;2"/);
  assert.match(rendered.html, /WSS <span[^>]*>LABS<\/span>/);
});

test("activation output refuses non-HTTPS client-logo values", () => {
  const rendered = buildActivationEmail({
    businessName: "Acme Roofing",
    businessLogoUrl: "javascript:alert(1)",
  });

  assert.doesNotMatch(rendered.html, /javascript:alert/);
});
