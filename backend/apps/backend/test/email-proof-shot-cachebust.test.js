"use strict";

// ---------------------------------------------------------------------------
// THE CACHE-BUST IS CLEAN 7-BIT ASCII HEX, OR IT IS NOTHING.
// ---------------------------------------------------------------------------
//
// A delivered proof (Gmail 19ff92d7b2f20918, Family Heating & Air) shipped its
// after-shot with a corrupted cache-bust: "…&v=new-mobile&c<0x18>351cb0662b".
// A `node -e` edit run with a Windows path had replaced the "=" in the inline
// `&c=${…}` cache-bust literal with a 0x18 control byte in the source, and
// because nothing downstream inspects the middle of a signed URL it rode all the
// way into Gmail — whose image proxy then kept serving the pre-blue cached
// capture, so the owner saw a non-blue "after".
//
// lib/email.js now builds the param through proofShotCacheBust() (hex-only by
// construction) and assembles the whole URL through assembleShotUrl(), which
// REFUSES any URL carrying a control or non-ascii byte. This file pins both, and
// pins the rendered email so neither MIME half can carry a mangled shot URL.

const test = require("node:test");
const assert = require("node:assert/strict");
const { proofShotCacheBust, assembleShotUrl } = require("../lib/email");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");

const VARIANTS = ["old", "new", "old-mobile", "new-mobile"];
const BASE = "https://ghost.wss-ai.com";
// A realistic signed relative path, exactly the shape preview-visuals.signedVisualPath
// emits (URLSearchParams: k=<base64url>.<...>, s=<base64url sig>, v=<variant>).
const REL = (v) => `/api/media/preview-shot?k=bmV3.aHR0cHM.bm9uY2U&s=Zm9vYmFyc2lnbmF0dXJl&v=${v}`;
const SHA = "351cb0662bff0011a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6";

// A control byte is any char below 0x20 (except the ordinary whitespace \t \n \r
// that structured HTML/text legitimately contains) or DEL (0x7f).
const CONTROL_BYTE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const ANY_CONTROL_BYTE = /[\x00-\x1f\x7f]/;

test("proofShotCacheBust emits clean lowercase-hex &c= for every digest shape", () => {
  assert.equal(proofShotCacheBust(SHA), "&c=351cb0662bff");
  assert.match(proofShotCacheBust(SHA), /^&c=[0-9a-f]{12}$/);
  // an uppercase digest is normalized down to the /[0-9a-f]+/ the assertion wants
  assert.equal(proofShotCacheBust("ABCDEF0123456789ABCDEF"), "&c=abcdef012345");
  // absent / junk / too-short digest -> no param at all, never a control byte
  for (const bad of ["", "   ", "nothex!!!!!!!!!!", "abc", "351cb066", null, undefined, 12345, {}, []]) {
    assert.equal(proofShotCacheBust(bad), "", `expected "" for ${JSON.stringify(bad)}`);
  }
  assert.equal(ANY_CONTROL_BYTE.test(proofShotCacheBust(SHA)), false);
});

test("assembleShotUrl produces control-byte-free ascii with a clean &c= hex — all four variants", () => {
  for (const v of VARIANTS) {
    const url = assembleShotUrl(BASE, REL(v), SHA);
    assert.ok(url, `variant ${v} produced no URL`);
    assert.ok(url.includes(`&v=${v}`), `variant ${v} lost its v param`);
    // the task's exact acceptance shape:
    assert.match(url, /[?&]c=[0-9a-f]+/);
    assert.equal(ANY_CONTROL_BYTE.test(url), false, `variant ${v} carried a control byte`);
    // and literally every code point is printable 7-bit ascii
    for (const ch of url) {
      const cp = ch.codePointAt(0);
      assert.ok(cp >= 0x20 && cp < 0x7f, `variant ${v} carried non-ascii U+${cp.toString(16)}`);
    }
  }
});

test("assembleShotUrl REFUSES a URL corrupted after assembly (the historical &c<0x18>)", () => {
  // Model the exact source-mangling: the "=" after "&c" became a 0x18 in the
  // path handed in. A broken <img src> must never mail — refuse it.
  const corruptRel = `${REL("new-mobile")}&c\x18351cb0662bff`;
  assert.equal(assembleShotUrl(BASE, corruptRel, ""), "");
  // A non-ascii byte anywhere is likewise refused.
  assert.equal(assembleShotUrl(BASE, `${REL("new")} `, SHA), "");
  // Sanity: the clean equivalent is accepted, so the guard is not a blanket "".
  assert.ok(assembleShotUrl(BASE, REL("new-mobile"), SHA));
  // Empty relative path -> "" (no base-only URL that resolves to nothing).
  assert.equal(assembleShotUrl(BASE, "", SHA), "");
});

test("both MIME halves carry no control bytes and every shot URL's c= is clean hex", () => {
  const email = composeOutreachEmailV3({
    businessName: "Family Heating & Air Conditioning",
    city: "Lawrenceville",
    previewUrl: "https://wss-test-family-heating-and-air-conditioning-lawren.wss-ai.com/",
    currentUrl: "https://familyheatingandair.example/",
    beforeImage: assembleShotUrl(BASE, REL("old"), SHA),
    afterImage: assembleShotUrl(BASE, REL("new"), SHA),
    mobileImage: assembleShotUrl(BASE, REL("new-mobile"), SHA),
    beforeMobileImage: assembleShotUrl(BASE, REL("old-mobile"), SHA),
    rating: "4.9",
    reviewCount: "212",
    postalAddress: "655 S Main St, Suite 200, Orange, CA 92868",
    unsubUrl: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=proof-token",
  });

  // Every preview-shot <img src> in the HTML, un-escaped back to a real URL.
  const shotUrls = [...email.html.matchAll(/src="([^"]*preview-shot[^"]*)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&#61;/g, "="));
  assert.ok(shotUrls.length >= 2, `expected proof-shot images in the HTML, got ${shotUrls.length}`);
  for (const u of shotUrls) {
    assert.match(u, /[?&]c=[0-9a-f]+/, `shot URL has no clean cache-bust: ${JSON.stringify(u)}`);
    assert.equal(ANY_CONTROL_BYTE.test(u), false, `shot URL carried a control byte: ${JSON.stringify(u)}`);
  }

  // Neither MIME half carries a stray control byte anywhere.
  assert.equal(CONTROL_BYTE.test(email.html), false, "HTML half carries a stray control byte");
  assert.equal(CONTROL_BYTE.test(email.text), false, "text half carries a stray control byte");
});
