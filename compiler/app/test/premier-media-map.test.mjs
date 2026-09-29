import test from "node:test";
import assert from "node:assert/strict";
import {
  isBrowserPlayableVideo,
  MAX_PREMIER_GALLERY_PHOTOS,
  renderPremierHeroMedia,
  selectPremierMedia,
  videoMimeType,
} from "../../factory/lib/premier-media.mjs";
import {
  buildPremierMap,
  renderPremierMap,
} from "../../factory/lib/premier-map.mjs";

function sourcePhoto(index, overrides = {}) {
  return {
    kind: "photo",
    url: `https://media.example.test/projects/photo-${index}.jpg`,
    source: "business-site",
    label: `Project photo ${index}`,
    width: 1800 + index,
    height: 1200,
    ...overrides,
  };
}

test("premier media keeps at most 12 sharp real source photos", () => {
  const media = selectPremierMedia([
    ...Array.from({ length: 14 }, (_, index) => sourcePhoto(index)),
    sourcePhoto(20, { url: "https://media.example.test/projects/sharpest.jpg", width: 3200, height: 2200 }),
    sourcePhoto(21, { url: "https://media.example.test/projects/tiny.jpg", width: 240, height: 180 }),
    { kind: "logo", url: "https://media.example.test/logo.svg", source: "business-site" },
    { kind: "photo", url: "https://images.unsplash.com/photo-stock.jpg", source: "stock-ambiance", width: 5000, height: 3000 },
    { kind: "photo", url: "javascript:alert(1)", source: "business-site", width: 5000, height: 3000 },
  ], { limit: 99 });

  assert.equal(media.gallery.length, MAX_PREMIER_GALLERY_PHOTOS);
  assert.match(media.gallery[0].url, /sharpest\.jpg/);
  assert.equal(media.gallery.some((asset) => /tiny|unsplash|logo/i.test(asset.url)), false);
});

test("truthful source video leads while synthetic video is ignored", () => {
  const input = {
    business: { name: 'Mesa & Sons "Landscape"' },
    media: {
      catalog: [
        sourcePhoto(1),
        { kind: "video", url: "https://media.example.test/hero-generated.mp4", source: "ai-generated", width: 3840, height: 2160 },
        { kind: "video", url: "https://media.example.test/real-work.mp4?caption=yard&size=large", source: "owner-upload", label: 'Owner video "spring"', width: 1920, height: 1080 },
      ],
    },
  };
  const media = selectPremierMedia(input);
  const html = renderPremierHeroMedia(input);

  assert.equal(media.mode, "source-video");
  assert.equal(media.sourceVideo.url.includes("real-work.mp4"), true);
  assert.match(html, /<video\b/);
  assert.match(html, /<video autoplay muted loop playsinline\b/);
  assert.match(html, /<source[^>]+type="video\/mp4"/);
  assert.match(html, /poster="https:\/\/media\.example\.test\/projects\/photo-1\.jpg"/);
  assert.match(html, /data-reduced-motion-fallback/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /data-media-kind="video"/);
  assert.doesNotMatch(html, /hero-generated/);
  assert.match(html, /&quot;spring&quot;/);
});

test("premier video sources declare every portable browser MIME type", () => {
  const cases = [
    ["walkthrough.mp4", "video/mp4"],
    ["walkthrough.m4v", "video/x-m4v"],
    ["walkthrough.ogg", "video/ogg"],
    ["walkthrough.ogv", "video/ogg"],
    ["walkthrough.webm", "video/webm"],
  ];

  for (const [file, mime] of cases) {
    const video = { kind: "video", url: "https://media.example.test/" + file + "?v=1", source: "owner-upload" };
    const html = renderPremierHeroMedia({ media: { catalog: [video, sourcePhoto(1)] } });
    assert.equal(videoMimeType(video), mime);
    assert.equal(isBrowserPlayableVideo(video), true);
    assert.ok(html.includes('type="' + mime + '"'));
    assert.match(html, /<video autoplay muted loop playsinline\b/);
  }
});

test("a source photo gets an honest motion fallback without video markup", () => {
  const input = { business: { name: "Mesa Landscape" }, media: { catalog: [sourcePhoto(1)] } };
  const media = selectPremierMedia(input);
  const html = renderPremierHeroMedia(input);

  assert.equal(media.mode, "photo-cinematic-light");
  assert.equal(media.hero.kind, "photo");
  assert.equal(media.hero.motion_fallback, true);
  assert.match(html, /data-media-kind="photo"/);
  assert.match(html, /data-motion-treatment="cinematic-light-shader"/);
  assert.doesNotMatch(html, /<video\b|data-media-kind="video"/i);
});

test("AI video may set atmosphere but never enters proof or gallery", () => {
  const selection = selectPremierMedia({
    business: { name: "Black Diamond" },
    media: { catalog: [
      { kind: "video", url: "media/brand-film.mp4", source: "ai-ambiance", role: "ambiance", generated: true },
      { kind: "photo", url: "https://client.example/project-one.jpg", source: "business-site", label: "Finished patio" },
    ] },
  });
  assert.equal(selection.mode, "ai-ambiance-video");
  assert.equal(selection.hasSourceVideo, false);
  assert.equal(selection.hasAmbianceVideo, true);
  assert.equal(selection.gallery.length, 1);
  assert.equal(selection.gallery[0].url, "https://client.example/project-one.jpg");
  const html = renderPremierHeroMedia(selection, { businessName: "Black Diamond" });
  assert.match(html, /data-media-provenance="ai-ambiance"/);
  assert.match(html, /data-proof-eligible="false"/);
  assert.match(html, /Cinematic brand concept/);
});

test("premier map renders a Google satellite iframe and both direction providers", () => {
  const map = buildPremierMap({
    lat: 38.6301749,
    lng: -121.3822236,
    business: {
      name: 'Mesa & Sons "Landscape"',
      address: '2805 Wah Ave, Sacramento, CA 95822 & Suite "B"',
      city: "Sacramento",
      state: "CA",
    },
  }, { googleMapsEmbedKey: "test-key" });
  const html = renderPremierMap(map);

  assert.equal(map.satellite, true);
  assert.match(map.embedUrl, /maptype=satellite/);
  assert.match(map.embedUrl, /[?&]output=embed(?:&|$)/);
  assert.doesNotMatch(map.embedUrl, /[?&]key=|\/embed\/v1/i);
  assert.equal(new URL(map.embedUrl).searchParams.get("q"), "38.6301749,-121.3822236");
  assert.equal(new URL(map.googleDirectionsUrl).searchParams.get("destination"), "38.6301749,-121.3822236");
  assert.equal(new URL(map.appleDirectionsUrl).searchParams.get("daddr"), "38.6301749,-121.3822236");
  assert.equal(map.label, '2805 Wah Ave, Sacramento, CA 95822 & Suite "B"');
  assert.match(map.googleDirectionsUrl, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(map.appleDirectionsUrl, /^https:\/\/maps\.apple\.com\//);
  assert.match(html, /data-google-map="satellite"/);
  assert.match(html, /data-lat="38\.6301749"/);
  assert.match(html, /data-lng="-121\.3822236"/);
  assert.doesNotMatch(html, /\sdata-map=/);
  assert.match(html, /Google Maps/);
  assert.match(html, /Apple Maps/);
  assert.match(html, /Mesa &amp; Sons &quot;Landscape&quot;/);
  assert.doesNotMatch(html, /<svg|circle|ring-map|concentric/i);
});

test("keyless and missing-location map states stay truthful", () => {
  const cityMap = buildPremierMap(
    { business: { name: "Mesa Landscape", city: "Sacramento", state: "CA" } },
    { googleMapsEmbedKey: "" },
  );
  assert.match(cityMap.embedUrl, /[?&]t=k(?:&|$)/);
  assert.doesNotMatch(cityMap.embedUrl, /[?&]key=|\/embed\/v1/i);
  assert.equal(cityMap.precision, "city");

  const unavailable = renderPremierMap({ business: { name: "Unknown Co" }, lat: "", lng: "" });
  assert.match(unavailable, /data-map-status="unavailable"/);
  assert.doesNotMatch(unavailable, /iframe|svg|circle|maps\.google|maps\.apple/i);
});
