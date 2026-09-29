import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { landing } from "../views/page-home-prompt.mjs";
import { pricingPage, supportPage } from "../views/pages-public.mjs";
import { templatesPage } from "../views/pages-templates.mjs";
import { wizardPage } from "../views/pages-app.mjs";
import { seedLibrary } from "../lib/template-library.mjs";

const visibleText = (html) => new JSDOM(html).window.document.body.textContent
  .replace(/\s+/g, " ")
  .trim();

const customerPages = {
  home: visibleText(landing({ user: null })),
  pricing: visibleText(pricingPage({ user: null })),
  styles: visibleText(templatesPage({ user: null, library: seedLibrary(), filters: {} })),
  support: visibleText(supportPage({ user: null })),
  onboarding: visibleText(wizardPage({ user: { email: "owner@example.com" }, csrf: "test" })),
};

const blockedJargon = /\b(?:renderer|pipeline|provenance|source packet|hero anatomy|schema|firecrawl|vercel|dns|ssl|deployments?|forge runs?|qc)\b/i;
for (const [name, text] of Object.entries(customerPages)) {
  assert.doesNotMatch(text, blockedJargon, `${name} exposes developer language`);
}

assert.match(customerPages.home, /Tell us about your business/i);
assert.match(customerPages.home, /No account or credit card needed/i);
assert.match(customerPages.pricing, /See it free/i);
assert.match(customerPages.styles, /Find a look you love/i);
assert.match(customerPages.onboarding, /Tell us about your business/i);
assert.doesNotMatch(customerPages.styles, /active V7|raw HTML|Lovable project export/i);

console.log("Plain-language page tests: passed");
