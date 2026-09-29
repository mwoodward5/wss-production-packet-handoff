import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";

import { seedFrom } from "../lib/hero-seed.mjs";
import {
  TYPOGRAPHY_OPTIONS,
  planSnowflake,
} from "../lib/snowflake-picker.mjs";
import { CROSSWALK, toPremierInputs } from "../lib/snowflake-to-premier.mjs";
import {
  appendPlan,
  createMemoryStore,
  extractPlans,
  loadHistory,
} from "../lib/vertical-history.mjs";
import { checkHeroGeometry } from "../../qc-audit/qc.mjs";
import {
  build,
  fontStylesheetUrlFor,
  resolveBusinessPalette,
} from "./05-build-v8.mjs";

const LIGHT_PALETTE = {
  mode: "light",
  background: "#F7F5EE",
  surface: "#FFFFFF",
  ink: "#18201E",
  muted: "#62605B",
  accent: "#B4552D",
  accentAlt: "#41604F",
};

function packet(slug = "renderer-hardening", buildType = "single-page") {
  return {
    slug,
    build_type: buildType,
    forge: { demo: true },
    business: {
      name: "Renderer Truth Roofing",
      category: "roofing",
      city: "Fresno",
      state: "CA",
      address: "1640 North First Street, Fresno, CA 93703",
    },
    services: ["Roof repair", "Roof replacement", "Roof inspection"],
    brand: { colors: ["#005A9C", "#8A2BE2"] },
    enrichment_sources: {
      address: {
        source: "google-places",
        confidence: 0.98,
        value: "1640 North First Street, Fresno, CA 93703",
      },
      latlng: {
        source: "google-places",
        confidence: 0.98,
        value: { lat: 36.7612, lng: -119.7714 },
      },
    },
  };
}

async function render(input, options = {}) {
  const { geometryAudit = false, ...buildOptions } = options;
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-renderer-hardening-"));
  try {
    await build(input, { outDir, capture: false, ...buildOptions });
    const geometry = geometryAudit
      ? await checkHeroGeometry(outDir, {
        launchBrowser: () => chromium.launch({ headless: true }),
      })
      : null;
    return {
      html: readFileSync(path.join(outDir, "index.html"), "utf8"),
      packet: JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8")),
      geometry,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function declaredOrder(html) {
  return html.match(/data-section-sequence="([^"]*)"/)?.[1] || "";
}

function visibleSectionOrder(html) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  return [...main.matchAll(/<section\b[^>]*data-render-section="([^"]+)"/g)]
    .map((match) => match[1]);
}

function mainSectionClasses(html) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  return [...main.matchAll(/<section class="([^"]+)"/g)].map((match) => match[1]);
}

test("rendered packet carries the authority evidence required by the Ghost release gate", async () => {
  const rendered = await render(packet("authority-release-evidence"));
  const authority = rendered.packet.authority_standard;
  const fabricationKeys = new Set([
    "aeo-and-geo-41",
    "trust-and-e-e-a-t-65",
    "trust-and-e-e-a-t-69",
  ]);

  assert.equal(authority.standard, "authority-108-v1");
  assert.equal(authority.checks.length, 108);
  assert.deepEqual(
    authority.checks.filter((check) => fabricationKeys.has(check.key)).map((check) => check.key),
    [...fabricationKeys],
  );
});

test("final rendered manifest makes empty plans share the same truthful signature", async () => {
  const first = packet("same-render-truth");
  first.section_plan = [
    "team-portrait",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ];
  const second = structuredClone(first);
  second.section_plan = [
    "team-portrait",
    "trust-ledger",
    "material-swatch-lab",
    "faq-speakable",
    "contact-strip-map",
  ];

  const [a, b] = await Promise.all([render(first), render(second)]);
  const aResolved = a.packet.visual_system.resolved;
  const bResolved = b.packet.visual_system.resolved;
  assert.deepEqual(mainSectionClasses(a.html), mainSectionClasses(b.html));
  assert.deepEqual(aResolved.section_order, bResolved.section_order);
  assert.equal(aResolved.design_signature.id, bResolved.design_signature.id);
  assert.equal(declaredOrder(a.html), aResolved.section_order.join("|"));
  assert.deepEqual(visibleSectionOrder(a.html), aResolved.section_order);
  assert.doesNotMatch(declaredOrder(a.html), /materials|proof/);
  assert.match(a.html, new RegExp(`data-design-signature="${aResolved.design_signature.id}"`));
  for (const [name, value] of Object.entries(aResolved.palette)) {
    if (name === "supporting_tint") continue;
    const cssName = name === "background" ? "bg" : name === "surface" ? "panel" : name;
    assert.match(a.html, new RegExp(`--${cssName}:${value}`));
  }
});

test("disabled, empty, and multi-page home transforms update packet and DOM order", async () => {
  const disabled = packet("disabled-render-truth");
  disabled.section_plan = [
    "service-map",
    "material-swatch-lab",
    "team-portrait",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ];
  disabled.sections_disabled = ["service-map", "material-swatch-lab"];
  const disabledResult = await render(disabled);
  const disabledOrder = disabledResult.packet.visual_system.resolved.section_order;
  assert.equal(declaredOrder(disabledResult.html), disabledOrder.join("|"));
  assert.ok(!disabledOrder.includes("map"));
  assert.ok(!disabledOrder.includes("materials"));
  assert.ok(!disabledOrder.includes("proof"));
  assert.doesNotMatch(disabledResult.html, /data-google-map="satellite"/);

  const multi = packet("multi-render-truth", "multi-page");
  multi.section_plan = [
    "service-map",
    "material-swatch-lab",
    "team-portrait",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ];
  const multiResult = await render(multi);
  const multiOrder = multiResult.packet.visual_system.resolved.section_order;
  assert.equal(declaredOrder(multiResult.html), multiOrder.join("|"));
  assert.deepEqual(visibleSectionOrder(multiResult.html), multiOrder);
  const multiMain = multiResult.html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || "";
  assert.doesNotMatch(multiMain, /The longer story, page by page|cta-strip/);
  assert.ok(!multiOrder.includes("materials"));
  assert.ok(!multiOrder.includes("proof"));
  assert.ok(!multiOrder.includes("faq"));
  assert.ok(!multiOrder.includes("cta"));
});

test("blank and zero coordinates cannot create placeholder maps or GeoCoordinates", async () => {
  for (const value of [{ lat: "", lng: "" }, { lat: 0, lng: 0 }]) {
    const invalid = packet(`invalid-geo-${String(value.lat || "blank")}`);
    invalid.business.city = "";
    invalid.business.state = "";
    invalid.business.address = "";
    delete invalid.enrichment_sources.address;
    invalid.enrichment_sources.latlng.value = value;
    invalid.section_plan = [
      "service-map",
      "team-portrait",
      "trust-ledger",
      "faq-speakable",
      "contact-strip-map",
    ];
    const result = await render(invalid);
    assert.doesNotMatch(result.html, /data-google-map="satellite"/);
    assert.doesNotMatch(result.html, /"@type":"GeoCoordinates"/);
    assert.ok(!result.packet.visual_system.resolved.section_order.includes("map"));
  }
});

test("invalid coordinates cannot survive schema generation beside a valid address", async () => {
  const invalid = packet("invalid-geo-with-address");
  invalid.enrichment_sources.latlng.value = { lat: 0, lng: 0 };
  const result = await render(invalid);
  assert.doesNotMatch(result.html, /"@type":"GeoCoordinates"/);
  assert.doesNotMatch(result.html, /data-lat="0"(?:\s|>)/);
  assert.doesNotMatch(result.html, /data-lng="0"(?:\s|>)/);
});

test("verified coordinates control provider destinations while address remains display text", async () => {
  const conflicting = packet("coordinate-authority");
  conflicting.business.address = "999 Wrong Road, Oakland, CA 94601";
  conflicting.enrichment_sources.address.value = "999 Wrong Road, Oakland, CA 94601";
  conflicting.enrichment_sources.latlng.value = { lat: 36.7612, lng: -119.7714 };
  conflicting.section_plan = [
    "service-map",
    "team-portrait",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ];

  const result = await render(conflicting);
  const providerUrls = [...result.html.matchAll(/(?:src|href)="(https:\/\/(?:www\.google\.com\/maps|maps\.apple\.com\/)[^"]+)"/g)]
    .map((match) => new URL(match[1].replaceAll("&amp;", "&")));
  const embed = providerUrls.find((url) => url.hostname === "www.google.com" && url.pathname === "/maps");
  const google = providerUrls.find((url) => url.pathname.startsWith("/maps/dir/"));
  const apple = providerUrls.find((url) => url.hostname === "maps.apple.com");

  assert.equal(embed?.searchParams.get("q"), "36.7612,-119.7714");
  assert.equal(google?.searchParams.get("destination"), "36.7612,-119.7714");
  assert.equal(apple?.searchParams.get("daddr"), "36.7612,-119.7714");
  assert.match(result.html, /999 Wrong Road, Oakland, CA 94601/);
  assert.ok(providerUrls.every((url) => !url.href.includes("999%20Wrong%20Road")));
});

test("canonical discovery wins and supporting tint creates more than eight palettes", async () => {
  const discovery = ["#005A9C", "#8A2BE2"];
  const branded = resolveBusinessPalette({
    packet: {
      source: {
        brandColors: [
          "#111111", "#222222", "#333333", "#444444",
          "#555555", "#666666", "#777777", "#888888",
        ],
      },
    },
    discoveredBrand: { colors: discovery },
    compositionPalette: LIGHT_PALETTE,
    seedInt: 17,
  });
  assert.deepEqual(branded.brandColors.slice(0, 2), discovery);
  assert.ok(discovery.includes(branded.accent) || discovery.includes(branded.accent2));

  const signatures = new Set();
  for (let index = 0; index < 96; index += 1) {
    const seed = seedFrom(`same-brand-roofing-${index}`, "roofing").seed;
    signatures.add(resolveBusinessPalette({
      packet: { brand: { colors: discovery } },
      compositionPalette: LIGHT_PALETTE,
      seedInt: seed,
    }).signature);
  }
  assert.ok(signatures.size > 8, `expected >8 same-brand palettes, got ${signatures.size}`);

  const pale = packet("pale-brand-tokens");
  pale.brand.colors = ["#FFFFFF", "#F8F8F8"];
  const paleResult = await render(pale);
  assert.match(paleResult.html, /--brand-raw-1:#FFFFFF/);
  assert.match(paleResult.html, /--brand-raw-2:#F8F8F8/);
  assert.match(paleResult.html, /var\(--brand-raw-1\)/);
  assert.match(paleResult.html, /var\(--brand-raw-2\)/);
});

test("Google font URLs request supported weights for fixed-weight display faces", () => {
  const dmSerif = fontStylesheetUrlFor("DM Serif Display", "DM Sans");
  const archivoBlack = fontStylesheetUrlFor("Archivo Black", "IBM Plex Sans");
  assert.match(dmSerif, /family=DM\+Serif\+Display:wght@400(?:&|$)/);
  assert.doesNotMatch(dmSerif, /DM\+Serif\+Display:wght@500/);
  assert.match(archivoBlack, /family=Archivo\+Black:wght@400(?:&|$)/);
  assert.doesNotMatch(archivoBlack, /Archivo\+Black:wght@500/);
  assert.equal(
    CROSSWALK.typography_pair["Space Grotesk + JetBrains Mono"].body,
    "JetBrains Mono",
  );
});

test("fixed-weight display faces disable synthetic bold in rendered CSS", async () => {
  const planning = planSnowflake({
    input: { slug: "fixed-display-weight", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const premierInputs = toPremierInputs(planning.plan);
  premierInputs.typography = {
    display: "DM Serif Display",
    body: "DM Sans",
    utility: null,
  };
  const result = await render(packet("fixed-display-weight"), { premierInputs });
  assert.match(result.html, /--display-weight:400/);
  assert.match(result.html, /font-synthesis:none/);
});

test("durable vertical history rejects recent typography without order drift", () => {
  assert.ok(TYPOGRAPHY_OPTIONS.length >= 16);
  for (const option of TYPOGRAPHY_OPTIONS) assert.ok(CROSSWALK.typography_pair[option]);

  const store = createMemoryStore();
  const vertical = "roofing";
  const input = { slug: "durable-roofing", vertical };
  const first = planSnowflake({ input, recentPlansSameVertical: [] });
  appendPlan(vertical, first.plan, { store });
  const firstHistory = extractPlans(loadHistory(vertical, { store }));
  const second = planSnowflake({ input, recentPlansSameVertical: firstHistory });
  assert.notEqual(second.plan.typography_pair, first.plan.typography_pair);
  appendPlan(vertical, second.plan, { store });

  const history = extractPlans(loadHistory(vertical, { store }));
  const nextInput = { slug: "durable-roofing-next", vertical };
  const forward = planSnowflake({ input: nextInput, recentPlansSameVertical: history });
  const reversed = planSnowflake({
    input: nextInput,
    recentPlansSameVertical: [...history].reverse(),
  });
  assert.deepEqual(forward.plan, reversed.plan);
  assert.ok(!history.some((recent) => recent.typography_pair === forward.plan.typography_pair));
  const premier = toPremierInputs(forward.plan);
  assert.equal(premier.typography.display, CROSSWALK.typography_pair[forward.plan.typography_pair].display);
});

test("renderer honors the typography selected by the durable snowflake plan", async () => {
  const planning = planSnowflake({
    input: { slug: "snowflake-renderer-type", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const premierInputs = toPremierInputs(planning.plan);
  const input = packet("snowflake-renderer-type");
  input.section_plan = null;
  const result = await render(input, { premierInputs });
  const resolved = result.packet.visual_system.resolved;
  assert.equal(resolved.font_pair, `${premierInputs.typography.display} / ${premierInputs.typography.body}`);
  assert.match(result.html, new RegExp(`--display:'${premierInputs.typography.display}'`));
  assert.match(result.html, new RegExp(`--body:'${premierInputs.typography.body}'`));
});

test("Premier composition controls auto hero anatomy and exposes the conversion rail contract", async () => {
  const planning = planSnowflake({
    input: { slug: "premier-hero-anatomy", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const premierInputs = toPremierInputs(planning.plan);
  premierInputs.archetype = { ...CROSSWALK.archetype["materials-lab"] };
  const input = packet("premier-hero-anatomy");
  input.hero_family = "cinematic-video-parallax";
  const result = await render(input, { premierInputs });

  assert.match(result.html, /data-hero-anatomy="macro-material-bench"/);
  assert.match(result.html, /data-rendered-layout="material-workbench"/);
  assert.match(result.html, /<header class="top shell" data-sticky-cta data-conversion-rail>/);
  assert.doesNotMatch(result.html, /class="sticky-cta"/);
  assert.match(result.html, /\[class\*="architecture-offer-and-proof"\]\{padding-top:min\(35vh,300px\)\}/);
  assert.match(result.html, /\[class\*="architecture-offer-and-proof"\] \.hero-media-layer\{inset:0 0 auto 0;height:min\(32vh,270px\)/);
});

test("material-ledger with long generic copy keeps desktop actions above fold and mobile hero geometry contained", async () => {
  const planning = planSnowflake({
    input: { slug: "material-ledger-long-copy-geometry", vertical: "painting" },
    recentPlansSameVertical: [],
  });
  const premierInputs = toPremierInputs(planning.plan);
  premierInputs.archetype = { ...CROSSWALK.archetype["materials-lab"] };

  const input = packet("material-ledger-long-copy-geometry");
  input.business = {
    ...input.business,
    name: "Example Architectural Painting and Historic Surface Restoration Company",
    category: "painting",
    city: "Fresno",
    state: "CA",
  };
  input.services = [
    "Historic exterior paint stabilization and complete weatherproof refinishing",
    "Architectural interior painting with meticulous occupied-home protection",
    "Cabinet refinishing, color consultation, and fine-finish spray application",
    "Commercial maintenance painting for multi-building property portfolios",
  ];
  input.voice_persona = {
    first_person_snippets: [
      "We protect occupied homes carefully, document every surface condition, and build a durable finish schedule around coastal weather, historic materials, and the way your property is actually used.",
    ],
  };

  const result = await render(input, { premierInputs, geometryAudit: true });
  const document = new JSDOM(result.html).window.document;
  const hero = document.querySelector(".hero");
  const desktopAction = document.querySelector("header.top nav.main [data-conversion-action]");
  assert.equal(hero?.getAttribute("data-copy-density"), "long");
  assert.equal(hero?.getAttribute("data-hero-anatomy"), "macro-material-bench");
  assert.equal(hero?.querySelector(".hero-layout")?.getAttribute("data-rendered-layout"), "material-workbench");
  assert.ok(desktopAction, "desktop conversion rail must expose a real action");
  assert.ok(hero?.querySelector(".hero-actions .btn"));
  assert.ok(hero?.querySelector(".hero-layout-bench .project-starter"));
  assert.equal(result.geometry?.name, "visual-hero-geometry");
  assert.equal(result.geometry?.pass, true, result.geometry?.detail);
  assert.match(result.geometry?.detail || "", /desktop grid=.*mobile grid=.*mobile-320 grid=/);
  assert.match(result.html, /@media\(min-width:861px\) and \(max-height:950px\)/);
  assert.match(result.html, /\.hero\[data-copy-density="long"\] h1\{font-size:clamp\(2\.5rem,4\.05vw,3\.9rem\)/);
  assert.match(result.html, /width:min\(1160px,calc\(100% - 24px\)\);max-width:100%/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route(/^https?:\/\//, (route) => route.abort());
    await page.setContent(result.html, { waitUntil: "domcontentloaded" });

    const desktop = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const action = document.querySelector("header.top nav.main [data-conversion-action]");
      const actionStyle = action ? getComputedStyle(action) : null;
      return {
        viewportHeight: innerHeight,
        headline: rect(".hero h1"),
        intro: rect(".hero .intro"),
        actions: rect(".hero-actions"),
        starter: rect(".hero-layout-bench .project-starter"),
        desktopAction: action?.getBoundingClientRect().toJSON(),
        desktopActionDisplay: actionStyle?.display,
        desktopActionVisibility: actionStyle?.visibility,
      };
    });

    assert.ok(desktop.desktopAction && desktop.desktopAction.width > 0 && desktop.desktopAction.height > 0);
    assert.notEqual(desktop.desktopActionDisplay, "none");
    assert.notEqual(desktop.desktopActionVisibility, "hidden");
    assert.ok(desktop.desktopAction.bottom <= desktop.viewportHeight);
    assert.ok(desktop.headline.height <= desktop.viewportHeight * 0.42, `headline used ${desktop.headline.height}px`);
    assert.ok(desktop.intro.top < desktop.viewportHeight, `intro starts at ${desktop.intro.top}px`);
    assert.ok(desktop.actions.top < desktop.viewportHeight, `hero actions start at ${desktop.actions.top}px`);
    assert.ok(desktop.starter.top < desktop.viewportHeight, `project starter starts at ${desktop.starter.top}px`);

    await page.setViewportSize({ width: 768, height: 900 });
    const tabletHeader = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        documentWidth: document.documentElement.scrollWidth,
        brand: rect("header.top .brand"),
        quick: rect("header.top .mobile-quick-cta"),
        menu: rect("header.top .mobile-nav"),
        desktopNavDisplay: getComputedStyle(document.querySelector("header.top nav.main")).display,
      };
    });
    assert.equal(tabletHeader.desktopNavDisplay, "none");
    assert.ok(tabletHeader.brand.width > 0);
    assert.ok(tabletHeader.brand.right <= tabletHeader.quick.left + 1);
    assert.ok(tabletHeader.quick.right <= tabletHeader.menu.left + 1);
    assert.ok(tabletHeader.documentWidth <= 768, `tablet document width ${tabletHeader.documentWidth}px`);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const layout = document.querySelector(".hero-layout")?.getBoundingClientRect().toJSON();
      const escaped = [...document.querySelectorAll(".hero-layout, .hero-layout > *, .project-starter, .starter-choice")]
        .map((element) => ({ selector: element.className, rect: element.getBoundingClientRect().toJSON() }))
        .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1);
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        layout,
        escaped,
      };
    });

    assert.ok(mobile.layout.left >= -1 && mobile.layout.right <= mobile.viewportWidth + 1);
    assert.ok(mobile.documentWidth <= mobile.viewportWidth, `document width ${mobile.documentWidth}px`);
    assert.deepEqual(mobile.escaped, []);
  } finally {
    await browser.close();
  }
});

test("assurance ledger compacts medium-length display headlines before they bury desktop conversion controls", async () => {
  const planning = planSnowflake({
    input: { slug: "assurance-ledger-compact-2", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const premierInputs = toPremierInputs({
    ...planning.plan,
    archetype: "dark-editorial",
    typography_pair: "Cormorant Garamond + Inter",
  });
  const input = packet("assurance-ledger-compact-2");
  input.business = {
    ...input.business,
    name: "Example Weatherproofing Company",
    city: "Fairview",
  };
  input.services = [];

  const result = await render(input, { premierInputs, geometryAudit: true });
  const document = new JSDOM(result.html).window.document;
  const hero = document.querySelector(".hero");

  assert.equal(hero?.getAttribute("data-hero-anatomy"), "assurance-balance");
  assert.equal(hero?.querySelector(".hero-layout")?.getAttribute("data-rendered-layout"), "assurance-balance-sheet");
  assert.equal(hero?.querySelector("h1")?.textContent.trim(), "Built for the weather Fairview actually gets.");
  assert.equal(hero?.getAttribute("data-copy-density"), "long");
  assert.ok(hero?.querySelector(".hero-actions .btn"));
  assert.ok(hero?.querySelector(".project-starter"));
  assert.equal(result.geometry?.name, "visual-hero-geometry");
  assert.equal(result.geometry?.pass, true, result.geometry?.detail);
});

test("single-page navigation and conversion actions only target rendered sections", async () => {
  const input = packet("rendered-conversion-targets");
  input.section_plan = ["trust-strip", "services", "process", "faq"];
  input.sections_disabled = ["cta", "proof", "map"];

  const result = await render(input);
  const document = new JSDOM(result.html).window.document;
  const links = [
    ...document.querySelectorAll("header.top a[href^='#'], footer a[href^='#'], .hero-actions a[href^='#']"),
  ];
  assert.ok(links.length > 0);
  for (const link of links) {
    const href = link.getAttribute("href");
    if (href === "#") continue;
    assert.ok(document.querySelector(href), `${link.textContent.trim()} targets missing ${href}`);
  }
  assert.equal(document.querySelector("#quote"), null);
  assert.equal(document.querySelector("#reviews"), null);
  assert.equal(document.querySelector("#area"), null);
  assert.ok(document.querySelector("header.top [data-conversion-action][href='#services']"));
  assert.ok(document.querySelector(".hero-actions .btn.solid[href='#services']"));
  assert.equal(document.querySelector("header.top [data-conversion-action]")?.textContent, "View services");
  assert.equal(document.querySelector(".hero-actions .btn.solid")?.textContent, "Explore services");
});

test("multi-page header switches cleanly at the tablet-desktop boundary", async () => {
  const input = packet("tablet-header-boundary", "multi-page");
  input.business.name = "Example Architectural Painting and Historic Surface Restoration Company";
  const result = await render(input);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    await page.route(/^https?:\/\//, (route) => route.abort());
    await page.setContent(result.html, { waitUntil: "domcontentloaded" });
    for (const width of [1024, 1025]) {
      await page.setViewportSize({ width, height: 900 });
      const state = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          chip: rect("header.top .brand-chip"),
          nav: rect("header.top nav.main"),
          quick: rect("header.top .mobile-quick-cta"),
          menu: rect("header.top .mobile-nav"),
          navDisplay: getComputedStyle(document.querySelector("header.top nav.main")).display,
        };
      });
      assert.ok(state.documentWidth <= width, `${width}px document width ${state.documentWidth}px`);
      if (width === 1024) {
        assert.equal(state.navDisplay, "none");
        assert.ok(state.quick.right <= state.menu.left + 1);
      } else {
        assert.equal(state.navDisplay, "flex");
        assert.ok(state.chip.right <= state.nav.left + 1, `${width}px chip/nav overlap`);
      }
    }
  } finally {
    await browser.close();
  }
});

test("all thirteen snowflake archetypes render structurally distinct hero anatomy", async () => {
  const planning = planSnowflake({
    input: { slug: "all-rendered-anatomies", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const expected = {
    "cinematic-console": ["input-decision-output", "command-decision-board"],
    "atlas-authority": ["atlas-coordinate", "terrain-panorama"],
    "materials-lab": ["macro-material-bench", "material-workbench"],
    "editorial-portfolio": ["opening-argument", "casebook-docket"],
    "owner-letter": ["front-page-story", "founder-front-page"],
    "cinemagraph-immersive": ["many-to-one", "story-assembly-stack"],
    "luxury-cinematic": ["live-product-state", "live-product-console"],
    "cream-paper": ["care-portrait-field", "care-portrait-ledger"],
    "dark-editorial": ["assurance-balance", "assurance-balance-sheet"],
    "blueprint-schematic": ["elevation-cut", "diagonal-survey"],
    "split-cinematic": ["guided-first-step", "guided-first-step-path"],
    "magazine-owner": ["host-letter", "host-letter-column"],
    "bento-configurator": ["calibrated-readout", "calibrated-service-readout"],
  };
  const mediaTreatments = [
    ["ken-burns-restrained", "cinematic-light-shader", ".premier-treatment-cinematic-light-shader .cinematic-light{animation-duration:"],
    ["duotone-brand", "duotone-brand", ".premier-treatment-duotone-brand :is(img,video){filter:grayscale"],
    ["cinemagraph-single-motion", "cinemagraph", "@keyframes premierCinemagraph"],
    ["video-loop-cinematic", "video-loop", ".premier-treatment-video-loop :is(img,video){filter:saturate(.88)"],
    ["blueprint-overlay", "blueprint-svg", ".premier-treatment-blueprint-svg .media-veil{background-image:linear-gradient"],
    ["grain-analog", "grain-only", ".premier-treatment-grain-only .media-veil{opacity:.22"],
    ["halftone-editorial", "halftone", ".premier-treatment-halftone .media-veil{opacity:.3"],
    ["split-tone", "split-tone", ".premier-treatment-split-tone .media-veil{background:linear-gradient"],
  ];
  const renderedLayouts = [];
  const structuralTrees = [];

  for (const [index, archetype] of Object.keys(expected).entries()) {
    const plan = {
      ...planning.plan,
      archetype,
      media_treatment: mediaTreatments[index % mediaTreatments.length][0],
    };
    const result = await render(packet(`rendered-anatomy-${index}`), {
      premierInputs: toPremierInputs(plan),
    });
    const document = new JSDOM(result.html).window.document;
    const hero = document.querySelector(".hero");
    const layout = hero?.querySelector(":scope > .hero-layout");
    assert.ok(layout, `${archetype} must render a hero layout`);
    assert.equal(hero.getAttribute("data-hero-anatomy"), expected[archetype][0]);
    assert.equal(layout.getAttribute("data-rendered-layout"), expected[archetype][1]);
    renderedLayouts.push(layout.getAttribute("data-rendered-layout"));
    const tagTree = (node) => `${node.tagName.toLowerCase()}(${[...node.children].map(tagTree).join(",")})`;
    structuralTrees.push(tagTree(layout));

    const [, renderedTreatment, cssNeedle] = mediaTreatments[index % mediaTreatments.length];
    assert.match(result.html, new RegExp(`premier-treatment-${renderedTreatment}`));
    assert.ok(result.html.includes(cssNeedle), `${archetype} must visibly implement ${renderedTreatment}`);
  }

  assert.equal(new Set(renderedLayouts).size, 13);
  assert.equal(new Set(structuralTrees).size, 13, "hero uniqueness must come from rendered DOM structure, not markers alone");

  const unsupported = toPremierInputs(planning.plan);
  unsupported.archetype = { ...unsupported.archetype, composition_base: "unsupported-layout" };
  await assert.rejects(
    render(packet("unsupported-rendered-anatomy"), { premierInputs: unsupported }),
    /Unknown composition base|unsupported Premier composition base/,
  );
});

test("signature binds to rendered font families without optional slot provenance", async () => {
  const planning = planSnowflake({
    input: { slug: "unbound-type-signature", vertical: "roofing" },
    recentPlansSameVertical: [],
  });
  const soraInputs = toPremierInputs(planning.plan);
  delete soraInputs._slotSourcePlan;
  soraInputs.typography = { display: "Sora", body: "Nunito Sans", utility: null };
  const archivoInputs = structuredClone(soraInputs);
  archivoInputs.typography = {
    display: "Archivo Black",
    body: "IBM Plex Sans",
    utility: null,
  };

  const input = packet("unbound-type-signature");
  input.section_plan = null;
  const [sora, archivo] = await Promise.all([
    render(structuredClone(input), { premierInputs: soraInputs }),
    render(structuredClone(input), { premierInputs: archivoInputs }),
  ]);
  const soraResolved = sora.packet.visual_system.resolved;
  const archivoResolved = archivo.packet.visual_system.resolved;

  assert.equal(soraResolved.font_pair_id, "sora-nunito-sans");
  assert.equal(archivoResolved.font_pair_id, "archivo-black-ibm-plex-sans");
  assert.notEqual(soraResolved.font_pair_id, archivoResolved.font_pair_id);
  assert.notEqual(soraResolved.design_signature.id, archivoResolved.design_signature.id);
  assert.match(sora.html, /--display:'Sora'/);
  assert.match(archivo.html, /--display:'Archivo Black'/);
});

test("minimum media cohort allocates unique hero, service, and proof identities", async () => {
  const input = packet("hero-gallery-identity");
  input.media = {
    catalog: Array.from({ length: 9 }, (_, index) => ({
      kind: "photo",
      url: `media/owned-project-${String(index + 1).padStart(2, "0")}.jpg`,
      source: "business-site",
      label: `Owned project ${index + 1}`,
      service_tags: index === 1
        ? ["roof repair"]
        : index === 2
          ? ["roof replacement"]
          : [],
      meta: index === 3
        ? { media_classification: { confidence: 0.91, service_tags: ["roof inspection"] } }
        : {},
      width: 1800,
      height: 1200,
      hero_eligible: true,
      proof_eligible: true,
    })),
  };
  input.section_plan = [
    "gallery",
    "services",
    "team-portrait",
    "process-timeline",
    "faq-speakable",
    "contact-strip-map",
  ];

  const result = await render(input);
  const hero = result.html.match(/<div class="hero-media-layer"[\s\S]*?<img\b[^>]*\bsrc="([^"]+)"/)?.[1];
  const servicesHtml = result.html.match(/<section\b[^>]*class="band services"[\s\S]*?<\/section>/)?.[0] || "";
  const services = [...servicesHtml.matchAll(/<img\b[^>]*class="svc-photo"[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  const galleryHtml = result.html.match(/<section\b[^>]*class="band gallery"[\s\S]*?<\/section>/)?.[0] || "";
  const gallery = [...galleryHtml.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  const proof = [hero, ...gallery].filter(Boolean);
  const identities = [...proof, ...services].map((source) => source.replace(/[?#].*$/, "").toLowerCase());

  assert.ok(hero, "expected a rendered hero photo");
  assert.ok(proof.length >= 6, `expected at least six rendered first-party proof photos, got ${proof.length}`);
  assert.ok(services.length >= 2, `expected at least two separately allocated service photos, got ${services.length}`);
  assert.ok(!gallery.includes(hero), "hero photo must not be allocated to the work gallery");
  assert.equal(new Set(identities).size, identities.length, "hero, service, and work media identities must be unique");
  assert.match(servicesHtml, /data-service-match-score="10[2-9]"/);
  assert.match(servicesHtml, /data-service-match-basis="explicit-tag"/);
  assert.match(servicesHtml, /data-service-match-basis="vision-all-terms"/);
  assert.match(servicesHtml, /data-service-match-confidence="0\.910"/);
  assert.match(servicesHtml, /data-service-match-evidence="roof (?:repair|replacement|inspection)"/);
  assert.match(galleryHtml, /<p class="kicker">Source gallery<\/p>/);
  assert.match(galleryHtml, /Photos carried from the provided source catalog\./);
  assert.doesNotMatch(result.html, /business-supplied project photos|Photos supplied by the business|Project media from/);
});

test("six verified photos render a source gallery when the planner omits it", async () => {
  const input = packet("planner-media-depth", "multi-page");
  input.media = {
    catalog: Array.from({ length: 6 }, (_, index) => ({
      kind: "photo",
      url: `media/owned-source-${String(index + 1).padStart(2, "0")}.jpg`,
      source: "business-site",
      label: `Owned source ${index + 1}`,
      width: 1800,
      height: 1200,
      hero_eligible: true,
      proof_eligible: true,
    })),
  };
  input.section_plan = [
    "homeowner-configurator",
    "team-portrait",
    "material-swatch-lab",
    "trust-ledger",
    "contact-strip-map",
  ];

  const result = await render(input);
  const hero = result.html.match(/<div class="hero-media-layer"[\s\S]*?<img\b[^>]*\bsrc="([^"]+)"/)?.[1];
  const galleryHtml = result.html.match(/<section\b[^>]*class="band gallery"[\s\S]*?<\/section>/)?.[0] || "";
  const gallery = [...galleryHtml.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  const rendered = [hero, ...gallery].filter(Boolean).map((source) => source.replace(/[?#].*$/, "").toLowerCase());

  assert.equal(rendered.length, 6);
  assert.equal(new Set(rendered).size, 6);
  assert.ok(result.packet.visual_system.resolved.section_order.includes("gallery"));
  assert.match(galleryHtml, /data-gallery-count="5"/);
});

test("media-depth cadence does not invent a sixth photo or override a disabled gallery", async () => {
  const input = packet("planner-media-depth-boundary");
  input.media = {
    catalog: Array.from({ length: 6 }, (_, index) => ({
      kind: "photo",
      url: `media/owned-boundary-${String(index + 1).padStart(2, "0")}.jpg`,
      source: "business-site",
      width: 1800,
      height: 1200,
      hero_eligible: true,
      proof_eligible: true,
    })),
  };
  input.section_plan = [
    "homeowner-configurator",
    "team-portrait",
    "trust-ledger",
    "contact-strip-map",
  ];
  const fivePhotos = structuredClone(input);
  fivePhotos.media.catalog.pop();
  const galleryDisabled = structuredClone(input);
  galleryDisabled.sections_disabled = ["gallery"];

  const [five, disabled] = await Promise.all([render(fivePhotos), render(galleryDisabled)]);
  assert.equal(five.packet.visual_system.resolved.section_order.includes("gallery"), false);
  assert.doesNotMatch(five.html, /data-gallery-count=/);
  assert.equal(disabled.packet.visual_system.resolved.section_order.includes("gallery"), false);
  assert.doesNotMatch(disabled.html, /data-gallery-count=/);
});

test("generic project filenames cannot masquerade as service media", async () => {
  const input = packet("generic-project-media");
  input.media = {
    catalog: Array.from({ length: 8 }, (_, index) => ({
      kind: "photo",
      url: `media/roof-project-${index + 1}.jpg`,
      source: "business-site",
      label: `Roof project ${index + 1}`,
      width: 1800,
      height: 1200,
      hero_eligible: true,
      proof_eligible: true,
    })),
  };
  input.section_plan = ["gallery", "services", "faq-speakable", "contact-strip-map"];

  const result = await render(input);
  const servicesHtml = result.html.match(/<section\b[^>]*class="band services"[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal((servicesHtml.match(/class="svc-photo"/g) || []).length, 0);
  assert.equal((servicesHtml.match(/data-service-media="text-only"/g) || []).length, 3);
  assert.doesNotMatch(servicesHtml, /data-service-match-score|data-service-match-basis|data-service-match-evidence/);
});

test("business names with terminal punctuation do not create doubled service-copy punctuation", async () => {
  const input = packet("terminal-business-punctuation");
  input.business.name = "Landscape Connection, Inc.";
  const result = await render(input);
  assert.doesNotMatch(result.html, /Landscape Connection, Inc\.\./);
  assert.match(result.html, /Define the scope, site conditions, materials, and finish for roof repair\./);
  assert.match(result.html, /Review the roof system, material choice, flashing, and tear-off scope together\./);
  assert.doesNotMatch(result.html, /\b(?:how|for|discuss|to)\s+Roof (?:repair|replacement|inspection)\b/);
  assert.doesNotMatch(result.html, /\bthis week\b|books within days/i);
});

test("trade-specific service prose cannot leak across unrelated businesses", async () => {
  const input = packet("cross-trade-service-prose");
  input.business.category = "electrical";
  input.services = ["Equipment repair", "Tree removal", "Post-construction cleaning"];
  const result = await render(input);

  assert.doesNotMatch(result.html, /failed component|rigging, drop zones|rooms, surfaces, priorities/i);
  assert.match(result.html, /Define the scope, site conditions, materials, and finish for equipment repair\./);
  assert.match(result.html, /Turn the property priorities into a clear plan for tree removal\./);
  assert.match(result.html, /Review access, constraints, preparation, and handoff for post-construction cleaning\./);
});

test("sourced display hours derive matching opening-hours schema when an explicit spec is absent", async () => {
  const input = packet("derived-hours-schema");
  input.enrichment_sources.hours = {
    source: "business-profile",
    confidence: 0.9,
    hours_spec: [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Funday",
      opens: "breakfast",
      closes: "later",
    }],
    value: [
      { day: "Monday", hours: "7:00\u202FAM\u2009–\u20094:00\u202FPM" },
      { day: "Tuesday", hours: "07:00-16:00" },
      { day: "Wednesday", hours: "Open 24 hours" },
      { day: "Saturday", hours: "Closed" },
    ],
  };

  const result = await render(input);
  assert.match(result.html, /data-hours="sourced"/);
  assert.match(result.html, /"openingHoursSpecification":\[/);
  assert.match(result.html, /"dayOfWeek":"Monday","opens":"07:00","closes":"16:00"/);
  assert.match(result.html, /"dayOfWeek":"Tuesday","opens":"07:00","closes":"16:00"/);
  assert.match(result.html, /"dayOfWeek":"Wednesday","opens":"00:00","closes":"23:59"/);
  assert.doesNotMatch(result.html, /Funday|breakfast|later/);
  assert.doesNotMatch(result.html, /"dayOfWeek":"Saturday"/);
});
