"use strict";
// THE FACES THE SECTION MERGE WAS THROWING AWAY.
//
// mergeContentSources is first-non-empty per key, which is right for a review
// CORPUS and wrong for the photos inside it: whenever the resolver returned
// five faceless quotes, the stored contract's five quotes WITH real
// Google-served reviewer photos lost the whole key. Measured 2026-08-11 —
// eight of eight live mirrors whose contracts hold real faces rendered zero,
// and a fresh Cardinal Plumbing build reproduced it (contract 4 avatars in,
// request faces:0 out; after the fix, 3 restored and 6 <img> on the page).

const test = require("node:test");
const assert = require("node:assert");
const { restoreReviewFaces } = require("../lib/mirror-lane-build");

const FACE = "https://lh3.googleusercontent.com/a-/ALV-UjVf7E0x6SJLGt3bsUn5ZwG9S";
const TILE = "https://lh3.googleusercontent.com/a/ACg8ocKgeneratedletter";

test("a face is restored onto the same review seen twice", () => {
  const fresh = [{ text: "Fast and tidy work.", author: "Dana R." }];
  const contract = [{ text: "Fast and tidy work.", author: "Dana R.", avatarUrl: FACE }];
  const out = restoreReviewFaces(fresh, contract);
  assert.equal(out[0].avatarUrl, FACE);
  assert.equal(out[0].text, "Fast and tidy work.", "the words stay the fresher observation's");
});

test("whitespace and case differences do not block the match", () => {
  const fresh = [{ text: "Fast  and\ntidy work.", author: "dana r." }];
  const contract = [{ text: "Fast and tidy work.", author: "Dana R.", avatarUrl: FACE }];
  assert.equal(restoreReviewFaces(fresh, contract)[0].avatarUrl, FACE);
});

test("a DIFFERENT review never inherits somebody else's face", () => {
  // The worst defect this page could carry: a stranger's photo under a real
  // customer's words. Same author, different review, and different author with
  // the same words both refuse.
  const contract = [{ text: "Fast and tidy work.", author: "Dana R.", avatarUrl: FACE }];
  assert.equal(restoreReviewFaces([{ text: "Late twice.", author: "Dana R." }], contract)[0].avatarUrl, undefined);
  assert.equal(restoreReviewFaces([{ text: "Fast and tidy work.", author: "Sam T." }], contract)[0].avatarUrl, undefined);
});

test("an ambiguous key restores nothing", () => {
  const contract = [
    { text: "Great job.", author: "J", avatarUrl: FACE },
    { text: "Great job.", author: "J", avatarUrl: FACE.replace("UjV", "UjX") },
  ];
  assert.equal(restoreReviewFaces([{ text: "Great job.", author: "J" }], contract)[0].avatarUrl, undefined);
});

test("Google's generated initial tile is not a face", () => {
  const contract = [{ text: "Great job.", author: "J", avatarUrl: TILE }];
  assert.equal(restoreReviewFaces([{ text: "Great job.", author: "J" }], contract)[0].avatarUrl, undefined);
});

test("an avatar the fresh observation already has is never overwritten", () => {
  const fresh = [{ text: "Great job.", author: "J", avatarUrl: FACE }];
  const contract = [{ text: "Great job.", author: "J", avatarUrl: TILE.replace("ACg8oc", "ALV-Uj") }];
  assert.equal(restoreReviewFaces(fresh, contract)[0].avatarUrl, FACE);
});

test("no reviews, no contract, or no faces returns the input untouched", () => {
  assert.equal(restoreReviewFaces(undefined, [{ avatarUrl: FACE }]), undefined);
  const only = [{ text: "x", author: "y" }];
  assert.equal(restoreReviewFaces(only, []), only);
  assert.equal(restoreReviewFaces(only, [{ text: "x", author: "y" }]), only);
});
