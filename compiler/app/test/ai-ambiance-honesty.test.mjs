import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { onEmit } from "../../factory/lib/emit.mjs";
import { selectPremierMedia } from "../../factory/lib/premier-media.mjs";
import { build } from "../../factory/pipeline/05-build-v8.mjs";
import { checkMediaDepth } from "../../qc-audit/qc.mjs";
import { runV7Checks } from "../../qc-audit/qc-v7-ext.mjs";

function packetWith(media) {
  return {
    slug: "ai-ambiance-honesty",
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Honest Landscape",
      category: "landscaping",
      city: "Austin",
      state: "TX",
    },
    services: ["Landscape design", "Garden maintenance"],
    media: { catalog: media },
    enrichment_sources: {},
  };
}

test("AI ambiance video is visibly labeled, excluded from proof, and sanitized in assets.json", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-ai-ambiance-"));
  const events = [];
  const privateVideoUrl = "https://internal-provider.example/jobs/private-render.mp4";
  const privateLocalPath = "C:\\private\\provider\\private-render.mp4";
  const packet = packetWith([
    {
      kind: "video",
      url: privateVideoUrl,
      local_path: privateLocalPath,
      provider: "internal-video-provider",
      source: "ai-ambiance",
      role: "ambiance",
      generated: true,
      proof_eligible: false,
    },
    {
      kind: "photo",
      url: "https://honest-landscape.example/projects/patio.jpg",
      source: "business-site",
      label: "Completed patio",
    },
  ]);

  try {
    onEmit((event) => events.push(event));
    const selection = selectPremierMedia(packet);
    assert.equal(selection.mode, "ai-ambiance-video");
    assert.equal(selection.hero.source, "ai-ambiance");
    assert.equal(selection.hero.role, "ambiance");
    assert.equal(selection.hero.proof_eligible, false);
    assert.equal(selection.gallery.some((item) => item.source === "ai-ambiance"), false);

    await build(packet, { outDir, capture: false });

    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const document = new JSDOM(html).window.document;
    const mediaPlane = document.querySelector("[data-media-plane]");
    const aiMedia = document.querySelector('[data-ai-media][data-ai-label][data-media-source="ai-ambiance"]');
    assert.equal(mediaPlane?.getAttribute("data-media-source"), "ai-ambiance");
    assert.ok(aiMedia, "AI ambiance markers must be present on the rendered media");
    assert.equal(aiMedia.getAttribute("data-proof-eligible"), "false");
    assert.equal(aiMedia.getAttribute("data-media-role"), "ambiance");
    assert.match(aiMedia.querySelector(".media-disclosure")?.textContent || "", /AI-generated ambiance/i);
    assert.match(aiMedia.querySelector(".media-disclosure")?.textContent || "", /not job proof/i);
    assert.equal(aiMedia.closest("section.gallery, section.proof, [data-gallery], [data-proof]"), null);

    const assetsText = readFileSync(path.join(outDir, "assets.json"), "utf8");
    const assets = JSON.parse(assetsText);
    const scorecard = JSON.parse(readFileSync(path.join(outDir, "scorecard.json"), "utf8"));
    const aiAsset = assets.items.find((item) => item.source === "ai");
    assert.deepEqual(aiAsset, {
      kind: "video",
      source: "ai",
      role: "ambiance",
      label: "AI-generated ambiance — not job proof",
      proof_eligible: false,
    });
    assert.doesNotMatch(assetsText, /internal-video-provider|internal-provider\.example|private-render|C:\\\\private/i);
    assert.equal(scorecard.media.hero_source, "ai-ambiance");
    assert.equal(scorecard.media.has_source_video, false);
    assert.equal(scorecard.media.has_ai_ambiance_video, true);
    const mediaDepth = checkMediaDepth(outDir);
    assert.equal(mediaDepth.pass, false, mediaDepth.detail);
    assert.equal(mediaDepth.labeled_ai_count, 1);
    assert.equal(
      events.find((event) => event.stage === "build" && event.phase === "render-hero")?.payload.media,
      "ai-ambiance",
    );

    const aiGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(aiGate?.pass, true, aiGate?.detail);
  } finally {
    onEmit(null);
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("business-site video keeps source-video behavior and receives no AI markers", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-source-video-"));
  const events = [];
  const packet = packetWith([{
    kind: "video",
    url: "https://honest-landscape.example/projects/walkthrough.mp4",
    source: "business-site",
    role: "project-video",
    proof_eligible: true,
  }]);

  try {
    onEmit((event) => events.push(event));
    const selection = selectPremierMedia(packet);
    assert.equal(selection.mode, "source-video");
    await build(packet, { outDir, capture: false });

    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const assets = JSON.parse(readFileSync(path.join(outDir, "assets.json"), "utf8"));
    const scorecard = JSON.parse(readFileSync(path.join(outDir, "scorecard.json"), "utf8"));
    assert.match(html, /<section\s+class="hero/);
    assert.match(html, /data-media-source="video"/);
    assert.doesNotMatch(html, /data-ai-media|data-ai-label|data-media-source="ai-ambiance"/);
    assert.equal(assets.items.some((item) => item.source === "ai"), false);
    assert.equal(assets.items.some((item) => item.kind === "video" && item.source === "site"), true);
    assert.equal(scorecard.media.hero_source, "video");
    assert.equal(events.find((event) => event.phase === "render-hero")?.payload.media, "video");
  } finally {
    onEmit(null);
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("AI gallery gate recognizes declared gallery roles without matching unrelated substrings", () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-ai-gallery-scope-"));
  const aiMedia = '<div data-ai-media data-media-source="ai-ambiance"></div>';
  try {
    writeFileSync(path.join(outDir, "packet.json"), "{}");
    writeFileSync(path.join(outDir, "assets.json"), JSON.stringify({
      items: [{ kind: "video", source: "ai", role: "ambiance", proof_eligible: false }],
    }));
    writeFileSync(path.join(outDir, "index.html"), `<div class="media-plane" data-media-plane data-media-source="ai-ambiance"></div><section class="proofing-overview">${aiMedia}</section>`);
    const unrelatedSubstringGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(unrelatedSubstringGate?.pass, true, unrelatedSubstringGate?.detail);

    writeFileSync(path.join(outDir, "index.html"), `<div class="media-plane" data-media-plane data-media-source="ai-ambiance"></div><section class="project-gallery">${aiMedia}</section>`);
    const exactClassGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(exactClassGate?.pass, false, exactClassGate?.detail);

    writeFileSync(path.join(outDir, "index.html"), `<div class="media-plane" data-media-plane data-media-source="ai-ambiance"></div><section class="premier-gallery" data-gallery-source="business">${aiMedia}</section>`);
    const premierGalleryGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(premierGalleryGate?.pass, false, premierGalleryGate?.detail);

    writeFileSync(path.join(outDir, "index.html"), `<div class="media-plane" data-media-plane data-media-source="ai-ambiance"></div><div data-proof-eligible="false">${aiMedia}</div>`);
    const eligibilityGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(eligibilityGate?.pass, true, eligibilityGate?.detail);

    writeFileSync(path.join(outDir, "index.html"), `<div class="media-plane" data-media-plane data-media-source="ai-ambiance"></div><div data-proof="customer-work">${aiMedia}</div>`);
    const dataGate = runV7Checks(outDir).find((check) => check.name === "ai-imagery-labeled");
    assert.equal(dataGate?.pass, false, dataGate?.detail);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("verified source photos that are unsafe full-bleed render as an inset hero without AI", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-source-sheet-"));
  const packet = packetWith([1, 2, 3].map((index) => ({
    kind: "photo",
    url: `https://honest-landscape.example/projects/project-${index}.jpg`,
    source: "business-site",
    label: `Completed project ${index}`,
    width: 900,
    height: 601,
  })));
  try {
    const selection = selectPremierMedia(packet);
    assert.equal(selection.hero, null);
    assert.equal(selection.gallery.length, 3);

    await build(packet, { outDir, capture: false });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const assets = JSON.parse(readFileSync(path.join(outDir, "assets.json"), "utf8"));
    assert.match(html, /premier-media--source-photo-contact-sheet/);
    assert.match(html, /data-media-source="photo"/);
    assert.match(html, /data-media-treatment="source-photo-contact-sheet"/);
    assert.match(html, /data-media-kind="source-photo-contact-sheet"/);
    assert.doesNotMatch(html, /data-media-source="unavailable"|data-ai-media/);
    assert.equal(assets.items.some((item) => item.source === "ai"), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("inset hero preserves one, two, and three unsafe photos with correct 390px rows", async () => {
  const browser = await chromium.launch({ headless: true });
  const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  try {
    for (const count of [1, 2, 3]) {
      const outDir = mkdtempSync(path.join(tmpdir(), `siteforge-source-sheet-${count}-`));
      try {
        const packet = packetWith(Array.from({ length: count }, (_, index) => ({
          kind: "photo",
          url: `https://honest-landscape.example/projects/unsafe-${index + 1}.jpg`,
          source: "business-site",
          label: `Completed project ${index + 1}`,
          width: 900,
          height: 601,
        })));
        packet.slug = "first-rate-contact-sheet-check";
        await build(packet, { outDir, capture: false });
        const html = readFileSync(path.join(outDir, "index.html"), "utf8");
        const document = new JSDOM(html).window.document;
        const sheet = document.querySelector(".premier-media--source-photo-contact-sheet");
        assert.ok(sheet, `${count} photo(s) must retain the source contact sheet`);
        assert.equal(Number(sheet.getAttribute("data-source-photo-count")), count);
        assert.equal(sheet.querySelectorAll(".premier-source-sheet__item").length, count);

        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
          await page.setContent(
            html.replace(/https:\/\/honest-landscape\.example\/projects\/unsafe-\d+\.jpg/g, transparentPixel),
            { waitUntil: "domcontentloaded" },
          );
          const layout = await page.locator(".premier-media--source-photo-contact-sheet").evaluate((node) => {
            const sheetRect = node.getBoundingClientRect();
            const items = [...node.querySelectorAll(".premier-source-sheet__item")].map((item) => {
              const rect = item.getBoundingClientRect();
              const style = getComputedStyle(item);
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                rowStart: style.gridRowStart,
                rowEnd: style.gridRowEnd,
                columnStart: style.gridColumnStart,
                columnEnd: style.gridColumnEnd,
              };
            });
            return { sheet: { left: sheetRect.left, right: sheetRect.right, width: sheetRect.width }, items };
          });
          assert.ok(layout.items.every((item) => item.width > 0));
          assert.equal(layout.items[0].columnStart, "1");
          assert.equal(layout.items[0].columnEnd, "-1");
          if (count === 1) {
            assert.equal(layout.items[0].rowStart, "1");
            assert.equal(layout.items[0].rowEnd, "-1");
          } else {
            assert.equal(layout.items[0].rowStart, "1");
            assert.ok(layout.items[1].top > layout.items[0].top);
          }
          if (count === 2) {
            assert.equal(layout.items[1].rowStart, "2");
            assert.equal(layout.items[1].columnStart, "1");
            assert.equal(layout.items[1].columnEnd, "-1");
            assert.ok(Math.abs(layout.items[1].width - layout.items[0].width) < 2);
          }
          if (count === 3) {
            assert.ok(Math.abs(layout.items[1].top - layout.items[2].top) < 2);
            assert.ok(layout.items[1].right <= layout.items[2].left + 2);
          }
        } finally {
          await page.close();
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
});
