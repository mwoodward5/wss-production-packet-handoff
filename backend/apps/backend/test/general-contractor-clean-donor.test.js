"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACKEND = path.join(__dirname, "..");
const DONOR_NAME = "general-contractor-clean";
const DIR = path.join(BACKEND, "donors-clean", DONOR_NAME);
const TABLE = require("../data/donor-verticals.json");
const { applyDonorAlias } = require("../lib/donor-verticals");
const { loadDonor, preferredDonorFor, resolveDonor } = require("../lib/mirror-engine/donor");
const { identityScan } = require("../lib/mirror-engine/scan");
const { REQUIRED_TOKENS, tokensIn, unknownTokensIn } = require("../lib/mirror-engine/tokens");
const { checkVertical } = require("../lib/render-gate");

const read = (rel) => fs.readFileSync(path.join(DIR, rel), "utf8");
const manifest = () => JSON.parse(read("BOILERPLATE.json"));

test("general contractor routing never reuses the narrow trade donor", () => {
  assert.equal(TABLE.canonical["general contractor"], DONOR_NAME);
  for (const label of ["general contractor", "general contracting", "gc"]) {
    assert.equal(TABLE.aliases[label], DONOR_NAME, `${label} registry target`);
  }
  assert.equal(preferredDonorFor("general contractor"), DONOR_NAME);

  const exact = resolveDonor({ industry: "general contractor" });
  assert.equal(exact.ok, true, JSON.stringify(exact.detail));
  assert.equal(exact.name, DONOR_NAME);

  for (const label of ["general contracting", "gc"]) {
    const routed = applyDonorAlias({ facts: { industry: label } });
    assert.equal(routed.body.donor, DONOR_NAME, label);
    assert.equal(resolveDonor({ donor: routed.body.donor }).ok, true, label);
  }
});

test("the Roy Briley identity passes the actual general-contractor vertical gate", () => {
  const name = "Roy Briley General Contracting, Fire & Water Damage Restoration, Mold Mitigation in Anchorage Alaska";
  const rendered = [
    name,
    "General contractor in Anchorage, AK.",
    "Home Repair",
    "Emergency Repairs",
  ].join(" ");
  const verdict = checkVertical(
    {
      ok: true,
      title: `${name} | General contractor in Anchorage, AK`,
      innerText: rendered,
      donorText: rendered,
    },
    {
      business_name: name,
      vertical: "general contractor",
      services: ["Home Repair", "Emergency Repairs"],
    },
  );
  assert.equal(verdict.pass, true, JSON.stringify(verdict).slice(0, 500));
});

test("synthetic clean-room canaries keep identityScan armed without a real source identity", () => {
  const value = manifest();
  assert.equal(value.donor_business_name, "WSS Fieldline Cleanroom Sentinel");
  assert.equal(value.donor_domain, "fieldline-cleanroom.invalid");
  assert.deepEqual(value.account_ids, ["wss-fieldline-cleanroom-sentinel-20260825"]);
  assert.match(value.identity_atoms_note, /Synthetic scan canaries only/);

  const leaked = identityScan({
    "index.html": Buffer.from(`<html><body>${value.donor_business_name}</body></html>`),
  }, value);
  assert.equal(leaked.clean, false, "the clean-room identity gate must remain fail-capable");
  assert.ok(leaked.hits.some((hit) => hit.bucket === "name"));

  const installed = loadDonor(DIR).files;
  delete installed["BOILERPLATE.json"];
  const clean = identityScan(installed, value);
  assert.equal(clean.clean, true, JSON.stringify(clean.hits.slice(0, 5)));
});

test("manifest binds home services to one exact visible content target", () => {
  const value = manifest();
  const selector = '[data-wss-content-channel="services"]';
  assert.equal(value.vertical, "general contractor");
  assert.equal(value.consumes_content, true);
  assert.deepEqual(value.renders, ["services"]);
  assert.deepEqual(value.content_render_targets, {
    services: [{ path: "/", selector }],
  });

  const html = read("index.html");
  assert.match(html, /data-wss-content-channel="services"/);
  assert.match(html, /data-wss-service-list/);
  assert.match(html, /data-wss-service-select/);
  assert.ok(html.indexOf('data-wss-content-channel="services"') < html.indexOf("data-wss-service-list"));
});

function fakeNode(tagName) {
  return {
    tagName: String(tagName || "div").toUpperCase(),
    children: [],
    attributes: {},
    hidden: true,
    className: "",
    textContent: "",
    value: "",
    appendChild(node) { this.children.push(node); return node; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
  };
}

function runContentBundle(services) {
  const section = fakeNode("section");
  const list = fakeNode("div");
  const select = fakeNode("select");
  select.hidden = false;
  const selectors = new Map([
    ['[data-wss-content-channel="services"]', section],
    ["[data-wss-service-list]", list],
    ["[data-wss-service-select]", select],
    ["video[data-hero-video]", null],
    ["[data-media-state]", null],
  ]);
  const context = {
    window: { __WSS_CONTENT__: { services } },
    document: {
      querySelector(selector) { return selectors.get(selector) || null; },
      getElementById() { return null; },
      createElement: fakeNode,
    },
  };
  vm.runInNewContext(read("assets/main.js"), context, { filename: "general-contractor-clean/main.js" });
  return { section, list, select };
}

test("service cards render only from window.__WSS_CONTENT__ and keep source markers", () => {
  const rendered = runContentBundle([
    { name: "Verified first service", description: "Verified first description." },
    { name: "Verified second service" },
  ]);
  assert.equal(rendered.section.hidden, false);
  assert.equal(rendered.section.attributes["data-wss-content-rendered"], "2");
  assert.equal(rendered.list.children.length, 2);
  assert.equal(rendered.list.children[0].attributes["data-wss-service-card"], "verified");
  assert.equal(rendered.list.children[0].attributes["data-wss-content-source"], "content-island");
  assert.equal(rendered.list.children[0].children[1].textContent, "Verified first service");
  assert.equal(rendered.list.children[0].children[2].textContent, "Verified first description.");
  assert.equal(rendered.list.children[1].children.length, 2, "no verified description means no generated card copy");
  assert.equal(rendered.select.children.length, 2);

  const empty = runContentBundle([]);
  assert.equal(empty.section.hidden, true, "no verified rows means no service section");
  assert.equal(empty.list.children.length, 0, "the donor must not invent default service cards");
  assert.equal(empty.select.children.length, 0);
});

test("the hero ladder accepts the factory clip, then steps down to owned abstract media", () => {
  const value = manifest();
  const html = read("index.html");
  const js = read("assets/main.js");
  const video = value.hero_video;

  assert.equal(video.expected_asset_kind, "video");
  assert.equal(video.client_video_path, "assets/hero-client-general-contractor.mp4");
  assert.equal(video.wss_fallback_clip_path, "assets/hero-fallback-general-contractor.mp4");
  assert.equal(video.generation_contract.model, "bytedance/seedance-2.0-mini");
  assert.equal(video.generation_contract.generate_audio, false);
  assert.equal(video.generation_contract.placement, "client_video_path");
  assert.ok(fs.existsSync(path.join(DIR, video.poster)), "the truthful still fallback ships");
  assert.ok(!fs.existsSync(path.join(DIR, video.client_video_path)), "client output is engine-placed, never donor-fabricated");

  const bytes = fs.readFileSync(path.join(DIR, video.wss_fallback_clip_path));
  assert.ok(bytes.length > 1000, "the WSS fallback is real video bytes");
  assert.equal(bytes.subarray(4, 8).toString("latin1"), "ftyp", "fallback must be an MP4, not a renamed file");
  assert.equal(bytes.includes(Buffer.from("soun")), false, "fallback video must not carry an audio track");
  assert.equal(bytes.includes(Buffer.from("vide")), true, "fallback MP4 must carry a video track");

  const island = html.match(/<script type="application\/json" id="hero-video-ladder">\s*([\s\S]*?)<\/script>/);
  assert.ok(island, "hero ladder data island missing");
  assert.deepEqual(JSON.parse(island[1]).sources, [video.client_video_path, video.wss_fallback_clip_path]);
  assert.match(html, /<video[\s\S]*data-hero-video[\s\S]*muted[\s\S]*autoplay[\s\S]*loop[\s\S]*playsinline/);
  assert.match(html, /Planning view · illustrative/);
  assert.match(js, /arm\(index \+ 1\)/, "a bad first rung must step down");
  assert.match(js, /data-hero-armed/);
});

test("donor files carry required identity tokens and no fixed adjacent-trade copy", () => {
  const textFiles = [
    "BOILERPLATE.json",
    "index.html",
    "site.webmanifest",
    "assets/main.js",
    "assets/styles.css",
    "assets/hero-planning-field.svg",
    "assets/fieldline-mark.svg",
  ];
  const allTokens = new Set();
  for (const rel of textFiles) {
    const source = read(rel);
    assert.deepEqual(unknownTokensIn(source), [], `${rel} has an unmapped engine token`);
    for (const token of tokensIn(source)) allTokens.add(token);
  }
  for (const token of REQUIRED_TOKENS) {
    assert.ok(allTokens.has(token), `required identity token ${token} is absent from the donor`);
  }
  assert.deepEqual(new Set(manifest().tokens_used), allTokens, "manifest token inventory drifted from shipped files");

  const shippedCopy = textFiles.map(read).join("\n");
  assert.doesNotMatch(shippedCopy, /\b(?:concrete|roof|roofing|restoration|mold mitigation|water damage)\b/i,
    "the broad donor must not carry a fixed adjacent-trade claim");
  assert.doesNotMatch(read("index.html"), /data-wss-service-card=/,
    "service cards belong to the verified runtime, not static markup");
  assert.match(read("assets/main.js"), /textContent = row\.name/,
    "verified service names must be inserted as text, never executable HTML");
});

test("the project form targets the existing quote-request contract", () => {
  const value = manifest();
  const html = read("index.html");
  assert.equal(value.lead_endpoint.url, "https://ghost.wss-ai.com/api/quote-request");
  assert.match(html, /href="#quote"/, "the phone-less CTA must target the accepted on-page quote section");
  assert.match(html, /<section class="brief-section" id="quote">/);
  assert.match(html, /<form[^>]+method="post"[^>]+action="https:\/\/ghost\.wss-ai\.com\/api\/quote-request"/);
  for (const field of ["name", "email", "phone", "service", "message", "website"]) {
    assert.match(html, new RegExp(`name="${field}"`), `${field} field missing`);
  }

  const loaded = loadDonor(DIR).files;
  for (const rel of ["index.html", "assets/main.js", "assets/styles.css", value.hero_video.poster, value.hero_video.wss_fallback_clip_path]) {
    assert.ok(loaded[rel], `${rel} does not ship through loadDonor`);
  }
});
