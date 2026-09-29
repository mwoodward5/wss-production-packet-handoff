import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPremierHeroMedia,
  selectPremierMedia,
  HERO_PRODUCTION_BOX,
  HERO_MAX_PRODUCTION_UPSCALE,
} from "../../factory/lib/premier-media.mjs";

// Production hero-geometry safety margin (fix for job_1sG0DAWB2_GQ /
// job_cSbLJas6W3qx): a verified 900x601 photo projects to 2.183x locally
// against the frozen 2.2x QC limit and blocked production twice. Selection
// must refuse verified photos that project above 2.0x against the worst-case
// hero box, without touching the QC threshold itself.

const photo = (url, width, height, extra = {}) => ({
  kind: "photo", url, source: "business-site", width, height, ...extra,
});

test("verified near-limit photo (900x601) is not selected as the hero", () => {
  const selection = selectPremierMedia({ media: { catalog: [
    photo("https://example.com/near-limit.jpg", 900, 601),
  ] } });
  assert.equal(selection.sourcePhoto, null);
  assert.equal(selection.mode, "none");
});

test("a verified production-safe photo wins over a near-limit one", () => {
  const selection = selectPremierMedia({ media: { catalog: [
    photo("https://example.com/near-limit.jpg", 900, 601),
    photo("https://example.com/safe.jpg", 1536, 1024),
  ] } });
  assert.equal(selection.sourcePhoto?.url, "https://example.com/safe.jpg");
  assert.equal(selection.mode, "photo-cinematic-light");
});

test("safety threshold matches the exported production contract", () => {
  // 1440x1380 box at 2.0x => minimum verified 720x690.
  const unsafe = selectPremierMedia({ media: { catalog: [
    photo("https://example.com/short.jpg", 1440, 689),
  ] } });
  assert.equal(unsafe.sourcePhoto, null);
  const safe = selectPremierMedia({ media: { catalog: [
    photo("https://example.com/tall-enough.jpg", 720, 690),
  ] } });
  assert.equal(safe.sourcePhoto?.url, "https://example.com/tall-enough.jpg");
  assert.equal(HERO_PRODUCTION_BOX.width / HERO_MAX_PRODUCTION_UPSCALE, 720);
  assert.equal(HERO_PRODUCTION_BOX.height / HERO_MAX_PRODUCTION_UPSCALE, 690);
});

test("photos without verified dimensions keep existing behavior", () => {
  const selection = selectPremierMedia({ media: { catalog: [
    { kind: "photo", url: "media/yard-poster.webp", source: "owner-upload" },
  ] } });
  assert.equal(selection.sourcePhoto?.url, "media/yard-poster.webp");
  assert.equal(selection.mode, "photo-cinematic-light");
});

test("unsafe hero photos remain available to the gallery", () => {
  const selection = selectPremierMedia({ media: { catalog: [
    photo("https://example.com/near-limit.jpg", 900, 601),
  ] } });
  assert.equal(selection.gallery.some((a) => a.url === "https://example.com/near-limit.jpg"), true);
  const rendered = renderPremierHeroMedia(selection, { businessName: "Example Roofing" });
  assert.match(rendered, /premier-media--source-photo-contact-sheet/);
  assert.match(rendered, /data-media-kind="source-photo-contact-sheet"/);
  assert.match(rendered, /data-media-presentation="inset-contact-sheet"/);
  assert.doesNotMatch(rendered, /data-media-kind="photo"/);
});

test("truthful ambiance fallback carries the hero when no photo is safe", () => {
  const selection = selectPremierMedia({
    media: { catalog: [photo("https://example.com/near-limit.jpg", 900, 601)] },
    ambiance_video: { url: "media/ambiance.mp4", kind: "video", source: "ai-ambiance" },
  });
  if (selection.ambianceVideo) {
    assert.equal(selection.mode, "ai-ambiance-video");
    assert.equal(selection.hero?.truthful_source, false);
  } else {
    // If the packet shape doesn't expose an ambiance video, the hero must be
    // empty rather than an unsafe photo.
    assert.equal(selection.hero, null);
  }
});
