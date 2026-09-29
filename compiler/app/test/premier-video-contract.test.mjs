import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { prepareMediaCatalog } from "../../factory/lib/media-intelligence.mjs";
import {
  isBrowserPlayableVideo,
  renderPremierHeroMedia,
  selectPremierMedia,
  videoMimeType,
} from "../../factory/lib/premier-media.mjs";

const MIME_CASES = [
  ["mp4", "video/mp4"],
  ["m4v", "video/x-m4v"],
  ["mov", "video/quicktime"],
  ["ogg", "video/ogg"],
  ["ogv", "video/ogg"],
  ["webm", "video/webm"],
];
const AUTOPLAY_CASES = MIME_CASES.filter(([extension]) => extension !== "mov");

test("local_path-only videos survive catalog preparation", () => {
  const catalog = prepareMediaCatalog({
    business: { category: "landscaping" },
    media: { catalog: [{ local_path: "C:\\uploads\\yard-loop.ogv", source: "upload", mime: "video/ogg" }] },
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].kind, "video");
  assert.equal(catalog[0].url, "C:\\uploads\\yard-loop.ogv");
  assert.equal(catalog[0].local_path, "C:\\uploads\\yard-loop.ogv");
});

test("portable browser video formats render typed autoplay loops with a reduced-motion fallback", () => {
  for (const [extension, mime] of AUTOPLAY_CASES) {
    const selection = selectPremierMedia({ media: { catalog: [
      { kind: "video", url: `media/yard-loop.${extension}`, source: "owner-upload", label: "Finished yard video" },
      { kind: "photo", url: "media/yard-poster.webp", source: "owner-upload", label: "Finished yard" },
    ] } });
    const html = renderPremierHeroMedia(selection, { businessName: "Yard Co" });
    const document = new JSDOM(html).window.document;
    const video = document.querySelector("video");
    const source = video?.querySelector("source");
    const fallback = document.querySelector("[data-reduced-motion-fallback]");

    assert.ok(video, `${extension}: video missing`);
    for (const attribute of ["autoplay", "muted", "loop", "playsinline"]) {
      assert.equal(video.hasAttribute(attribute), true, `${extension}: ${attribute} missing`);
    }
    assert.equal(source?.getAttribute("type"), mime);
    assert.equal(video.getAttribute("poster"), "media/yard-poster.webp");
    assert.equal(fallback?.getAttribute("src"), "media/yard-poster.webp");
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*data-reduced-motion-fallback[\s\S]*display:block!important/);
    assert.equal(videoMimeType({ url: `media/yard-loop.${extension}` }), mime);
    assert.equal(isBrowserPlayableVideo({ url: `media/yard-loop.${extension}` }), true);
  }
});

test("QuickTime stays cataloged but falls back to a real photo instead of a broken autoplay hero", () => {
  const quickTime = { kind: "video", url: "media/yard-loop.mov", source: "owner-upload", label: "Finished yard video" };
  const selection = selectPremierMedia({ media: { catalog: [
    quickTime,
    { kind: "photo", url: "media/yard-poster.webp", source: "owner-upload", label: "Finished yard" },
  ] } });
  const html = renderPremierHeroMedia(selection, { businessName: "Yard Co" });

  assert.equal(videoMimeType(quickTime), "video/quicktime");
  assert.equal(isBrowserPlayableVideo(quickTime), false);
  assert.equal(selection.mode, "photo-cinematic-light");
  assert.equal(selection.hasSourceVideo, true);
  assert.equal(selection.hasPlayableSourceVideo, false);
  assert.equal(selection.unsupportedSourceVideo?.url, "media/yard-loop.mov");
  assert.match(html, /data-media-kind="photo"/);
  assert.doesNotMatch(html, /<video\b|video\/quicktime/i);
});

test("video-only heroes still expose a neutral reduced-motion fallback", () => {
  const html = renderPremierHeroMedia({ media: { catalog: [
    { kind: "video", url: "media/yard-loop.webm", source: "owner-upload" },
  ] } }, { businessName: "Yard Co" });
  const document = new JSDOM(html).window.document;

  assert.ok(document.querySelector(".premier-video-fallback--neutral[data-reduced-motion-fallback]"));
  assert.equal(document.querySelector("video")?.hasAttribute("poster"), false);
});

test("reduced motion hides autoplay video and reveals its poster fallback", async () => {
  const html = renderPremierHeroMedia({ media: { catalog: [
    { kind: "video", url: "media/yard-loop.webm", source: "owner-upload" },
    { kind: "photo", url: "media/yard-poster.webp", source: "owner-upload" },
  ] } }, { businessName: "Yard Co" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.setContent(html);
    const displays = await page.evaluate(() => ({
      video: getComputedStyle(document.querySelector("video")).display,
      fallback: getComputedStyle(document.querySelector("[data-reduced-motion-fallback]")).display,
    }));
    assert.equal(displays.video, "none");
    assert.notEqual(displays.fallback, "none");
  } finally {
    await browser.close();
  }
});

test("the app server maps every supported extension to a video MIME type", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  for (const [extension, mime] of MIME_CASES) {
    assert.match(server, new RegExp(`"\\.${extension}"\\s*:\\s*"${mime.replace("/", "\\/")}"`));
  }
});

test("V8 capture records browser playback evidence for video heroes", () => {
  const renderer = readFileSync(new URL("../../factory/pipeline/05-build-v8.mjs", import.meta.url), "utf8");
  assert.match(renderer, /async function captureVideoEvidence\(page\)/);
  assert.match(renderer, /current_time:\s*Number\(video\.currentTime/);
  assert.match(renderer, /video_evidence:\s*videoEvidence/);
  assert.match(renderer, /video\.readyState\s*>=\s*2/);
});
