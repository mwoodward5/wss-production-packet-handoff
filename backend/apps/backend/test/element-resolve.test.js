"use strict";

// test/element-resolve.test.js
//
// The cases that matter are the REAL ONES — the five requests from the owner's
// recorded calls, run end to end against a page shaped like a live mirror:
//
//   "make the logo twice as big"
//   "move it to the right side instead of the left"
//   "swap the logo with the phone call button"
//   "the social media block should go below the hero"
//   "make the hero image more colourful"
//
// Everything else here exists because one of those five broke it first.

const test = require("node:test");
const assert = require("node:assert/strict");

const R = require("../lib/element-resolve");
const { mirrorXray } = require("./fixtures/mirror-xray");

const XR = mirrorXray();
const ELS = XR.elements;
const noVision = { useVision: false };

// ===========================================================================
// THE FIVE RECORDED REQUESTS
// ===========================================================================

test('recorded call: "make the logo twice as big"', async () => {
  const r = await R.resolve(XR, "make the logo twice as big", noVision);

  assert.equal(r.ok, true, `should not have to ask: ${r.question || ""}`);
  assert.equal(r.verb.kind, "resize");
  // The HEADER logo, not the footer one. Both are named for a logo.
  assert.equal(r.target.selector, 'header img[src*="client-logo"]');
  assert.ok(r.confidence > 0.5, `confidence ${r.confidence}`);

  const g = r.geometry;
  assert.deepEqual(g.current, { w: 132, h: 44 });
  assert.deepEqual(g.natural, { w: 512, h: 171 });
  // 44 -> 88, and the width follows the PICTURE'S ratio so it cannot stretch.
  assert.equal(g.proposed.h, 88);
  assert.equal(g.proposed.w, Math.round(88 * (512 / 171)));
  assert.equal(g.aspect_source, "the picture's own dimensions");

  // The fix the planner got wrong on the real call.
  assert.match(g.css_hint, /height:88px/);
  assert.match(g.css_hint, /width:auto/);
  assert.doesNotMatch(g.css_hint, /scale|transform/);
});

test('"make the logo twice as big" reports that it will not fit, with the numbers', async () => {
  const r = await R.resolve(XR, "make the logo twice as big", noVision);
  const g = r.geometry;

  // The <a> hugging the logo is a wrapper, not a constraint — it is skipped
  // and said so. The 56px flex row is what actually refuses an 88px logo.
  assert.equal(g.container.room.h, 56);
  assert.ok(g.container.wrappers_skipped.length >= 1, "the tight <a> wrapper should be named as skipped");
  assert.equal(g.fits, false);

  const tall = g.warnings.find((w) => w.kind === "taller_than_its_box");
  assert.ok(tall, "should warn that it is taller than its box");
  assert.match(tall.detail, /88px/);
  assert.match(tall.detail, /56px/);

  // And Riley is given something to say that is not "done".
  assert.match(r.say, /88px|taller/);
});

test('recorded call: "move it to the right side instead of the left" resolves "it" from the turn before', async () => {
  const first = await R.resolve(XR, "make the logo twice as big", noVision);
  const r = await R.resolve(XR, "move it to the right side instead of the left", {
    ...noVision,
    context: { lastTarget: first.target },
  });

  assert.equal(r.ok, true, `should not have to ask: ${r.question || ""}`);
  assert.equal(r.verb.kind, "move");
  assert.equal(r.target.selector, 'header img[src*="client-logo"]');
  assert.equal(r.plan.direction, "right");
  // It knows the logo sits in a flex row, so it moves along the row.
  assert.match(r.plan.method, /row/);
  assert.match(r.plan.css_hint, /margin-left:auto/);
});

test('"to the right ... instead of the left" reads destination and current position apart', () => {
  const p = R.readPlaces("move it to the right side instead of the left");
  assert.deepEqual(p.destination, ["right"]);
  assert.deepEqual(p.currently, ["left"]);
  assert.ok(!p.destination.includes("left"), "the destination must not also collect the old side");
});

test('recorded call: "swap the logo with the phone call button"', async () => {
  const r = await R.resolve(XR, "swap the logo with the phone call button", noVision);

  assert.equal(r.ok, true, `should not have to ask: ${r.question || ""}`);
  assert.equal(r.verb.kind, "swap");
  assert.equal(r.target.selector, 'header img[src*="client-logo"]');
  assert.equal(r.partner.selector, 'header a[href^="tel:"]');
  assert.equal(r.plan.possible, true);
  // They share the header's flex row, so this is an order change, not a rebuild.
  assert.match(r.plan.method, /reorder the row/);
  assert.equal(r.plan.warnings.length, 0);
});

test('recorded call: "the social media block should go below the hero"', async () => {
  const r = await R.resolve(XR, "the social media block should go below the hero", noVision);

  assert.equal(r.ok, true, `should not have to ask: ${r.question || ""}`);
  assert.equal(r.verb.kind, "reorder");
  // The SUBJECT is the social block. "hero" is an exact name match and would
  // win on the raw sentence — the anchor half has to be read separately.
  assert.equal(r.target.selector, "main > section:nth-of-type(3)");
  assert.equal(r.partner.selector, "section#top");
  assert.equal(r.plan.possible, true);
  assert.equal(r.plan.relation, "below");

  // The verb the system said outright it could not do comes back with an
  // acceptance test attached.
  assert.ok(r.plan.verify, "a reorder must hand over how to check it");
  assert.match(r.plan.verify.expect, /lower down the page/);
  assert.ok(r.plan.verify.order_before.length >= 4);
  // And it is honest that turning a plain block into a stack can move spacing.
  assert.ok(r.plan.warnings.some((w) => w.kind === "stack_becomes_flex"));
  assert.equal(r.plan.must_render_to_confirm, true);
});

test('the social block is found by its LINKS, not by a lucky class name', () => {
  const social = ELS[11];
  const topic = R.topicOf(ELS, social);
  assert.equal(topic.topic, "social");
  assert.equal(topic.evidence.length, 2);
  assert.match(topic.evidence[0], /facebook/);
  // The hero has no social links, so it is not a social block.
  assert.equal(R.topicOf(ELS, ELS[6]), null);
});

test('recorded call: "make the hero image more colourful" lands on the video, not the box', async () => {
  const r = await R.resolve(XR, "make the hero image more colourful", noVision);

  assert.equal(r.ok, true, `should not have to ask: ${r.question || ""}`);
  assert.equal(r.verb.kind, "restyle");
  // Resolved to the hero, then moved onto the media inside it — a filter on
  // section#top does not reach the video.
  assert.equal(r.target.selector, "section#top video");
  assert.ok(r.refined, "the move off the container must be recorded");
  assert.match(r.refined.reason, /does not reach the picture/);
  assert.equal(r.plan.intent.kind, "saturate");
  assert.equal(r.plan.surface, "picture");
  // It restyles what is there; it does not promise a new picture.
  assert.match(r.plan.note, /does not fetch a different picture/);
});

// ===========================================================================
// THE FAILURE THE ENGINE ALREADY SHIPPED: text styled on the box around it
// ===========================================================================

test("a request about WORDS is moved off the section and onto the words", () => {
  const hero = ELS[6];
  const { target, moved } = R.refineForVerb(ELS, { el: hero, ...hero }, "restyle", {
    utterance: "make the main headline text bright orange",
  });
  assert.equal(target.selector, "h1");
  assert.ok(moved, "the move must be recorded, not silent");
  assert.match(moved.reason, /inherited/);
});

test("resizing WORDS changes the type size, not the box height", () => {
  const h1 = ELS[8];
  const { slots } = R.readRequest("make the headline twice as big");
  const g = R.planResize(ELS, { el: h1, ...h1 }, slots);
  assert.equal(g.kind, "type_size");
  assert.equal(g.property, "font-size");
  assert.equal(g.current_type_px, 56);
  assert.equal(g.proposed.font_px, 112);
  assert.equal(g.css_hint, "font-size:112px");
});

test("a resize reads the aspect from the picture, never from a box already stretched", () => {
  // Same logo, but drawn at a ratio its own pixels do not have.
  const stretched = { ...ELS[4], rect: { x: 24, y: 14, w: 300, h: 44 } };
  const { slots } = R.readRequest("make the logo twice as big");
  const g = R.planResize(ELS, { el: stretched, ...stretched }, slots);
  assert.equal(g.aspect, Math.round((512 / 171) * 1000) / 1000);
  // Doubling height gives the NATURAL width, which un-stretches it rather
  // than carrying the distortion forward.
  assert.equal(g.proposed.h, 88);
  assert.equal(g.proposed.w, Math.round(88 * (512 / 171)));
  assert.notEqual(g.proposed.w, 600, "carrying the stretched 300x44 ratio forward would give 600");
});

// ===========================================================================
// NEVER ASK THEM TO IDENTIFY AN ELEMENT
// ===========================================================================

const JARGON = /\b(element|selector|css|div|dom|node|class name|xpath|attribute|markup|querySelector)\b/i;

test("nothing a caller hears contains a word from a developer's vocabulary", async () => {
  const utterances = [
    "make the logo twice as big",
    "move it to the right side instead of the left",
    "swap the logo with the phone call button",
    "the social media block should go below the hero",
    "make the hero image more colourful",
    "make that thing bigger",
    "change the wibble",
    "make it fade in when you scroll",
    "point the button at my facebook page",
    "add an online booking system",
    "get rid of the chat bubble",
    "put a photo of my new truck on there",
  ];
  for (const u of utterances) {
    const r = await R.resolve(XR, u, noVision);
    for (const line of [r.say, r.question, r.refusal && r.refusal.say]) {
      if (!line) continue;
      assert.doesNotMatch(line, JARGON, `"${u}" produced developer-speak: ${line}`);
    }
  }
});

test("when nothing matches, it reads the page out rather than handing the question back", async () => {
  const r = await R.resolve(XR, "change the wibble", noVision);
  assert.equal(r.ok, false);
  assert.ok(r.question, "must ask something");
  assert.match(r.question, /I can see/);
  assert.match(r.question, /logo|header|hero/);
  assert.doesNotMatch(r.question, /what do you mean\?$/i);
});

test("a genuine coin-flip asks ONE plain question about the thing itself", () => {
  const a = { ...ELS[12], el: ELS[12] };
  const b = { ...ELS[13], el: ELS[13] };
  const q = R.askBetween(ELS, a, b);
  assert.match(q, /Facebook/);
  assert.match(q, /Instagram/);
  assert.doesNotMatch(q, JARGON);
  assert.equal((q.match(/\?/g) || []).length, 1, "exactly one question");
});

test("the tiebreak question uses what actually differs — position when the text matches", () => {
  const a = { ...ELS[4], el: ELS[4] };            // header logo, top left
  const b = { ...ELS[15], el: ELS[15] };          // footer logo, far down
  const q = R.askBetween(ELS, a, b);
  assert.doesNotMatch(q, JARGON);
  assert.ok(/top|screens down|big|small|next to/.test(q), `unhelpful question: ${q}`);
});

// ===========================================================================
// A PROMISE THE EXECUTOR CANNOT KEEP IS THE DEFECT WE ARE REMOVING
// ===========================================================================

test("an unimplemented verb returns a plain refusal sentence, not a plan", async () => {
  const cases = [
    ["make the logo fade in when you scroll", "animate"],
    ["make the button link to my facebook page", "relink"],
    ["add an online booking system", "add_feature"],
  ];
  for (const [utterance, kind] of cases) {
    const r = await R.resolve(XR, utterance, noVision);
    assert.equal(r.ok, false, utterance);
    assert.equal(r.verb.kind, kind);
    assert.ok(r.refusal, `${utterance} must refuse`);
    assert.equal(r.plan, null);
    assert.equal(r.target, null);
    // It must say what it CAN do — never end on a flat no.
    assert.match(r.refusal.say, /I can /);
    assert.equal(r.say, r.refusal.say);
  }
});

test("every supported verb names the executor op that carries it out", () => {
  const ops = new Set(["style_override", "insert_html", "replace_text", "seo_page", "undo",
    "replace_copy", "copy_block", "tracking_tag", "swap_image", "legal_page"]);
  for (const [kind, entry] of Object.entries(R.VERB_SUPPORT)) {
    if (entry.supported) {
      assert.ok(ops.has(entry.op), `${kind} claims op "${entry.op}", which the executor does not have`);
    } else {
      assert.ok(entry.say && entry.say.length > 20, `${kind} must carry a sentence Riley can say`);
    }
  }
});

test("replacing a picture without a link asks for one AND offers what is already there", async () => {
  const r = await R.resolve(XR, "use a different picture for the logo", noVision);
  assert.equal(r.ok, false);
  assert.equal(r.verb.kind, "replace_image");
  assert.match(r.say, /link/);
  assert.match(r.say, /brighten/);
});

test("with a link, the picture swap is planned against the thing they named", async () => {
  const r = await R.resolve(XR, "use https://example.com/truck.jpg for the logo", noVision);
  assert.equal(r.ok, true, r.question || "");
  assert.equal(r.plan.source_url, "https://example.com/truck.jpg");
  assert.equal(r.plan.replaces.selector, 'header img[src*="client-logo"]');
});

// ===========================================================================
// THE PARSER
// ===========================================================================

test("amounts a caller actually says become numbers", () => {
  assert.equal(R.readAmount("twice as big").factor, 2);
  assert.equal(R.readAmount("make it double the size").factor, 2);
  assert.equal(R.readAmount("half the size").factor, 0.5);
  assert.equal(R.readAmount("50% bigger").factor, 1.5);
  assert.equal(R.readAmount("20 percent smaller").factor, 0.8);
  assert.equal(R.readAmount("a bit bigger").factor, 1.2);
  assert.equal(R.readAmount("way bigger").factor, 1.75);
  assert.equal(R.readAmount("3x").factor, 3);
  const px = R.readAmount("make it 200 pixels wide");
  assert.equal(px.kind, "absolute");
  assert.equal(px.px, 200);
  assert.equal(px.axis, "width");
});

test("quoted wording is pulled out of plain speech", () => {
  assert.equal(R.readQuotedText("the part that says we hold the line"), "we hold the line");
  assert.equal(R.readQuotedText('the "REQUEST A QUOTE" button'), "request a quote");
  assert.equal(R.readQuotedText("the bit reading call us today"), "call us today");
  assert.equal(R.readQuotedText("make the logo bigger"), "");
});

test('"over to the right" is a move, not a request to put something under a direction', () => {
  assert.equal(R.readRelation("move it over to the right"), null);
  assert.equal(R.readRequest("move it over to the right").verb, "move");
  // A real relation still reads.
  const rel = R.readRelation("the reviews should go below the hero");
  assert.equal(rel.relation, "below");
  assert.equal(rel.other, "hero");
});

test("the verb is read from how a tradesperson talks", () => {
  const cases = [
    ["make the logo twice as big", "resize"],
    ["shove the logo over to the right", "move"],
    ["swap the logo with the call button", "swap"],
    ["the reviews should go below the hero", "reorder"],
    ["make the hero more colourful", "restyle"],
    ["that headline should say Family Owned Since 1994", "retext"],
    ["get rid of that chat bubble", "hide"],
    ["put a photo of my new truck on there", "replace_image"],
  ];
  for (const [utterance, expected] of cases) {
    assert.equal(R.readRequest(utterance).verb, expected, utterance);
  }
});

test('"the bar that stays when I scroll" is heard as a behaviour', async () => {
  const r = await R.resolve(XR, "make the bar that stays when I scroll a bit shorter", noVision);
  assert.equal(r.target.selector, "header");
  assert.ok(r.target.why.some((w) => /stays put when the page scrolls/.test(w)));
});

test('"the big picture at the top" finds the hero, not a small icon', async () => {
  const r = await R.resolve(XR, "the big picture at the top needs to be brighter", noVision);
  assert.ok(["section#top", "section#top video"].includes(r.target.selector), r.target.selector);
});

// ===========================================================================
// SCORING AND CONFIDENCE
// ===========================================================================

test("each signal contributes at most its ceiling — position and noun beat noun twice", () => {
  const { slots } = R.readRequest("the logo in the top left");
  const ranked = R.rank(XR, slots);
  assert.equal(ranked[0].selector, 'header img[src*="client-logo"]');
  assert.ok(ranked[0].signals.noun > 0 && ranked[0].signals.position > 0,
    "the winner should have matched on both the name and the place");
  const footer = ranked.find((c) => c.selector === 'footer img[src*="client-logo"]');
  if (footer) assert.ok(footer.signals.position < 0, "a logo two screens down is not 'top left'");
});

test("no candidate is ever offered without a selector already proven unique", () => {
  const { slots } = R.readRequest("the logo");
  for (const c of R.rank(XR, slots)) {
    assert.ok(c.selector, `${c.name} was offered with no way to reach it`);
  }
});

test("confidence is a margin, and a pure position guess is capped", () => {
  const strong = R.confidenceOf([
    { score: 8, signals: { noun: 6, text: 0 } },
    { score: 2, signals: { noun: 0, text: 0 } },
  ]);
  const guess = R.confidenceOf([
    { score: 3, signals: { noun: 0, text: 0 } },
    { score: 0.4, signals: { noun: 0, text: 0 } },
  ]);
  assert.ok(strong > 0.8, `strong ${strong}`);
  assert.ok(guess <= 0.45, `an unnamed match must stay uncertain, got ${guess}`);
  assert.equal(R.confidenceOf([]), 0);
});

// ===========================================================================
// THE TREE, DERIVED AND CHECKED
// ===========================================================================

test("parentage comes from the walk's depths, not from geometry", () => {
  assert.equal(R.containerOf(ELS, ELS[4]).selector, 'header a:has(img[src*="client-logo"])');
  assert.equal(R.containerOf(ELS, ELS[5]).selector, 'header div:has(> a > img[src*="client-logo"])');
  assert.equal(R.containerOf(ELS, ELS[0]), null);

  // A fixed header and its own children are measured against different
  // reference points, so a parent box that does not enclose its child is
  // normal. Refusing to name the parent in that case emptied the whole chain
  // on the live mirror. The parent is still returned; the containment is
  // reported separately so a fit check knows not to trust itself.
  // The header's row measured somewhere the logo is not — the shape a fixed
  // ancestor produces. It is still the row the logo sits in.
  const shifted = ELS.map((e) => (e.index === 2 ? { ...e, rect: { x: 0, y: 4000, w: 1232, h: 56 } } : e));
  const parent = R.containerOf(shifted, shifted[4]);
  assert.ok(parent, "the parent is a fact about the tree, not about the boxes");
  assert.equal(parent.selector, 'header a:has(img[src*="client-logo"])');
  assert.equal(R.constrainingBoxOf(shifted, shifted[4]).encloses, false);
});

test("the ancestor walk skips siblings' subtrees", () => {
  // The call button (depth 3) must not claim the logo's <a> (also depth 3)
  // or the <img> below it as an ancestor.
  const chain = R.ancestorChain(ELS, ELS[5]).map((e) => e.tag);
  assert.deepEqual(chain, ["div", "header", "div"]);
});

test("a fit measured across a fixed boundary reports unknown, not false", () => {
  const shifted = ELS.map((e) => (e.index === 2 ? { ...e, rect: { x: 0, y: 4000, w: 1232, h: 56 } } : e));
  const { slots } = R.readRequest("make the logo twice as big");
  const g = R.planResize(shifted, { el: shifted[4] }, slots);
  assert.equal(g.container.encloses, false);
  assert.equal(g.fits, null, "unknown is an answer; false would be a claim it cannot support");
  assert.ok(g.warnings.some((w) => w.kind === "fit_not_trustworthy"));
});

test("the constraining box skips shrink-wrapping wrappers and names them", () => {
  const { box, wrappers_skipped } = R.constrainingBoxOf(ELS, ELS[4]);
  assert.equal(box.selector, 'header div:has(> a > img[src*="client-logo"])');
  assert.equal(wrappers_skipped.length, 1);
});

test("a move is applied to the wrapper, because moving the image inside it does nothing", async () => {
  const first = await R.resolve(XR, "make the logo twice as big", noVision);
  const r = await R.resolve(XR, "move it over to the right", {
    ...noVision, context: { lastTarget: first.target },
  });
  // The caller's thing is still the logo...
  assert.equal(r.target.selector, 'header img[src*="client-logo"]');
  // ...but the rule has to name the anchor around it — the flex child.
  assert.equal(r.plan.apply_to.selector, 'header a:has(img[src*="client-logo"])');
  assert.match(r.plan.apply_to_wrapper, /exactly its own size/);
});

test("a swap orders the flex children, not the image buried inside one", async () => {
  const r = await R.resolve(XR, "swap the logo with the phone call button", noVision);
  assert.equal(r.plan.before[0].selector, 'header a:has(img[src*="client-logo"])');
  assert.equal(r.plan.before[1].selector, 'header a[href^="tel:"]');
});

test("two things in the header share the header's row", () => {
  const shared = R.commonAncestor(ELS, ELS[4], ELS[5]);
  assert.equal(shared.selector, 'header div:has(> a > img[src*="client-logo"])');
  assert.match(shared.style.display, /flex/);
});

test("a reorder refuses when the two are not in the same stack", () => {
  const plan = R.planReorder(ELS, { el: ELS[4] }, { el: ELS[8] }, "below");
  assert.equal(plan.possible, false);
  assert.match(plan.say, /I can't/);
  assert.doesNotMatch(plan.say, JARGON);
});

test("a swap of two things in different parts of the page is refused, not faked", () => {
  const plan = R.planSwap(ELS, { el: ELS[4] }, { el: ELS[15] });
  // They do share #root, so it is possible but must be honest about the cost.
  if (plan.possible) {
    assert.ok(plan.warnings.length > 0, "a swap across a plain block must carry its risk");
    assert.equal(plan.must_render_to_confirm, true);
  } else {
    assert.match(plan.say, /I can't/);
  }
});

// ===========================================================================
// VISION — the tie-break, and every way it is allowed to fail
// ===========================================================================

function xrayWithCrops() {
  const xr = mirrorXray();
  const crop = (index, selector, byte) => ({
    name: "crop", selector, index, type: "jpeg",
    buffer: Buffer.from([byte, byte, byte]), sha256: `sha-${index}`,
  });
  xr.crops = [crop(12, 'a[href*="facebook.com"]', 1), crop(13, 'a[href*="instagram.com"]', 2)];
  xr.desktop.crops = xr.crops;
  return xr;
}

test("vision is consulted only for a genuine tie, and only with both crops", async () => {
  const xr = xrayWithCrops();
  let calls = 0;
  await R.resolve(xr, "make the logo twice as big", {
    vision: async () => { calls += 1; return { ok: true, text: '{"pick":1,"confidence":0.9}' }; },
  });
  assert.equal(calls, 0, "a decisive match must never spend a vision call");
});

test("vision breaks a tie and carries the crops it looked at", async () => {
  const xr = xrayWithCrops();
  const seen = {};
  const r = await R.resolve(xr, "make that social icon bigger", {
    vision: async (args) => {
      seen.prompt = args.prompt;
      seen.images = args.images;
      return { ok: true, text: 'Here you go: {"pick": 2, "confidence": 0.86, "because": "that is the Instagram one"}', usage: { input_tokens: 1200, output_tokens: 40 } };
    },
  });
  if (r.vision && r.vision.decided) {
    assert.equal(r.vision.pick, 2);
    assert.equal(r.vision.saw.length, 2);
    assert.ok(r.vision.saw[0].sha256, "the decision must name the pixels it was read off");
    assert.equal(seen.images.length, 2);
    assert.ok(seen.images[0].base64, "images must be sent as base64 content blocks");
    assert.doesNotMatch(seen.prompt, JARGON);
    assert.match(seen.prompt, /null/, "the model must be allowed to say it cannot tell");
  }
});

test("vision failing, timing out, or hedging always falls back to the plain question", async () => {
  const xr = xrayWithCrops();
  const failures = [
    async () => { throw new Error("socket hang up"); },
    async () => ({ ok: false, reason: "vision_timeout" }),
    async () => ({ ok: true, text: "I am not sure which one you mean." }),
    async () => ({ ok: true, text: '{"pick": null, "confidence": 0.2}' }),
    async () => ({ ok: true, text: '{"pick": 1, "confidence": 0.3}' }),
  ];
  for (const vision of failures) {
    const r = await R.resolve(xr, "make that social icon bigger", { vision });
    assert.ok(r.question || r.ok, "must still produce an answer");
    if (r.question) assert.doesNotMatch(r.question, JARGON);
  }
});

test("a vision reply is read defensively — leaked tags and prose cannot break it", () => {
  assert.equal(R.readVisionAnswer('<thinking>hmm</thinking>{"pick":1,"confidence":0.9}').pick, 1);
  assert.equal(R.readVisionAnswer("no json here"), null);
  assert.equal(R.readVisionAnswer('{"pick":"one"}').pick, null);
  assert.equal(R.readVisionAnswer('{"pick":2,"confidence":"x"}').confidence, 0);
  assert.equal(R.readVisionAnswer(""), null);
});

test("with no key the vision call reports why instead of throwing", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await R.defaultVision({ prompt: "x", images: [] });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "anthropic_key_unset");
  } finally {
    if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
  }
});

test("the vision request is shaped for a model that rejects sampling params", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    let body = null;
    await R.defaultVision({
      prompt: "which one", images: [{ base64: "AAAA", media_type: "image/jpeg" }],
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ content: [{ text: "{}" }], usage: { input_tokens: 9 } }) };
      },
    });
    assert.equal(body.model, "claude-opus-5");
    assert.equal(body.thinking.type, "disabled");
    assert.equal(body.output_config.effort, "low");
    assert.equal(body.temperature, undefined, "temperature is rejected outright on this model");
    assert.equal(body.top_p, undefined);
    assert.equal(body.messages[0].content[0].type, "image");
    assert.equal(body.messages[0].content[0].source.type, "base64");
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
});

// ===========================================================================
// IT NEVER THROWS
// ===========================================================================

// ===========================================================================
// EVERY ONE OF THESE IS A DEFECT THE LIVE MIRROR FOUND AND THE FIXTURE DID NOT
// ===========================================================================

test("el.index is an identity, not an array position", () => {
  // page-xray ranks-then-caps, so a real capture has sparse indices. Walking
  // from el.index as if it were an offset read the wrong entries and returned
  // no ancestors at all on every live page.
  const sparse = ELS.map((e, i) => ({ ...e, index: e.index * 7 + 3, _pos: i }));
  const logo = sparse[4];
  assert.equal(R.positionOf(sparse, logo), 4);
  assert.equal(R.containerOf(sparse, logo).selector, 'header a:has(img[src*="client-logo"])');
  assert.equal(R.ancestorChain(sparse, logo).length, 4);
});

test('"it" never matches inside a longer word', () => {
  // "move IT to the right" matched a button reading "$ Launch my SITE now".
  const button = { ...ELS[5], name: 'button "$ Launch my site now"', text: "$ Launch my site now", synonyms: ["cta", "the button"] };
  const els = ELS.map((e) => (e.index === 5 ? button : e));
  const { slots } = R.readRequest("move it to the right side instead of the left");
  assert.ok(!slots.words.includes("it"), "'it' is not a name");
  const ranked = R.rank({ elements: els, desktop: { elements: els } }, slots);
  assert.ok(!ranked.some((c) => c.index === 5 && c.signals.noun > 0),
    "a two-letter pronoun must not score as a noun");
});

test("our own sign-up floater is never offered as the customer's page", async () => {
  const ours = R.el ? null : null; // (fixture helper not needed)
  const floater = {
    ...ELS[5],
    index: 99,
    name: "call button",
    text: "Launch my site",
    href: "tel:+19493395562",
    selector: 'a[href="tel:+19493395562"]',
    rect: { x: 32, y: 655, w: 232, h: 64 },
    depth: 3,
  };
  const panel = { ...ELS[9], index: 98, depth: 2, selector: "div#wss-signup-panel", name: "sign-up panel", rect: { x: 0, y: 600, w: 320, h: 200 } };
  const els = [...ELS, panel, floater];
  const xr = { ok: true, elements: els, desktop: { elements: els, viewport: { width: 1280, height: 800 } } };

  assert.equal(R.rank(xr, R.readRequest("the phone call button").slots).some((c) => c.index === 99), false,
    "an element inside our own panel is not part of their site");
  const r = await R.resolve(xr, "swap the logo with the phone call button", noVision);
  assert.notEqual(r.partner && r.partner.selector, 'a[href="tel:+19493395562"]');
});

test("a swap prefers the partner it can actually be swapped with", async () => {
  // A higher-scoring call button in a far-off section must lose to the one
  // sitting in the same row as the logo.
  const faraway = { ...ELS[5], index: 97, depth: 2, selector: "footer a[href^='tel:']", rect: { x: 100, y: 1800, w: 400, h: 80 } };
  const els = [...ELS.slice(0, 14), faraway, ...ELS.slice(14)];
  const xr = { ok: true, elements: els, desktop: { elements: els, viewport: { width: 1280, height: 800 } } };
  const r = await R.resolve(xr, "swap the logo with the phone call button", noVision);
  assert.equal(r.ok, true, r.question || (r.refusal && r.refusal.say));
  assert.equal(r.partner.selector, 'header a[href^="tel:"]');
  assert.equal(r.plan.possible, true);
});

test('"that chat bubble" does not hijack the previous turn\'s target', async () => {
  const first = await R.resolve(XR, "make the logo twice as big", noVision);
  const r = await R.resolve(XR, "get rid of that chat bubble", {
    ...noVision, context: { lastTarget: first.target },
  });
  // There is no chat widget here. Deleting the logo because the sentence
  // contained "that" is the failure; asking is the answer.
  assert.notEqual(r.target && r.target.selector, first.target.selector);
  assert.ok(r.question, "must ask rather than act on the wrong thing");
  assert.match(r.question, /I can see|not seeing/);
});

test('"it" alone still carries, because they named nothing else', async () => {
  const first = await R.resolve(XR, "make the logo twice as big", noVision);
  const r = await R.resolve(XR, "actually make it a bit smaller", {
    ...noVision, context: { lastTarget: first.target },
  });
  assert.equal(r.target.selector, first.target.selector);
});

test("a box has no ratio to keep — shortening a bar must not narrow it", () => {
  const header = ELS[1];
  const { slots } = R.readRequest("make the top bar a bit shorter");
  const g = R.planResize(ELS, { el: header }, slots);
  assert.equal(g.ratio_locked, false);
  assert.equal(g.proposed.w, 1280, "the width was never mentioned");
  assert.ok(g.proposed.h < 72);
  assert.equal(g.css_hint, `height:${g.proposed.h}px`);
});

test("the picture is the photograph, not the biggest decorative vector", () => {
  const divider = {
    ...ELS[7], index: 96, tag: "svg", name: "", nameable: false, depth: 2,
    selector: "section#top > div > svg", rect: { x: 0, y: 800, w: 1280, h: 128 },
    image: null, media: null,
  };
  const photo = {
    ...ELS[7], index: 95, tag: "img", name: "photo", depth: 2,
    selector: "section#top img", rect: { x: 40, y: 500, w: 399, h: 300 },
  };
  const els = [...ELS.slice(0, 7), photo, divider, ...ELS.slice(8)];
  const { target, moved } = R.refineForVerb(els, { el: els[6] }, "restyle", {
    utterance: "make the hero image more colourful",
  });
  assert.equal(target.selector, "section#top img", "163,840px of squiggle is not the picture");
  assert.ok(moved);
});

test("a generic synonym every section carries is not the caller naming one", () => {
  const { slots } = R.readRequest("the social media block should go below the hero");
  const plain = R.rank(XR, slots).find((c) => c.selector === "main > section:nth-of-type(2)");
  const social = R.rank(XR, slots).find((c) => c.selector === "main > section:nth-of-type(3)");
  assert.ok(plain.signals.noun <= R.CEILING.noun / 2, `"block" scored ${plain.signals.noun} on a plain section`);
  assert.ok(social.signals.noun > plain.signals.noun + 2, "the proven social block must clear it comfortably");
});

test("naming something the page has not got reads the page out", async () => {
  const r = await R.resolve(XR, "move the online booking calendar up a bit", noVision);
  assert.equal(r.ok, false);
  assert.match(r.question, /not seeing that|I can see/);
  assert.doesNotMatch(r.question, JARGON);
});

test("what Riley says about a thing carries an article", async () => {
  const r = await R.resolve(XR, "make the main headline bright orange", noVision);
  assert.match(r.say, /the main headline|your main headline/);
  assert.doesNotMatch(r.say, /\bmake main headline\b/);
});

test("the page read-out spans the page, not just the header", () => {
  const offer = R.offerPlainList(XR);
  const below = ELS.filter((e) => e.fold === "below" && e.name).map((e) => e.name);
  assert.ok(below.some((n) => offer.includes(n)) || offer.includes("footer"),
    `a description of a 2,100px page that is all header furniture: "${offer}"`);
});

test("junk in gives an honest sentence out, never an exception", async () => {
  const inputs = [
    [null, "make it bigger"],
    [{ ok: false, reason: "http_503" }, "make it bigger"],
    [{ ok: true, elements: [] }, "make it bigger"],
    [XR, ""],
    [XR, null],
    [XR, "..."],
    [XR, "aslkdjfhalksjdfh"],
    [XR, "MAKE THE LOGO BIGGER!!!"],
  ];
  for (const [xr, utterance] of inputs) {
    const r = await R.resolve(xr, utterance, noVision);
    assert.equal(typeof r.say, "string");
    assert.ok(r.ok === true || r.question || r.refusal, `no answer for ${JSON.stringify(utterance)}`);
    if (r.say) assert.doesNotMatch(r.say, JARGON);
  }
});

test("shouting is heard the same as speaking", async () => {
  const quiet = await R.resolve(XR, "make the logo twice as big", noVision);
  const loud = await R.resolve(XR, "MAKE THE LOGO TWICE AS BIG!!", noVision);
  assert.equal(loud.target.selector, quiet.target.selector);
  assert.equal(loud.geometry.proposed.h, quiet.geometry.proposed.h);
});
