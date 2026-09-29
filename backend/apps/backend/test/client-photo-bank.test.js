"use strict";
// test/client-photo-bank.test.js
//
// Every case here is a URL or a shape that was measured on a REAL prospect on
// 2026-08-11, not an invented one. The three that matter most:
//   · the client's own tenant space and the builder's shared stock library are
//     the SAME CDN host, so only the path can tell them apart;
//   · a stock asset id survives having the vendor's name stripped off it;
//   · Google Business photo RESOURCE NAMES are not URLs, which is why the
//     owner's second named photo source reached zero builds.

const test = require("node:test");
const assert = require("node:assert/strict");

const bankLib = require("../lib/client-photo-bank");
const { selectHeroImage } = require("../lib/mirror-engine/hero-image-selector");
const {
  notTheirPicture, gradePhoto, isNearDuplicate, gbpUrlsFromRecord, gbpNamesFromRecord,
  gbpMediaFromRecord, parsePlacePhotoResourceName,
  resolvePlaceMediaUrl, buildPhotoBank, bankFromHarvest, bankToRequestPhotos, bankIsFresh, bankFingerprint,
  pagesToOpen, memoFetch,
} = bankLib;

const HIBU_TENANT = "https://le-cdn.hibuwebsites.com/b847cc53fe7645bc9f7477d935660aac/dms3rep/multi/opt";
const HIBU_SHARED = "https://le-cdn.hibuwebsites.com/md/dmip/dms3rep/multi/opt";

// ---------------------------------------------------------------------------
// NOT THEIRS TO GIVE
// ---------------------------------------------------------------------------

test("the builder's shared stock library is refused; the client's own tenant space is not", () => {
  // Both are le-cdn.hibuwebsites.com. Only the path separates a pool party from
  // an HVAC contractor's own ductwork photograph.
  assert.equal(
    notTheirPicture({ url: `${HIBU_SHARED}/woman-boxer-sport-1920w.jpg` }),
    "builder_shared_stock",
  );
  assert.equal(
    notTheirPicture({ url: "https://le-cdn.hibuwebsites.com/md/dmtmpl/dms3rep/multi/opt/people_pool_party-1920w.jpg" }),
    "builder_shared_stock",
  );
  assert.equal(
    notTheirPicture({ url: `${HIBU_TENANT}/m-and-m-heating-and-cooling-hero-ductwork-1920w.jpg`, width: 1920, height: 907 }),
    "",
  );
});

test("a stock asset id is refused even with the vendor's name stripped off", () => {
  // RS3204056 is a professional studio photograph of a basement furnace whose
  // service sticker reads WESTMINSTER MECHANICAL INC. — a different company.
  assert.equal(notTheirPicture({ url: `${HIBU_TENANT}/RS3204056-2440x3660-1920w.jpg` }), "stock_library_id");
  // …and with the copy suffix, where the space arrives percent-encoded.
  assert.equal(notTheirPicture({ url: `${HIBU_TENANT}/RS86517326+%281%29-1920w.jpg` }), "stock_library_id");
  // A name that merely CONTAINS those letters is not an id.
  assert.equal(notTheirPicture({ url: "https://acme.com/photos/CARS1234-crew.jpg", width: 1600, height: 900 }), "");
});

test("a generated picture is not a photograph of their work", () => {
  assert.equal(
    notTheirPicture({ url: `${HIBU_TENANT}/Gemini_Generated_Image_6mayjy6mayjy6may-1920w.png` }),
    "ai_generated_image",
  );
});

test("a manufacturer badge on the client's own domain is refused", () => {
  // The same denylist that exists because Mastercool's trademark shipped as a
  // client's logo. A contractor's own server is where those badges live.
  assert.equal(notTheirPicture({ url: "https://simmonsplumbing.info/uploads/mastercool-logo10874446.png" }), "third_party_mark");
  assert.equal(notTheirPicture({ url: `${HIBU_TENANT}/Tranepic-1920w.jpg` }), "third_party_mark");
});

test("Google Business media is exempt from the FILENAME denylist, not from the rest", () => {
  // A GBP path is an opaque ~200-char token. Three denylist entries are three
  // letters long, so run against random base64 the basename test would refuse
  // real profile photographs for accidentally spelling a roofing brand.
  const gbp = "https://lh3.googleusercontent.com/place-photos/AG9NLjCgafiko3epaXamznTrane1";
  assert.equal(notTheirPicture({ url: gbp, width: 1600, height: 900 }), "");
  // Shape still applies to it.
  assert.equal(notTheirPicture({ url: gbp, width: 1600, height: 200 }), "banner_shape");
});

test("a banner strip is refused by shape, in both orientations", () => {
  assert.equal(notTheirPicture({ url: "https://acme.com/i/web-banner.png", width: 728, height: 90 }), "banner_shape");
  assert.equal(notTheirPicture({ url: "https://acme.com/i/rail.png", width: 90, height: 728 }), "banner_shape");
  assert.equal(notTheirPicture({ url: "https://acme.com/i/job.jpg", width: 1920, height: 1080 }), "");
});

test("unknown dimensions never make something a refusal", () => {
  assert.equal(notTheirPicture({ url: "https://acme.com/i/job.avif" }), "");
});

// ---------------------------------------------------------------------------
// GRADE — which two of their photographs the donor's two slots get
// ---------------------------------------------------------------------------

test("hero grade is wide, big and landscape; a promo tile is not", () => {
  assert.equal(gradePhoto({ width: 1920, height: 907 }).grade, "hero");
  assert.equal(gradePhoto({ width: 1600, height: 900 }).grade, "hero");
  assert.equal(gradePhoto({ width: 600, height: 350 }).grade, "thumbnail");
  // Big but portrait: a real photograph, wrong shape for a hero.
  assert.equal(gradePhoto({ width: 1600, height: 2133 }).grade, "gallery");
  // Big but a panorama: too extreme to sit behind headline text.
  assert.equal(gradePhoto({ width: 1700, height: 400 }).grade, "gallery");
});

test("an unreadable header is graded on weight, never refused as small", () => {
  assert.equal(gradePhoto({ bytes: 300_000 }).grade, "gallery");
  assert.equal(gradePhoto({ bytes: 4_000 }).grade, "thumbnail");
});

test("a stock caption in the client's own upload folder is demoted, never refused", () => {
  const { stockCaptionSuspect } = bankLib;
  // Measured on azurefrisco.com: these two sit in /wp-content/uploads/ beside
  // the owner's own phone photographs. The filename is the library's caption.
  assert.equal(stockCaptionSuspect(
    "https://azurefrisco.com/wp-content/uploads/a-permanent-makeup-master-checking-the-symmetry-of-the-eyebrow-marking.jpg", ["azurefrisco"],
  ), true);
  assert.equal(stockCaptionSuspect(
    "https://azurefrisco.com/wp-content/uploads/slim-woman-in-overweight-pants-looking-herself-in-a-mirror.jpg", ["azurefrisco"],
  ), true);
  // Their own, from the same folder: a camera stamp and a named subject.
  assert.equal(stockCaptionSuspect("https://azurefrisco.com/wp-content/uploads/IMG-20230607-WA0004.jpg", ["azurefrisco"]), false);
  assert.equal(stockCaptionSuspect("https://azurefrisco.com/wp-content/uploads/DrRamirez_AzureMedSpa-scaled.webp", ["azurefrisco"]), false);
  // A business that names its own work is never flagged.
  assert.equal(stockCaptionSuspect("https://acme.com/i/acme-crew-installing-a-new-furnace-downtown.jpg", ["acme"]), false);
  // Short names are not captions.
  assert.equal(stockCaptionSuspect("https://acme.com/i/our-van.jpg", []), false);
  // …and it is only an ORDER signal: notTheirPicture never refuses on it.
  assert.equal(
    notTheirPicture({ url: "https://azurefrisco.com/wp-content/uploads/a-permanent-makeup-master-checking-the-symmetry.jpg", width: 1000, height: 1100 }),
    "",
  );
});

// ---------------------------------------------------------------------------
// THE SAME PHOTOGRAPH TWICE
// ---------------------------------------------------------------------------

test("the same photograph re-encoded under another name is one photograph", () => {
  // Measured: IMG_0182-1920w.jpg (241470 B) and
  // m-and-m-heating-and-cooling-hero-ductwork-1920w.jpg (241405 B) are both
  // 1920x907 and are the identical picture of M & M's two branded vans.
  assert.equal(isNearDuplicate({ width: 1920, height: 907, bytes: 241470 }, { width: 1920, height: 907, bytes: 241405 }), true);
  // Different sizes are different pictures.
  assert.equal(isNearDuplicate({ width: 1920, height: 907, bytes: 241470 }, { width: 1920, height: 908, bytes: 241405 }), false);
  // Same dimensions but genuinely different frames are not collapsed.
  assert.equal(isNearDuplicate({ width: 1920, height: 907, bytes: 241470 }, { width: 1920, height: 907, bytes: 180000 }), false);
});

// ---------------------------------------------------------------------------
// GOOGLE BUSINESS PROFILE — reading what is already on the record
// ---------------------------------------------------------------------------

test("resolved GBP urls are found where the lanes actually left them", () => {
  // The exact shape of M & M Heating's row: OBJECTS, under
  // leadminer_mirror_ready, not under `record.photos` (which nothing writes).
  const record = {
    place_id: "ChIJabc",
    leadminer_mirror_ready: {
      photos: [
        {
          url: "https://lh3.googleusercontent.com/place-photos/AAA=s4800-w1600",
          source: "gbp",
          place_id: "ChIJabc",
          resource_name: "places/ChIJabc/photos/AAA",
        },
        {
          url: "https://lh3.googleusercontent.com/place-photos/BBB=s4800-w1600",
          source: "gbp",
          place_id: "ChIJabc",
        },
      ],
    },
    truth_packet: { mirror_ready: { photos: [{ url: "https://lh3.googleusercontent.com/place-photos/AAA=s4800-w1600" }] } },
  };
  assert.deepEqual(gbpUrlsFromRecord(record), [
    "https://lh3.googleusercontent.com/place-photos/AAA=s4800-w1600",
  ]);
  assert.deepEqual(gbpMediaFromRecord(record)[0], {
    url: "https://lh3.googleusercontent.com/place-photos/AAA=s4800-w1600",
    place_id: "ChIJabc",
    resource_name: "places/ChIJabc/photos/AAA",
  });
  assert.deepEqual(gbpUrlsFromRecord({
    place_id: "ChIJabc",
    photos: ["https://lh3.googleusercontent.com/place-photos/legacy"],
  }), [], "a bare legacy URL cannot be restamped as pinned GBP proof");
  assert.deepEqual(gbpUrlsFromRecord({}), []);
});

test("a place-id-only resolved GBP object is refused without its resource pin", async () => {
  const url = "https://lh3.googleusercontent.com/place-photos/place-id-only";
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    record: {
      place_id: "ChIJabc",
      photos: [{ url, source: "gbp", place_id: "ChIJabc" }],
    },
    placesApiKey: "",
    fetchImpl: pageFetch({}, "<html></html>"),
    harvest: stubHarvest({ gbp: [{ url, source: "gbp", sha256: "f".repeat(64), bytes: 250000, width: 1600, height: 900 }] }),
  });
  assert.equal(bank.photos.length, 0);
  assert.ok(bank.refused.some((row) => row.url === url && row.reason === "gbp_resource_name_unpinned"));
});

test("a fully pinned resolved GBP object is reused without another media call", async () => {
  const url = "https://lh3.googleusercontent.com/place-photos/already-resolved";
  let mediaCalls = 0;
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    record: {
      place_id: "ChIJabc",
      gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJabc",
      photos: [{
        url,
        source: "gbp",
        place_id: "ChIJabc",
        resource_name: "places/ChIJabc/photos/AeJresolved",
      }],
    },
    placesApiKey: "KEY",
    fetchImpl: pageFetch({}, "<html></html>"),
    resolveMedia: async () => { mediaCalls++; return url; },
    harvest: stubHarvest({ gbp: [{ url, source: "gbp", sha256: "a".repeat(64), bytes: 250000, width: 1600, height: 900 }] }),
  });
  assert.equal(mediaCalls, 0, "resolved exact evidence does not spend the same billed call twice");
  assert.equal(bank.photos[0].resource_name, "places/ChIJabc/photos/AeJresolved");
});

test("Places photo RESOURCE NAMES are recognised as needing a media call", () => {
  const record = { photos: ["places/ChIJabc/photos/AeJxyz", "https://acme.com/a.jpg"] };
  assert.deepEqual(gbpNamesFromRecord(record), ["places/ChIJabc/photos/AeJxyz"]);
  // …and are NOT mistaken for urls.
  assert.deepEqual(gbpUrlsFromRecord(record), []);
  assert.deepEqual(parsePlacePhotoResourceName("places/ChIJabc/photos/AeJxyz"), {
    resource_name: "places/ChIJabc/photos/AeJxyz",
    place_id: "ChIJabc",
    photo_id: "AeJxyz",
  });
});

test("a resource name resolves to a durable https media url", async () => {
  let asked = "";
  const fetchImpl = async (url) => {
    asked = url;
    return { ok: true, json: async () => ({ photoUri: "https://lh3.googleusercontent.com/place-photos/ZZZ" }) };
  };
  const out = await resolvePlaceMediaUrl("places/ChIJabc/photos/AeJxyz", { apiKey: "K", fetchImpl });
  assert.equal(out, "https://lh3.googleusercontent.com/place-photos/ZZZ");
  assert.match(asked, /skipHttpRedirect=true/, "asks for JSON rather than following a 302 we cannot bank");
  // No key, no call, no invention.
  assert.equal(await resolvePlaceMediaUrl("places/a/photos/b", { apiKey: "", fetchImpl }), null);
  assert.equal(await resolvePlaceMediaUrl("https://not-a-resource-name/", { apiKey: "K", fetchImpl }), null);
});

// ---------------------------------------------------------------------------
// THE BANK
// ---------------------------------------------------------------------------

// memoFetch caches BYTES and serves text() from them, so a stub page must put
// its markup in arrayBuffer() — returning it only from text() yields an empty
// page and no candidates at all.
function pageFetch(byUrl, fallback = "<html></html>") {
  return async (url) => {
    const body = Object.prototype.hasOwnProperty.call(byUrl, String(url)) ? byUrl[String(url)] : fallback;
    const buf = Buffer.from(body, "utf8");
    return { ok: true, status: 200, arrayBuffer: async () => buf, text: async () => body };
  };
}

function stubHarvest(byPage) {
  return async ({ website, html }) => {
    const key = html && html.includes("gbp only") ? "gbp" : website;
    const photos = byPage[key] || [];
    return { ok: true, photos, rejected: [] };
  };
}

test("the bank records where each photograph was found, and its sha", async () => {
  const pages = {
    "https://acme.com/": [
      { url: "https://acme.com/i/van.jpg", source: "own_site", sha256: "a".repeat(64), ext: "jpg", bytes: 200000, width: 1920, height: 1080, rank: -300 },
    ],
    "https://acme.com/gallery": [
      { url: "https://acme.com/i/job.jpg", source: "own_site", sha256: "b".repeat(64), ext: "jpg", bytes: 150000, width: 1600, height: 1200, rank: -300 },
    ],
  };
  const fetchImpl = pageFetch({
    "https://acme.com/": '<img src="https://acme.com/i/van.jpg"><a href="/gallery">Gallery</a>',
    "https://acme.com/gallery": '<img src="https://acme.com/i/job.jpg">',
  });
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    fetchImpl,
    harvest: stubHarvest(pages),
    placesApiKey: "",
    now: () => "2026-08-11T00:00:00.000Z",
  });
  assert.equal(bank.verdict, "photography");
  assert.equal(bank.photos.length, 2);
  const byUrl = Object.fromEntries(bank.photos.map((p) => [p.url, p]));
  assert.equal(byUrl["https://acme.com/i/van.jpg"].found_on, "https://acme.com/");
  assert.equal(byUrl["https://acme.com/i/job.jpg"].found_on, "https://acme.com/gallery");
  assert.equal(byUrl["https://acme.com/i/van.jpg"].grade, "hero");
  assert.equal(byUrl["https://acme.com/i/van.jpg"].sha256.length, 64);
});

test('"no usable photography" is a real answer, and says why', async () => {
  const fetchImpl = pageFetch({}, `<img src="${HIBU_SHARED}/woman-boxer-sport-1920w.jpg">`);
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    fetchImpl,
    harvest: stubHarvest({
      "https://acme.com/": [
        { url: `${HIBU_SHARED}/woman-boxer-sport-1920w.jpg`, source: "own_site", sha256: "c".repeat(64), bytes: 200000, width: 1920, height: 1280 },
      ],
    }),
    placesApiKey: "",
  });
  assert.equal(bank.verdict, "no_usable_photography");
  assert.equal(bank.photos.length, 0);
  assert.match(bank.note, /builder_shared_stock/);
});

test("no website and no Google media is 'not attempted', not 'they have none'", async () => {
  const bank = await buildPhotoBank({ website: "", record: {}, placesApiKey: "" });
  assert.equal(bank.verdict, "not_attempted");
  assert.match(bank.note, /nothing to read/);
});

test("hero-grade photographs lead the array the donor's slots are filled from", async () => {
  const photos = [
    { url: "https://acme.com/i/tile.png", source: "own_site", sha256: "1".repeat(64), bytes: 40000, width: 600, height: 350 },
    { url: "https://acme.com/i/crew.jpg", source: "own_site", sha256: "2".repeat(64), bytes: 300000, width: 1920, height: 1080 },
  ];
  const fetchImpl = pageFetch({}, '<img src="https://acme.com/i/tile.png"><img src="https://acme.com/i/crew.jpg">');
  const bank = await buildPhotoBank({ website: "https://acme.com/", fetchImpl, harvest: stubHarvest({ "https://acme.com/": photos }), placesApiKey: "" });
  assert.deepEqual(bankToRequestPhotos(bank, 8), ["https://acme.com/i/crew.jpg", "https://acme.com/i/tile.png"]);
});

test("their Google media is used when their own site came up short", async () => {
  const gbp = "https://lh3.googleusercontent.com/place-photos/QQQ=s4800-w1600";
  let mediaCalls = 0;
  const fetchImpl = pageFetch({}, "<html></html>");
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    record: {
      place_id: "ChIJabc",
      gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJabc",
      photos: ["places/ChIJabc/photos/AeJxyz"],
    },
    placesApiKey: "KEY",
    fetchImpl,
    resolveMedia: async () => { mediaCalls++; return gbp; },
    harvest: stubHarvest({ gbp: [{ url: gbp, source: "gbp", sha256: "d".repeat(64), bytes: 250000, width: 1600, height: 900 }] }),
  });
  assert.equal(mediaCalls, 1);
  assert.equal(bank.cost.gbp_media_calls, 1);
  assert.deepEqual(bankToRequestPhotos(bank, 8), [gbp]);
  assert.equal(bank.place_id, "ChIJabc");
  assert.equal(bank.photos[0].place_id, "ChIJabc",
    "GBP bytes stay pinned to the exact Places business that supplied them");
  assert.equal(bank.photos[0].resource_name, "places/ChIJabc/photos/AeJxyz");
  assert.equal(bank.photos[0].found_on, "https://www.google.com/maps/place/?q=place_id:ChIJabc");
});

test("a ChIJ_A record refuses a ChIJ_B media resource before the billed call", async () => {
  let mediaCalls = 0;
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    record: { place_id: "ChIJ_A", photos: ["places/ChIJ_B/photos/AeJforeign"] },
    placesApiKey: "KEY",
    fetchImpl: pageFetch({}, "<html></html>"),
    resolveMedia: async () => { mediaCalls++; return "https://lh3.googleusercontent.com/place-photos/foreign"; },
    harvest: stubHarvest({ gbp: [] }),
  });
  assert.equal(mediaCalls, 0, "identity mismatch spends zero Places media calls");
  assert.equal(bank.cost.gbp_media_calls, 0);
  assert.ok(bank.refused.some((row) => (
    row.url === "places/ChIJ_B/photos/AeJforeign"
    && row.reason === "gbp_place_id_mismatch"
  )));
  assert.equal(bank.photos.length, 0);
});

test("an inline GBP harvest carries its exact Places identity pin", () => {
  const raw = {
    url: "https://lh3.googleusercontent.com/place-photos/pinned",
    source: "gbp",
    sha256: "e".repeat(64),
    bytes: 250000,
    width: 1600,
    height: 900,
  };
  const unpinned = bankFromHarvest([raw], { website: "https://acme.com/", placeId: "ChIJpinned" });
  assert.equal(unpinned.photos.length, 0, "place_id at bank level cannot launder a raw GBP URL");
  assert.ok(unpinned.refused.some((row) => row.reason === "gbp_identity_unpinned"));

  const attackerProfile = bankFromHarvest([raw], {
    website: "https://acme.com/",
    placeId: "ChIJpinned",
    gbpEvidence: [{
      url: raw.url,
      place_id: "ChIJpinned",
      resource_name: "places/ChIJpinned/photos/AeJpinned",
      found_on: "https://google.evil.com/maps/place/ChIJpinned",
    }],
  });
  assert.equal(attackerProfile.photos[0].found_on, "google_business_profile",
    "an attacker domain cannot pose as the exact Google Maps profile URL");

  const bank = bankFromHarvest([raw], {
    website: "https://acme.com/",
    placeId: "ChIJpinned",
    gbpEvidence: [{
      url: raw.url,
      place_id: "ChIJpinned",
      resource_name: "places/ChIJpinned/photos/AeJpinned",
      found_on: "https://www.google.com/maps/place/?q=place_id:ChIJpinned",
    }],
  });
  assert.equal(bank.place_id, "ChIJpinned");
  assert.equal(bank.photos[0].place_id, "ChIJpinned");
  assert.equal(bank.photos[0].resource_name, "places/ChIJpinned/photos/AeJpinned");
  assert.equal(bank.photos[0].found_on, "https://www.google.com/maps/place/?q=place_id:ChIJpinned");
});

test("a billed Places media call is not made when their own site already delivered", async () => {
  let mediaCalls = 0;
  const own = Array.from({ length: 5 }, (_, i) => ({
    url: `https://acme.com/i/job${i}.jpg`, source: "own_site", sha256: String(i).repeat(64).slice(0, 64),
    bytes: 200000 + i, width: 1920, height: 1080 + i,
  }));
  const fetchImpl = pageFetch({}, own.map((p) => `<img src="${p.url}">`).join(""));
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    record: { photos: ["places/ChIJabc/photos/AeJxyz"] },
    placesApiKey: "KEY",
    fetchImpl,
    resolveMedia: async () => { mediaCalls++; return "https://lh3.googleusercontent.com/place-photos/QQQ"; },
    harvest: stubHarvest({ "https://acme.com/": own }),
  });
  assert.equal(mediaCalls, 0, "five of their own photographs is not a reason to buy more");
  assert.equal(bank.photos.length, 5);
});

test("a harvest that throws costs the photographs, never the caller", async () => {
  const fetchImpl = pageFetch({}, '<img src="https://acme.com/i/a.jpg">');
  const bank = await buildPhotoBank({
    website: "https://acme.com/",
    fetchImpl,
    harvest: async () => { throw new Error("network is down"); },
    placesApiKey: "",
  });
  assert.equal(bank.photos.length, 0);
  assert.equal(bank.verdict, "no_usable_photography");
  assert.ok(bank.refused.some((r) => /harvest_threw/.test(r.reason)));
});

// ---------------------------------------------------------------------------
// DURABILITY — the point of banking at all
// ---------------------------------------------------------------------------

test("a fresh bank is reusable; a stale or shapeless one is not", () => {
  const now = () => Date.parse("2026-08-11T00:00:00Z");
  assert.equal(bankIsFresh({ harvested_at: "2026-08-01T00:00:00Z", photos: [] }, { now }), true);
  assert.equal(bankIsFresh({ harvested_at: "2026-05-01T00:00:00Z", photos: [] }, { now }), false);
  assert.equal(bankIsFresh({ harvested_at: "2099-01-01T00:00:00Z", photos: [] }, { now }), false,
    "a future timestamp is not proof of a fresh harvest");
  assert.equal(bankIsFresh({ photos: [] }, { now }), false);
  assert.equal(bankIsFresh(null, { now }), false);
});

test("the fingerprint changes only when the photographs change", () => {
  const a = { photos: [{ sha256: "aa" }, { sha256: "bb" }] };
  const b = { photos: [{ sha256: "aa" }, { sha256: "bb" }] };
  const c = { photos: [{ sha256: "aa" }, { sha256: "cc" }] };
  assert.equal(bankFingerprint(a), bankFingerprint(b));
  assert.notEqual(bankFingerprint(a), bankFingerprint(c));
});

test("only the client's own pages are opened, and only the useful ones", () => {
  const html = `
    <a href="/gallery">Gallery</a>
    <a href="/about-us">About</a>
    <a href="/privacy">Privacy</a>
    <a href="https://facebook.com/acme">Facebook</a>`;
  const pages = pagesToOpen("https://acme.com/", html);
  assert.equal(pages[0], "https://acme.com/");
  assert.ok(pages.includes("https://acme.com/gallery"));
  assert.ok(pages.includes("https://acme.com/about-us"));
  assert.ok(!pages.some((p) => /facebook/.test(p)), "never off-domain");
  assert.ok(!pages.some((p) => /privacy/.test(p)), "no photographs live on a privacy page");
  assert.ok(pages.length <= 5);
});

test("the same image on five pages is fetched once", async () => {
  let calls = 0;
  const raw = async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("bytes") }; };
  const f = memoFetch(raw);
  await Promise.all([f("https://acme.com/i/a.jpg"), f("https://acme.com/i/a.jpg"), f("https://acme.com/i/a.jpg")]);
  assert.equal(calls, 1);
  const r = await f("https://acme.com/i/a.jpg");
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), "bytes");
});

// ---------------------------------------------------------------------------
// bankFromHarvest — the SAME bank, from a harvest that ALREADY ran (no network)
//
// The resolver build path harvests the client's photography inline and used to
// keep only the URL strings; the ranked rows, grades and shas were thrown away,
// so the design brief's identity verdicts had nothing to land on and the hero
// wash shipped "no_photo_bank" on every page. This is the function that turns
// that in-hand harvest into the durable bank those consumers read.
// ---------------------------------------------------------------------------

test("bankFromHarvest banks a fresh, ranked, ownership-gated bank from an in-hand harvest", () => {
  const harvest = [
    { url: "https://acme.com/i/crew.jpg", source: "own_site", sha256: "a".repeat(64), ext: "jpg", bytes: 300000, width: 1920, height: 1080, rank: -300 },
    { url: "https://acme.com/i/tile.png", source: "own_site", sha256: "b".repeat(64), ext: "png", bytes: 40000, width: 600, height: 350, rank: 0 },
    // The builder's SHARED stock library, served from the client's own CDN. The
    // URL ownership gate cannot see it; notTheirPicture can, so it never banks.
    { url: `${HIBU_SHARED}/woman-boxer-sport-1920w.jpg`, source: "own_site", sha256: "c".repeat(64), ext: "jpg", bytes: 250000, width: 1600, height: 900, rank: -100 },
  ];
  const bank = bankFromHarvest(harvest, { website: "https://acme.com/" });
  // A durable bank the downstream consumers read: fresh, versioned, timestamped.
  assert.equal(bankIsFresh(bank), true);
  assert.equal(bank.source, "inline_harvest");
  assert.equal(bank.verdict, "photography");
  const urls = bank.photos.map((p) => p.url);
  assert.ok(!urls.some((u) => /woman-boxer/.test(u)), "the builder's shared stock is refused, not banked");
  assert.ok(bank.refused.some((r) => r.reason === "builder_shared_stock"));
  // Hero-grade leads — the order the donor's slots AND the hero wash read.
  assert.deepEqual(urls, ["https://acme.com/i/crew.jpg", "https://acme.com/i/tile.png"]);
  assert.equal(bank.photos[0].grade, "hero");
  assert.equal(bank.photos[0].sha256, "a".repeat(64), "the sha the engine joins photo bytes on survives");
});

test("explicit logo truth survives the durable bank and vetoes an opaque asset", () => {
  for (const [suffix, shaChar, flags, expectedType] of [
    ["a1", "c", { logoLike: true, kind: "Brand-Mark" }, "brand_mark"],
    ["a2", "e", { logo_like: true, asset_type: "word-mark" }, "wordmark"],
  ]) {
    const signaled = bankFromHarvest([{
      url: `https://acme.com/i/opaque-${suffix}`,
      source: "own_site",
      sha256: shaChar.repeat(64),
      bytes: 300_000,
      width: 1600,
      height: 900,
      ...flags,
    }], { website: "https://acme.com/" });
    assert.equal(signaled.photos.length, 1);
    assert.equal(signaled.photos[0].logo_like, true);
    assert.equal(signaled.photos[0].asset_type, expectedType);
    const refused = selectHeroImage(signaled.photos);
    assert.equal(refused.best, null);
    assert.match(refused.rejected[0].reason, /likely-logo/);
  }

  const unflagged = bankFromHarvest([{
    url: "https://acme.com/i/opaque-b2",
    source: "own_site",
    sha256: "d".repeat(64),
    bytes: 300_000,
    width: 1600,
    height: 900,
    asset_type: "photograph",
    kind: "hero",
  }], { website: "https://acme.com/" });
  assert.equal(Object.hasOwn(unflagged.photos[0], "logo_like"), false);
  assert.equal(Object.hasOwn(unflagged.photos[0], "asset_type"), false,
    "an explicit unknown type fails closed instead of being reclassified");
  assert.strictEqual(selectHeroImage(unflagged.photos).best, unflagged.photos[0],
    "an opaque filename alone never invents a logo signal");
});

test("real-scene classification fails closed for stock, brand, unknown dimensions, and GBP", () => {
  const base = {
    url: "https://acme.com/gallery/crew-install.jpg",
    source: "own_site",
    found_on: "https://acme.com/gallery",
    sha256: "7".repeat(64),
    width: 1600,
    height: 900,
    grade: "hero",
  };
  assert.equal(bankLib.classifiedAssetType(base, { deriveOwnSiteScene: true }), "real_scene");
  assert.equal(bankLib.classifiedAssetType({ ...base, stock_caption_suspect: true }, { deriveOwnSiteScene: true }), "");
  assert.equal(bankLib.classifiedAssetType({ ...base, asset_type: "logo" }, { deriveOwnSiteScene: true }), "logo");
  assert.equal(bankLib.classifiedAssetType({ ...base, width: 0, height: 0, grade: "gallery" }, { deriveOwnSiteScene: true }), "");
  assert.equal(bankLib.classifiedAssetType({ ...base, source: "gbp" }, { deriveOwnSiteScene: true }), "");
  assert.equal(bankLib.classifiedAssetType({ ...base, asset_type: "unknown" }, { deriveOwnSiteScene: true }), "");
});

test("bankFromHarvest is empty and honest when nothing is usable, and de-dupes a re-encode", () => {
  const empty = bankFromHarvest([], { website: "https://acme.com/" });
  assert.deepEqual(empty.photos, []);
  assert.equal(empty.verdict, "no_usable_photography");
  // The identical photograph re-encoded under another name is ONE photograph —
  // same dimensions, byte sizes within 1.5% — and the loser is recorded.
  const dupe = [
    { url: "https://acme.com/a.jpg", source: "own_site", sha256: "1".repeat(64), ext: "jpg", bytes: 241470, width: 1920, height: 907, rank: -10 },
    { url: "https://acme.com/a-copy.jpg", source: "own_site", sha256: "2".repeat(64), ext: "jpg", bytes: 241405, width: 1920, height: 907, rank: -9 },
  ];
  const bank = bankFromHarvest(dupe, { website: "https://acme.com/" });
  assert.equal(bank.photos.length, 1);
  assert.ok(bank.refused.some((r) => /near_duplicate_of/.test(r.reason)));
});
