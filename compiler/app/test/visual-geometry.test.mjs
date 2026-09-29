import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkHeroGeometry,
  runQualityAudit,
  settleHeroForGeometry,
} from "../../qc-audit/qc.mjs";
import { runVisualFidelityChecks } from "../../qc-audit/qc-visual-fidelity.mjs";

function fixture(css, layoutClass = "hero-grid", heroClass = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "siteforge-geometry-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta name="viewport" content="width=device-width"><style>
    *{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:clip}
    .hero{position:relative;min-height:680px;padding:48px 0}.hero-grid{width:min(1160px,calc(100vw - 40px));margin:auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;position:relative;z-index:1}.hero-copy{min-width:0}.hero-media-layer{position:absolute;inset:0;min-height:420px;background:#345}.hero h1{font:64px/1.05 sans-serif;margin:0;max-width:12ch}
    @media(max-width:860px){.hero-grid{grid-template-columns:1fr}.hero h1{font-size:44px}}
    ${css}
  </style><section class="hero ${heroClass}" data-renderer="05-build-v8" data-hero-anatomy="test"><div class="hero-media-layer" data-hero-layer="media"></div><div class="${layoutClass}"><div class="hero-copy" data-hero-layer="copy"><h1>Built for the work you actually do.</h1><p class="intro">Clear local-service copy.</p><div class="hero-actions"><a href="#quote">Request a quote</a></div></div><div class="project-starter" data-hero-layer="lead-widget">Choose a service</div></div></section>`);
  return dir;
}

function photoFixture(src) {
  const dir = fixture("");
  const htmlPath = path.join(dir, "index.html");
  writeFileSync(
    htmlPath,
    readFileSync(htmlPath, "utf8").replace(
      '<div class="hero-media-layer" data-hero-layer="media"></div>',
      `<div class="hero-media-layer" data-hero-layer="media"><div data-media-kind="photo" style="width:100%;height:100%"><img src="${src}" alt="" style="display:block;width:100%;height:100%;object-fit:cover"></div></div>`,
    ),
  );
  return dir;
}

const valid = await checkHeroGeometry(fixture(""));
assert.equal(valid.pass, true, valid.detail);

const fontReadyNeverResolvesPage = {
  async evaluate(callback, timeoutMs) {
    const hadDocument = Object.hasOwn(globalThis, "document");
    const hadAnimationFrame = Object.hasOwn(globalThis, "requestAnimationFrame");
    const previousDocument = globalThis.document;
    const previousAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.document = {
      querySelector: () => null,
      fonts: { ready: new Promise(() => {}) },
    };
    globalThis.requestAnimationFrame = (handler) => setTimeout(handler, 0);
    try {
      return await callback(timeoutMs);
    } finally {
      if (hadDocument) globalThis.document = previousDocument;
      else delete globalThis.document;
      if (hadAnimationFrame) globalThis.requestAnimationFrame = previousAnimationFrame;
      else delete globalThis.requestAnimationFrame;
    }
  },
};
const fontWaitStarted = Date.now();
await settleHeroForGeometry(fontReadyNeverResolvesPage, 40);
assert.ok(Date.now() - fontWaitStarted < 1_000, "font readiness must stay inside the geometry settle budget");

const stickyHeaderRail = fixture(`
  header.top{position:sticky;top:0;z-index:20;height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:#fff}
  header.top a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px}
`);
writeFileSync(
  path.join(stickyHeaderRail, "index.html"),
  readFileSync(path.join(stickyHeaderRail, "index.html"), "utf8").replace(
    '<section class="hero ',
    '<header class="top" data-conversion-rail><strong>Premier Plumbing</strong><a href="#quote">Quote</a></header><section class="hero ',
  ),
);
const stickyHeaderResult = await checkHeroGeometry(stickyHeaderRail);
assert.equal(stickyHeaderResult.pass, true, stickyHeaderResult.detail);

const fixedRail = fixture(`
  .conversion-rail{position:fixed;left:10px;right:10px;bottom:10px;z-index:30;height:84px;display:flex;align-items:center}
  .conversion-rail a{display:inline-flex;align-items:center;min-height:44px}
`);
writeFileSync(
  path.join(fixedRail, "index.html"),
  `${readFileSync(path.join(fixedRail, "index.html"), "utf8")}<aside class="conversion-rail" data-conversion-rail><a href="#quote">Request a quote</a></aside>`,
);
const fixedRailResult = await checkHeroGeometry(fixedRail);
assert.equal(fixedRailResult.pass, false);
assert.match(fixedRailResult.detail, /fixed content overlay/i);

const missingFirstViewportConversion = fixture("");
writeFileSync(
  path.join(missingFirstViewportConversion, "index.html"),
  readFileSync(path.join(missingFirstViewportConversion, "index.html"), "utf8")
    .replace('<div class="hero-actions"><a href="#quote">Request a quote</a></div>', "")
    .replace('<div class="project-starter" data-hero-layer="lead-widget">Choose a service</div>', ""),
);
const missingFirstViewportConversionResult = await checkHeroGeometry(missingFirstViewportConversion);
assert.equal(missingFirstViewportConversionResult.pass, false);
assert.match(
  missingFirstViewportConversionResult.detail,
  /desktop: neither \.hero-actions nor \.project-starter is visible in the first viewport/i,
);

const desktopActionVisibleStarterBelow = fixture("@media(min-width:861px){.project-starter{transform:translateY(1000px)}}");
const desktopActionVisibleStarterBelowResult = await checkHeroGeometry(desktopActionVisibleStarterBelow);
assert.equal(desktopActionVisibleStarterBelowResult.pass, true, desktopActionVisibleStarterBelowResult.detail);

// Serverless Chromium must keep one page/context alive while strict geometry
// resizes through every required viewport. Reopening a page after closing the
// only context reproduced the production "Target page ... has been closed"
// failure and prevented 390/320 from ever running.
{
  let viewport = { width: 1440, height: 960 };
  const opened = [];
  const resized = [];
  let navigations = 0;
  let pageCloses = 0;
  let browserCloses = 0;
  const rect = (left, width, height = 400) => ({ left, right: left + width, top: 0, bottom: height, width, height });
  const page = {
    async goto() { navigations += 1; },
    async setViewportSize(next) { viewport = { ...next }; resized.push({ ...next }); },
    async evaluate(_callback, settleTimeout) {
      if (settleTimeout !== undefined) return undefined;
      const mobile = viewport.width < 861;
      const gridWidth = mobile ? viewport.width - 40 : 1160;
      const gridLeft = (viewport.width - gridWidth) / 2;
      const columnWidth = mobile ? gridWidth : 540;
      return {
        viewport: { ...viewport },
        mediaPosition: "absolute",
        mediaKind: "",
        sourceImage: null,
        hero: rect(0, viewport.width, 680),
        grid: rect(gridLeft, gridWidth, 600),
        copy: rect(gridLeft, columnWidth, 360),
        media: rect(0, mobile ? viewport.width : 640, 600),
        h1: rect(gridLeft, columnWidth, 160),
        overflow: 0,
        h1Overflow: { x: 0, y: 0 },
        ui: {
          header: null,
          rails: [],
          persistentHeight: 0,
          critical: [
            {
              selector: ".hero-actions",
              rect: {
                left: gridLeft,
                right: gridLeft + columnWidth,
                top: 400,
                bottom: 444,
                width: columnWidth,
                height: 44,
              },
            },
            {
              selector: ".project-starter",
              rect: {
                left: gridLeft,
                right: gridLeft + columnWidth,
                top: 500,
                bottom: 544,
                width: columnWidth,
                height: 44,
              },
            },
          ],
        },
      };
    },
    async close() { pageCloses += 1; },
  };
  const browser = {
    async newPage(options) { opened.push(options.viewport); viewport = { ...options.viewport }; return page; },
    async close() { browserCloses += 1; },
  };
  const lifecycle = await checkHeroGeometry(fixture(""), { launchBrowser: async () => browser });
  assert.equal(lifecycle.pass, true, lifecycle.detail);
  assert.deepEqual(opened, [{ width: 1440, height: 960 }]);
  assert.deepEqual(resized, [{ width: 390, height: 844 }, { width: 320, height: 800 }]);
  assert.equal(navigations, 1);
  assert.equal(pageCloses, 1);
  assert.equal(browserCloses, 1);
}

const imageServer = createServer((request, response) => {
  if (request.url === "/delayed.svg") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#345"/></svg>');
    }, 1_400);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});
await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
try {
  const { port } = imageServer.address();
  const delayedImage = await checkHeroGeometry(photoFixture(`http://127.0.0.1:${port}/delayed.svg`));
  assert.equal(delayedImage.pass, true, delayedImage.detail);

  const brokenImage = await checkHeroGeometry(photoFixture(`http://127.0.0.1:${port}/broken.svg`));
  assert.equal(brokenImage.pass, false);
  assert.match(brokenImage.detail, /hero source is too small \(0x0, Infinityx upscale\)/);
} finally {
  await new Promise((resolve, reject) => imageServer.close((error) => error ? reject(error) : resolve()));
}

const premierLayout = await checkHeroGeometry(fixture(".hero-layout{width:min(1160px,calc(100vw - 40px));margin:auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;position:relative;z-index:1}@media(max-width:860px){.hero-layout{grid-template-columns:1fr}}", "hero-layout"));
assert.equal(premierLayout.pass, true, premierLayout.detail);

const editorialSplit = await checkHeroGeometry(fixture(
  ".hero-founder-broadsheet .hero-media-layer{left:45%;border-left:1px solid #999}@media(max-width:860px){.hero .hero-media-layer{left:0;border-left:0}.hero-layout{grid-template-columns:1fr}}",
  "hero-layout",
  "hero-founder-broadsheet",
));
assert.equal(editorialSplit.pass, true, editorialSplit.detail);

const hostLetterMobile = await checkHeroGeometry(fixture(
  '[class*="architecture-host-letter"] .hero-media-layer{inset:5% 3% 7% 69%}@media(max-width:860px){.hero .hero-media-layer{left:0}[class*="architecture-host-letter"] .hero-media-layer{inset:0 0 68% 45%}[class*="architecture-host-letter"] .hero-media-layer{left:0}.hero-layout{grid-template-columns:1fr}}',
  "hero-layout",
  "architecture-host-letter-journal",
));
assert.equal(hostLetterMobile.pass, true, hostLetterMobile.detail);

const frontPageStoryMobile = await checkHeroGeometry(fixture(
  '[class*="architecture-front-page-story"] .hero-media-layer{inset:10% 3% 12% 65%}@media(max-width:860px){.hero .hero-media-layer{left:0}[class*="architecture-front-page-story"] .hero-media-layer{inset:0 0 68% 0}.hero-layout{grid-template-columns:1fr}}',
  "hero-layout",
  "architecture-front-page-story-editorial",
));
assert.equal(frontPageStoryMobile.pass, true, frontPageStoryMobile.detail);

const contactSheetDir = fixture(".hero-contact-sheet{width:calc(100vw - 24px);height:240px}@media(max-width:860px){.hero-media-layer{display:none}}", "hero-layout");
const contactSheetHtml = path.join(contactSheetDir, "index.html");
writeFileSync(
  contactSheetHtml,
  readFileSync(contactSheetHtml, "utf8").replace(
    '<div class="hero-copy" data-hero-layer="copy">',
    '<div class="hero-contact-sheet" data-hero-layer="contact-sheet"></div><div class="hero-copy" data-hero-layer="copy">',
  ),
);
const contactSheetLayout = await checkHeroGeometry(contactSheetDir);
assert.equal(contactSheetLayout.pass, true, contactSheetLayout.detail);

const broken = await checkHeroGeometry(fixture("@media(min-width:861px){.hero-grid{width:500px;margin-left:0;grid-template-columns:1fr}}"));
assert.equal(broken.pass, false);
assert.match(broken.detail, /hero grid is only 500px wide/);

const crushedViewport = await checkHeroGeometry(fixture("@media(min-width:861px){.hero h1{font-size:120px;max-width:5ch}.hero-copy{padding-top:420px}}"));
assert.equal(crushedViewport.pass, false);
assert.match(crushedViewport.detail, /headline consumes|supporting intro falls below|begins below the first viewport/);

const crushedMobileViewport = await checkHeroGeometry(fixture("@media(max-width:860px){.hero h1{font-size:96px;max-width:4ch}.hero-copy{padding-top:360px}}"));
assert.equal(crushedMobileViewport.pass, false);
assert.match(crushedMobileViewport.detail, /mobile(?:-320)?: (?:headline consumes|supporting intro falls below|.*begins below the first viewport)/);

const mobileActionAboveStarterBelowDir = fixture(
  "@media(max-width:860px){.project-starter{transform:translateY(900px)}}",
);
const mobileActionAboveStarterBelow = await checkHeroGeometry(mobileActionAboveStarterBelowDir);
assert.equal(mobileActionAboveStarterBelow.pass, true, mobileActionAboveStarterBelow.detail);

const authoritativeGeometryPass = await runQualityAudit(mobileActionAboveStarterBelowDir, null, {
  visualResults: [{ name: "visual-hero-geometry", pass: false, detail: "caller attempted override" }],
  v7Results: [],
});
const internallyPassingGeometry = authoritativeGeometryPass.results.filter(
  (result) => result.name === "visual-hero-geometry",
);
assert.equal(internallyPassingGeometry.length, 1);
assert.equal(internallyPassingGeometry[0].pass, true, internallyPassingGeometry[0].detail);

const bothMobileConversionsBelowDir = fixture(
  "@media(max-width:860px){.hero-actions,.project-starter{transform:translateY(900px)}}",
);
const bothMobileConversionsBelow = await checkHeroGeometry(bothMobileConversionsBelowDir);
assert.equal(bothMobileConversionsBelow.pass, false);
assert.match(
  bothMobileConversionsBelow.detail,
  /mobile(?:-320)?: neither \.hero-actions nor \.project-starter is visible in the first viewport/,
);

const duplicateGeometryAttempt = await runQualityAudit(bothMobileConversionsBelowDir, null, {
  visualResults: [{ name: "visual-hero-geometry", pass: true, detail: "caller attempted override" }],
  v7Results: [],
});
const authoritativeGeometry = duplicateGeometryAttempt.results.filter(
  (result) => result.name === "visual-hero-geometry",
);
assert.equal(authoritativeGeometry.length, 1);
assert.equal(authoritativeGeometry[0].pass, false, authoritativeGeometry[0].detail);
assert.equal(
  duplicateGeometryAttempt.failed.some((result) => result.name === "visual-hero-geometry"),
  true,
);

const leakedDir = fixture("");
const leakedHtml = path.join(leakedDir, "index.html");
writeFileSync(leakedHtml, `${readFileSync(leakedHtml, "utf8")}<div data-source="firecrawl">point_of_interest</div>`);
const scrub = runVisualFidelityChecks(leakedDir).find((item) => item.name === "visual-public-surface-scrub");
assert.equal(scrub.pass, false);
assert.match(scrub.detail, /firecrawl|point_of_interest/);

console.log("Visual hero geometry tests: passed");
