"use strict";

// Adversarial contract for the allowed Asset Studio paths:
// verified raw photo -> optional standalone Image Editor remaster -> exact byte upload
// -> horizontal Animation Creator -> human approval -> verified MP4.  Every
// test is local; none opens a browser or calls Google.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const runner = require("../scripts/ads-station/animate-image-runner.cjs");

function createMediaCapture(page, options = {}) {
  return runner.createMediaCapture(page, {
    ...options,
    armGeneratedMediaBaselineImpl: options.armGeneratedMediaBaselineImpl || (async (control) => {
      const result = await control.evaluate(() => null);
      if (result === true) return { ok: true, panelId: "step-three", baselineSources: [] };
      return result?.ok === true ? result : { ok: true, ...result };
    }),
  });
}

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, "ascii");
  payload.copy(out, 8);
  return out;
}

function fourSecondMp4() {
  const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary"));
  const mvhd = Buffer.alloc(24);
  // version/flags + creation + modification + timescale + duration
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(4000, 16);
  return Buffer.concat([ftyp, box("moov", box("mvhd", mvhd))]);
}

function validHeroMp4({ seconds = 4, width = 1920, height = 1080 } = {}) {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1"));
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE(Math.round(width * 65536), 16);
  tkhd.writeUInt32BE(Math.round(height * 65536), 20);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, "ascii");
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box("stsd", Buffer.concat([stsdHead, box("avc1", Buffer.alloc(8))]));
  const minf = box("minf", box("stbl", stsd));
  const mdia = box("mdia", Buffer.concat([box("hdlr", hdlr), minf]));
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), mdia]));
  return Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([box("mvhd", mvhd), trak])),
    box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}

function jpegWithDimensions(width, height, size = 2048) {
  const bytes = Buffer.alloc(size, 0x33);
  bytes[0] = 0xff; bytes[1] = 0xd8;
  bytes[2] = 0xff; bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

test("the remaster is a standalone first stage, and every later stage is awaited in order", async () => {
  assert.deepEqual(runner.WORKFLOW_STAGES, [
    "edit_raw_image",
    "save_optimized_asset",
    "select_exact_optimized_asset",
    "create_enhanced_variants",
    "select_horizontal_1_91",
    "animate_clip",
    "require_human_review",
  ]);

  const calls = [];
  let inFlight = false;
  const handlers = Object.fromEntries(runner.WORKFLOW_STAGES.map((stage) => [stage, async () => {
    assert.equal(inFlight, false, `${stage} began before the previous stage settled`);
    inFlight = true;
    await new Promise((resolve) => setImmediate(resolve));
    calls.push(stage);
    inFlight = false;
    return { ok: true, stage };
  }]));
  const out = await runner.runOrderedStages(handlers);
  assert.equal(out.ok, true);
  assert.deepEqual(calls, runner.WORKFLOW_STAGES);
});

test("wizard source binding tolerates Google's observed 45-second upload latency", () => {
  assert.equal(runner.WIZARD_SOURCE_BIND_TIMEOUT_MS, 90000);
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/ads-station/animate-image-runner.cjs"),
    "utf8",
  );
  assert.match(
    source,
    /async function waitForBoundWizardSource[\s\S]*?timeoutMs = WIZARD_SOURCE_BIND_TIMEOUT_MS/,
  );
});

test("source binding evidence survives both handlers, the manifest, and terminal verdicts", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/ads-station/animate-image-runner.cjs"),
    "utf8",
  );
  assert.equal(
    (source.match(/if \(selected\.ok\) state\.sourceBinding = selected\.sourceBinding;/g) || []).length,
    2,
  );
  assert.match(source, /source:\s*\{[\s\S]*?binding: state\.sourceBinding,/);
  assert.match(source, /sourceBinding: workflow\.sourceBinding \|\| state\.sourceBinding \|\| undefined/);
  assert.match(source, /sourceUploadControlRung: state\.sourceUploadControlRung,\s*sourceBinding: state\.sourceBinding,/);
});

test("a stalled Google image body cannot overrun the source-binding deadline", async () => {
  let responseHandler = null;
  let removed = false;
  const page = {
    on(event, callback) { if (event === "response") responseHandler = callback; },
    off(event, callback) { if (event === "response" && callback === responseHandler) removed = true; },
  };
  const capture = runner.createImageResponseCapture(page);
  capture.arm();
  responseHandler({
    url: () => "https://tpc.googlesyndication.com/simgad/hung-source",
    headers: () => ({ "content-type": "image/jpeg" }),
    body: () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  assert.deepEqual(await capture.snapshot({ timeoutMs: 5 }), []);
  assert.ok(Date.now() - startedAt < 250, "hung response body escaped its bounded snapshot");
  capture.stop();
  assert.equal(removed, true);
});

test("direct client photos skip Image Editor but keep enhancement, horizontal crop, animation, and review", async () => {
  assert.deepEqual(runner.DIRECT_WORKFLOW_STAGES, [
    "select_exact_source_asset",
    "create_enhanced_variants",
    "select_horizontal_1_91",
    "animate_clip",
    "require_human_review",
  ]);
  const calls = [];
  const handlers = Object.fromEntries(runner.DIRECT_WORKFLOW_STAGES.map((stage) => [stage, async () => {
    calls.push(stage);
    return { ok: true };
  }]));
  assert.equal((await runner.runOrderedStages(handlers, runner.DIRECT_WORKFLOW_STAGES)).ok, true);
  assert.deepEqual(calls, runner.DIRECT_WORKFLOW_STAGES);
  assert.equal(calls.includes("edit_raw_image"), false);
  assert.equal(calls.includes("save_optimized_asset"), false);
  assert.equal(runner.imagePreparationMode(undefined), "image_editor_remaster");
  assert.equal(runner.imagePreparationMode("image_editor"), "image_editor_remaster");
  assert.equal(runner.imagePreparationMode("direct_client_photo"), "direct_client_photo");
  assert.equal(runner.imagePreparationMode("guess"), null);
});

test("the Image Editor prompt improves quality without changing client truth", () => {
  const prompt = String(runner.REMASTER_PROMPT || "");
  assert.match(prompt, /professional commercial quality/i);
  assert.match(prompt, /sharpen/i);
  assert.match(prompt, /exposure/i);
  assert.match(prompt, /white balance/i);
  assert.match(prompt, /reduce noise/i);
  assert.match(prompt, /exact same scene/i);
  assert.match(prompt, /add nothing/i);
  assert.match(prompt, /remove nothing/i);
  assert.match(prompt, /no text/i);
  assert.match(prompt, /logos/i);
  assert.match(prompt, /people/i);
  assert.match(prompt, /watermarks/i);
});

test("the exact remaster prompt is read back from the form value before Generate", async () => {
  let fieldValue = "";
  const promptInput = {
    async fill(value) { fieldValue = value; },
    async inputValue() { return fieldValue; },
  };
  assert.equal(await runner.applyRemasterPrompt(promptInput), true);
  assert.equal(fieldValue, runner.REMASTER_PROMPT);

  const swallowedFill = {
    async fill() {},
    async inputValue() { return ""; },
  };
  assert.equal(await runner.applyRemasterPrompt(swallowedFill), false);
});

test("a synchronous lifecycle-arm throw removes its temporary prompt handle", async () => {
  const priorWindow = globalThis.window;
  globalThis.window = {};
  const promptElement = { isConnected: true };
  const promptInput = {
    async evaluate(callback) { return callback(promptElement); },
  };
  const generate = {
    evaluate() { throw new Error("evaluate failed before callback"); },
  };
  try {
    assert.deepEqual(await runner.armOptimizedImageLifecycle(promptInput, generate), []);
    assert.equal(Object.hasOwn(globalThis.window, "__wssAdsRemasterPromptElement"), false);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test("the click-epoch lifecycle reducer rejects reparenting, unrelated cards, and pre-click events", () => {
  const baseline = [{
    nodeId: "baseline-image",
    src: "https://googleusercontent.com/raw.jpg",
    srcset: "",
    naturalWidth: 1200,
    naturalHeight: 675,
  }];
  const event = (overrides = {}) => ({
    activeEpoch: 1,
    owned: true,
    insertedEpoch: 0,
    sourceMutatedEpoch: 0,
    loadedEpoch: 0,
    ...overrides,
  });

  assert.equal(runner.imageLifecycleChangedFromBaseline(baseline, {
    ...baseline[0],
    lifecycle: event({ insertedEpoch: 1 }),
  }), false, "reparenting a baseline node is never a new result");
  assert.equal(runner.imageLifecycleChangedFromBaseline(baseline, {
    nodeId: "unrelated-angular-card",
    className: "mat-mdc-card ng-star-inserted",
    lifecycle: event({ owned: false, insertedEpoch: 1 }),
  }), false, "a new card outside the owned preview is unrelated");
  assert.equal(runner.imageLifecycleChangedFromBaseline(baseline, {
    nodeId: "owned-new-result",
    className: "mat-mdc-card ng-star-inserted",
    lifecycle: event({ insertedEpoch: 1 }),
  }), true, "a truly new owned image inserted in the click epoch is a lifecycle result");
  assert.equal(runner.imageLifecycleChangedFromBaseline(baseline, {
    ...baseline[0],
    naturalWidth: 1600,
    naturalHeight: 900,
    lifecycle: event({ activeEpoch: 0, sourceMutatedEpoch: 1, loadedEpoch: 1 }),
  }), false, "pre-click mutation/load and dimension drift are not click evidence");
});

test("a generic Angular result card passes only with post-click lifecycle and changed bound bytes", async () => {
  const sourceUrl = "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=dom";
  const rawSha256 = "a".repeat(64);
  const bytes = Buffer.alloc(20000, 0x5a);
  Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
  const changedSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const baseline = [{
    nodeId: "image-7",
    src: sourceUrl,
    srcset: "",
    naturalWidth: 1200,
    naturalHeight: 675,
  }];
  const liveAngularCardImage = {
    index: 7,
    nodeId: "image-7",
    className: "mat-mdc-card-image ng-star-inserted",
    src: sourceUrl,
    srcset: "",
    naturalWidth: 1200,
    naturalHeight: 675,
    lifecycle: {
      activeEpoch: 1,
      owned: true,
      insertedEpoch: 0,
      sourceMutatedEpoch: 0,
      loadedEpoch: 1,
    },
  };
  const response = { url: sourceUrl, sha256: changedSha256, bytes };
  const accepted = await runner.responseBackedOptimizedImageAssessment(
    null,
    liveAngularCardImage,
    rawSha256,
    [response],
    baseline,
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.sha256, changedSha256);

  const rawBytes = Buffer.alloc(20000, 0x44);
  Buffer.from([0xff, 0xd8, 0xff]).copy(rawBytes);
  const actualRawSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");
  const mixedRawAndChanged = await runner.responseBackedOptimizedImageAssessment(
    null,
    liveAngularCardImage,
    actualRawSha256,
    [response, { url: sourceUrl, sha256: actualRawSha256, bytes: rawBytes }],
    baseline,
  );
  assert.deepEqual(mixedRawAndChanged, { ok: false, reason: "optimized_image_not_captured" });

  const stale = await runner.responseBackedOptimizedImageAssessment(
    null,
    {
      ...liveAngularCardImage,
      className: "mat-mdc-card-image ng-star-inserted generated-result",
      lifecycle: {
        activeEpoch: 1,
        owned: true,
        insertedEpoch: 0,
        sourceMutatedEpoch: 0,
        loadedEpoch: 0,
      },
    },
    rawSha256,
    [response],
    baseline,
  );
  assert.deepEqual(stale, { ok: false, reason: "optimized_image_dom_result_state_missing" });
});

test("the optimized asset must match the exact saved identity, never a near-name or tour card", () => {
  const exact = "https://lh3.googleusercontent.com/asset/client-remaster.png?id=abc123";
  const near = "https://lh3.googleusercontent.com/asset/client-remaster.png?id=abc124";
  assert.equal(runner.urlFingerprint(exact), runner.urlFingerprint(exact));
  assert.notEqual(runner.urlFingerprint(exact), runner.urlFingerprint(near));

  for (const url of [
    "https://www.gstatic.com/ads/asset-studio/tour-animation.mp4",
    "https://ads.google.com/tutorial/animation-creator.webm",
    "https://googleads.g.doubleclick.net/help/promo.mp4",
  ]) assert.equal(runner.isDeniedMediaUrl(url), true, `tour/promo media rode: ${url}`);
});

test("blank jobs reuse only safe account scope from an authenticated Ads tab", () => {
  const pages = [
    { url: () => "https://ads.google.com.evil.example/aw/assetstudio?ocid=666&authuser=0" },
    { url: () => "https://ads.google.com/nav/selectaccount?ocid=777&authuser=0" },
    { url: () => "https://ads.google.com/aw/assetstudio?returnTo=%2Fsteal&ocid=8474175002&euid=153501802&__u=2096639898&uscid=8474175002&__c=1074186698&authuser=0&session=secret" },
  ];

  const discovered = runner.resolveAdsParams("", pages);
  assert.equal(
    discovered,
    "ocid=8474175002&euid=153501802&__u=2096639898&uscid=8474175002&__c=1074186698&authuser=0",
  );
  assert.equal(new URLSearchParams(discovered).has("returnTo"), false);
  assert.equal(new URLSearchParams(discovered).has("session"), false);
  assert.equal(runner.safeAdsAccountParamsFromUrl(pages[0].url()), "");
  assert.equal(runner.safeAdsAccountParamsFromUrl(pages[1].url()), "");
  assert.equal(runner.resolveAdsParams("   ", pages), discovered, "whitespace-only job params are blank");

  const explicit = "ocid=123&authuser=4&returnTo=explicit-owner-config";
  assert.equal(runner.resolveAdsParams(`?${explicit}`, pages), explicit, "explicit job params must win");
});

test("the editor refuses account selection, wrong accounts, and stripped account scope", () => {
  const params = "ocid=8474175002&euid=153501802&__u=2096639898&uscid=8474175002&__c=1074186698&authuser=0";
  assert.deepEqual(runner.adsEditorScopeAssessment(runner.imageEditorUrl(params), params), { ok: true });
  assert.deepEqual(
    runner.adsEditorScopeAssessment(`https://ads.google.com/nav/selectaccount?${params}`, params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://ads.google.com/aw/imageeditor/main?ocid=999&uscid=999&authuser=0", params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://ads.google.com/aw/imageeditor/main?ocid=8474175002&uscid=999&authuser=0", params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://ads.google.com/aw/imageeditor/main?ocid=999&uscid=8474175002&authuser=0", params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://ads.google.com/aw/imageeditor/main?ocid=8474175002&ocid=999&uscid=8474175002&authuser=0", params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://ads.google.com/aw/imageeditor/main", params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsEditorScopeAssessment("https://accounts.google.com/signin", params),
    { ok: false, reason: "ads_editor_route_not_confirmed" },
  );
});

test("generic Start here can never be clicked on either Google Ads screen", () => {
  assert.equal(runner.isClickWhitelisted("Start here"), false);
  assert.equal(runner.isClickWhitelisted("Choose image to edit"), true, "the exact safe redundancy remains");
});

test("the wizard is account-scoped exactly like the editor", () => {
  const params = "ocid=8474175002&euid=153501802&__u=2096639898&uscid=8474175002&__c=1074186698&authuser=0";
  assert.deepEqual(runner.adsWizardScopeAssessment(runner.wizardUrl(params), params), { ok: true });
  assert.deepEqual(
    runner.adsWizardScopeAssessment(runner.imageEditorUrl(params), params),
    { ok: false, reason: "ads_wizard_route_not_confirmed" },
  );
  assert.deepEqual(
    runner.adsWizardScopeAssessment(`https://ads.google.com/nav/selectaccount?${params}`, params),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
});

test("the current editor input is preferred and delayed Angular mounting is awaited", async () => {
  let directChecks = 0;
  let waits = 0;
  const handle = { async evaluate() { return true; } };
  const scoped = {
    async count() { return 0; },
    first() { return this; },
    async elementHandle() { return null; },
  };
  const direct = {
    async count() { directChecks += 1; return directChecks >= 3 ? 1 : 0; },
    first() { return this; },
    async elementHandle() { return handle; },
  };
  const picker = { locator() { return scoped; } };
  const page = {
    getByRole() { return { first() { return picker; } }; },
    locator() { return direct; },
  };
  const found = await runner.waitForEditorUploadInput(page, {
    attempts: 4,
    pollMs: 0,
    async sleepImpl() { waits += 1; },
  });
  assert.deepEqual(found, { ok: true, input: handle });
  assert.equal(directChecks, 3);
  assert.equal(waits, 2);
});

test("a picker-scoped file input wins without clicking any page-wide Upload control", async () => {
  const handle = { async evaluate() { return true; } };
  const scoped = {
    async count() { return 1; },
    first() { return this; },
    async elementHandle() { return handle; },
  };
  let globalLookups = 0;
  const page = {
    getByRole() { return { first() { return { locator() { return scoped; } }; } }; },
    locator() { globalLookups += 1; throw new Error("global lookup must not run"); },
  };
  assert.deepEqual(await runner.waitForEditorUploadInput(page, { attempts: 1 }), { ok: true, input: handle });
  assert.equal(globalLookups, 0);
});

test("ambiguous or detached upload inputs fail closed", async () => {
  const none = { async count() { return 0; }, first() { return this; }, async elementHandle() { return null; } };
  const many = { async count() { return 2; }, first() { return this; }, async elementHandle() { throw new Error("must not bind"); } };
  const page = {
    getByRole() { return { first() { return { locator() { return none; } }; } }; },
    locator() { return many; },
  };
  assert.deepEqual(
    await runner.waitForEditorUploadInput(page, { attempts: 1 }),
    { ok: false, reason: "image_editor_upload_input_ambiguous" },
  );
  let check = 0;
  const replacedHandle = { async evaluate() { check += 1; return check === 1; } };
  assert.equal(await runner.editorUploadHandleIsUsable(replacedHandle), true);
  assert.equal(await runner.editorUploadHandleIsUsable(replacedHandle), false, "a replaced node cannot be uploaded later");
});

test("Generate refuses an account change after control discovery and cleans capture state", async () => {
  const params = "ocid=8474175002&euid=153501802&__u=2096639898&uscid=8474175002&__c=1074186698&authuser=0";
  let clicks = 0;
  let cleanups = 0;
  let currentUrl = runner.imageEditorUrl(params);
  const boundGenerate = {
    async click() { clicks += 1; },
    async evaluate() {
      currentUrl = "https://ads.google.com/aw/imageeditor/main?ocid=999&uscid=999&authuser=0";
      return true;
    },
  };
  const page = {
    url() { return currentUrl; },
  };
  assert.deepEqual(
    await runner.clickScopedEditorControl(page, boundGenerate, "generate", params, {
      async onRefuse() { cleanups += 1; },
    }),
    { ok: false, reason: "ads_account_scope_not_confirmed" },
  );
  assert.equal(clicks, 0, "a fixed control from the old account must never be clicked");
  assert.equal(cleanups, 1, "response capture and DOM lifecycle must be disarmed");

  let detachedClicks = 0;
  let detachedCleanups = 0;
  const detachedGenerate = {
    async click() { detachedClicks += 1; },
    async evaluate() { return false; },
  };
  assert.deepEqual(
    await runner.clickScopedEditorControl(
      { url() { return runner.imageEditorUrl(params); } },
      detachedGenerate,
      "generate",
      params,
      { async onRefuse() { detachedCleanups += 1; } },
    ),
    { ok: false, reason: "image_editor_control_detached" },
  );
  assert.equal(detachedClicks, 0);
  assert.equal(detachedCleanups, 1);
});

function saveAndCloseDialogHarness(snapshots, { overlayFlavor = "cdk" } = {}) {
  const states = Array.isArray(snapshots) && snapshots.length ? snapshots : [[]];
  let stateIndex = 0;
  const handleByElement = new Map();
  const makeNode = ({ tagName = "DIV", className = "", role = null, ariaModal = null, parentElement = null } = {}) => ({
    tagName,
    className,
    role,
    ariaModal,
    parentElement,
    isConnected: true,
    visible: true,
    inert: false,
    contains(element) {
      for (let current = element; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    },
    getAttribute(name) {
      if (name === "role") return this.role;
      if (name === "aria-modal") return this.ariaModal;
      if (name === "aria-hidden") return this.ariaHidden || null;
      if (name === "class") return this.className;
      return null;
    },
    hasAttribute(name) { return name === "inert" && this.inert === true; },
    getBoundingClientRect() { return this.visible ? { width: 640, height: 480 } : { width: 0, height: 0 }; },
  });
  const bodyElement = makeNode({ tagName: "BODY" });
  const overlayContainerElement = makeNode({
    className: overlayFlavor === "acx" ? "acx-overlay-container" : "cdk-overlay-container",
    parentElement: bodyElement,
  });
  const overlayElement = makeNode({
    className: overlayFlavor === "acx" ? "pane visible" : "cdk-overlay-pane",
    parentElement: overlayContainerElement,
  });
  const materialDialogElement = makeNode({ tagName: "MATERIAL-DIALOG", parentElement: overlayElement });
  const dialogElement = {
    ...makeNode({ role: "dialog", ariaModal: "true", parentElement: materialDialogElement }),
    getBoundingClientRect() { return this.visible ? { width: 480, height: 320 } : { width: 0, height: 0 }; },
  };
  const unrelatedOverlayElement = makeNode({ className: "cdk-overlay-pane", parentElement: overlayContainerElement });
  const resolveArgument = (value) => {
    if (value?.__element) return value.__element;
    if (Array.isArray(value)) return value.map(resolveArgument);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArgument(item)]));
    }
    return value;
  };
  const withDomGlobals = (callback) => {
    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (element) => ({
      display: element.visible === false ? "none" : "block",
      visibility: element.visible === false ? "hidden" : "visible",
      opacity: element.visible === false ? "0" : "1",
    });
    try { return callback(); }
    finally {
      if (previous === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = previous;
    }
  };
  const elementHandle = (element) => {
    if (!element) return null;
    if (!handleByElement.has(element)) {
      handleByElement.set(element, {
        __element: element,
        async evaluate(callback, argument) {
          return withDomGlobals(() => callback(element, resolveArgument(argument)));
        },
        async evaluateHandle(callback, argument) {
          const result = withDomGlobals(() => callback(element, resolveArgument(argument)));
          return elementHandle(result);
        },
        asElement() { return this; },
      });
    }
    return handleByElement.get(element);
  };
  const dialogHandle = elementHandle(dialogElement);
  const overlayHandle = elementHandle(overlayElement);
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const labelOf = (element) => normalize(element.ariaLabel || element.title || element.text);
  const exactMatch = (value, matcher) => matcher instanceof RegExp ? matcher.test(value) : value === matcher;
  const current = () => states[Math.min(stateIndex, states.length - 1)].map((descriptor) => {
    if (descriptor.__element) return descriptor.__element;
    const element = {
      tagName: String(descriptor.tagName || "BUTTON").toUpperCase(),
      role: descriptor.role == null ? null : String(descriptor.role),
      text: descriptor.text == null ? "Save and close" : String(descriptor.text),
      ariaLabel: descriptor.ariaLabel == null ? null : String(descriptor.ariaLabel),
      title: descriptor.title == null ? null : String(descriptor.title),
      isConnected: descriptor.connected !== false,
      disabled: descriptor.disabled === true,
      disabledAttribute: descriptor.disabledAttribute === true,
      ariaDisabled: descriptor.ariaDisabled == null ? null : String(descriptor.ariaDisabled),
      visible: descriptor.visible !== false,
      parentElement: descriptor.outside === true
        ? unrelatedOverlayElement
        : descriptor.portalSibling === true
          ? overlayElement
          : dialogElement,
      getAttribute(name) {
        if (name === "role") return this.role;
        if (name === "aria-label") return this.ariaLabel;
        if (name === "aria-disabled") return this.ariaDisabled;
        if (name === "title") return this.title;
        if (name === "disabled") return this.disabled || this.disabledAttribute ? "" : null;
        return null;
      },
      hasAttribute(name) { return name === "disabled" && (this.disabled || this.disabledAttribute); },
      get innerText() { return this.text; },
      get textContent() { return this.text; },
      getBoundingClientRect() {
        return this.visible ? { width: 120, height: 36 } : { width: 0, height: 0 };
      },
      closest(selector) {
        const clickable = this.tagName === "BUTTON"
          || this.tagName === "MATERIAL-BUTTON"
          || this.role === "button";
        return clickable && /button/i.test(String(selector || "")) ? this : null;
      },
    };
    descriptor.__element = element;
    return element;
  });
  const locatorFor = (predicate) => {
    const elements = () => current().filter(predicate);
    const locator = {
      async count() { return elements().length; },
      first() { return locator.nth(0); },
      nth(index) {
        return {
          async isVisible() { return Boolean(elements()[index]?.visible); },
          async evaluate(callback, argument) {
            const element = elements()[index];
            return withDomGlobals(() => callback(element, resolveArgument(argument)));
          },
          async elementHandle() { return elementHandle(elements()[index]); },
          locator(selector) {
            const element = elements()[index];
            if (!element || !/ancestor-or-self/i.test(String(selector || ""))) return locatorFor(() => false);
            return locatorFor((candidate) => candidate === element);
          },
        };
      },
      async all() { return elements().map((_, index) => locator.nth(index)); },
      async elementHandles() { return elements().map(elementHandle); },
      async evaluateAll(callback) { return withDomGlobals(() => callback(elements())); },
      filter({ hasText } = {}) {
        return locatorFor((element) => predicate(element) && (!hasText || exactMatch(normalize(element.text), hasText)));
      },
    };
    return locator;
  };
  const controlsForSelector = (selector, element) => {
    const wanted = String(selector || "").toLowerCase();
    return (wanted.includes("material-button") && element.tagName === "MATERIAL-BUTTON")
      || (wanted.includes("button") && (element.tagName === "BUTTON" || element.role === "button"));
  };
  const page = {
    locator(selector) { return locatorFor((element) => controlsForSelector(selector, element)); },
  };
  const dialog = {
    async elementHandle() { return dialogHandle; },
    locator(selector) { return locatorFor((element) => dialogElement.contains(element) && controlsForSelector(selector, element)); },
    getByRole(role, { name } = {}) {
      return locatorFor((element) => (
        role === "button"
        && (element.tagName === "BUTTON" || element.role === "button")
        && (!name || exactMatch(labelOf(element), name))
      ));
    },
    getByText(matcher) {
      return locatorFor((element) => exactMatch(normalize(element.text), matcher));
    },
  };
  return {
    page,
    dialog,
    dialogHandle,
    overlayHandle,
    controlHandle(index = 0) { return elementHandle(current()[index]); },
    detachDialog() { dialogElement.isConnected = false; },
    detachOverlay() { overlayElement.isConnected = false; },
    hideOverlay() { overlayElement.visible = false; },
    advance() { stateIndex += 1; },
  };
}

test("Save and close waits for a delayed dialog footer and returns one fixed handle", async () => {
  const harness = saveAndCloseDialogHarness([
    [],
    [],
    [{ tagName: "BUTTON", text: "Save and close", portalSibling: true }],
  ]);
  let waits = 0;
  const result = await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, {
    attempts: 4,
    pollMs: 0,
    async sleepImpl() { waits += 1; harness.advance(); },
  });
  assert.equal(result.ok, true);
  assert.ok(result.control, "the helper must freeze an ElementHandle, not return a live locator");
  assert.equal(waits, 2);
  assert.equal(await runner.saveAndCloseControlIsUsable(result.overlay, result.dialog, result.control), true);
});

test("Save and close uses Google's exact visible text when material-button aria-label is only Save", async () => {
  const harness = saveAndCloseDialogHarness([[
    { tagName: "MATERIAL-BUTTON", text: "Save and close", ariaLabel: "Save" },
  ]]);
  const result = await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 });
  assert.equal(result.ok, true);
  assert.ok(result.control);
  assert.equal(await runner.saveAndCloseControlIsUsable(result.overlay, result.dialog, result.control), true);
});

test("the wizard chooses the exact JPEG/JPG/PNG source input and rejects generic image inputs", async () => {
  const makeHandle = (element) => ({ async evaluate(callback) { return callback(element); } });
  const exact = makeHandle({
    isConnected: true, type: "file", disabled: false,
    accept: "image/jpeg,image/jpg,image/png",
  });
  const generic = makeHandle({
    isConnected: true, type: "file", disabled: false, accept: "image/*",
  });
  const multiple = makeHandle({
    isConnected: true, type: "file", disabled: false, multiple: true, files: [],
    accept: "image/jpeg,image/jpg,image/png",
  });
  const occupied = makeHandle({
    isConnected: true, type: "file", disabled: false, multiple: false, files: [{}],
    accept: "image/jpeg,image/jpg,image/png",
  });
  const page = {
    locator() { return { async elementHandles() { return [generic, exact]; } }; },
  };
  assert.deepEqual(
    await runner.waitForWizardSourceUploadInput(page, { attempts: 1 }),
    { ok: true, input: exact },
  );
  assert.equal(await runner.wizardSourceUploadHandleIsUsable(generic), false);
  assert.equal(await runner.wizardSourceUploadHandleIsUsable(exact), true);
  assert.equal(await runner.wizardSourceUploadHandleIsUsable(multiple), false);
  assert.equal(await runner.wizardSourceUploadHandleIsUsable(occupied), false);
  assert.equal(await runner.wizardSourceUploadHandleIsOwnedByPanel(exact, "source-panel"), false);

  const duplicate = { locator() { return { async elementHandles() { return [exact, exact]; } }; } };
  assert.deepEqual(
    await runner.waitForWizardSourceUploadInput(duplicate, { attempts: 1 }),
    { ok: false, reason: "optimized_asset_upload_input_ambiguous" },
  );
});

function wizardSourcePageHarness({
  step = 1,
  source = true,
  counter = source ? "one" : "absent",
  removable = true,
  duplicateTabs = false,
  wrongPanelRemove = false,
  unknownCard = false,
  libraryDecoys = 0,
  emptyCartWithoutCounter = false,
  zeroHeadingOutsideCart = false,
} = {}) {
  const state = {
    step, source, counter, inputVisible: false, tabClicks: 0, removeClicks: 0, uploadClicks: 0,
    postSelected: [], postCounter: null, responseHandler: null,
    sourceUrl: "https://tpc.googlesyndication.com/simgad/stale",
    sourceName: "stale.jpg", sourceWidth: 1200, sourceHeight: 870,
    ambiguousSource: false, legacyImageSelectorReads: 0,
    url: "https://ads.google.com/aw/assetstudio/animationcreator?ocid=1&uscid=1&authuser=0",
    uploadDuplicates: 1, promptDuplicates: 1, ownedInputChecks: 0, mutateScopeOnOwnedCheck: 0,
    crossRungUpload: false, libraryRemoveClicks: 0,
  };
  const attrs = (values = {}) => ({
    getAttribute(name) {
      const value = values[name];
      return typeof value === "function" ? value() : value ?? null;
    },
    hasAttribute(name) { return values[name] !== undefined; },
  });
  const document = { defaultView: { getComputedStyle(node) {
    return { display: typeof node._display === "function" ? node._display() : node._display || "block",
      visibility: "visible", opacity: "1" };
  } } };
  const root = {
    isConnected: true, hidden: false, inert: false, parentElement: null, ownerDocument: document,
    getAttribute() { return null; }, getBoundingClientRect() { return { width: 1200, height: 0 }; },
  };
  const node = ({ values = {}, parent = root, text = "", width = 100, height = 30, display = "block" } = {}) => ({
    isConnected: true, hidden: false, inert: false, disabled: false, parentElement: parent,
    ownerDocument: document, innerText: text, textContent: text, children: [], _display: display,
    ...attrs(values),
    getBoundingClientRect() { return { width, height }; },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (selector === '[role="tabpanel"]' && current.getAttribute?.("role") === "tabpanel") return current;
        if (selector === "shopping-cart" && String(current.tagName || "").toLowerCase() === "shopping-cart") return current;
        if (selector.startsWith('div.asset-thumbnail') && current.getAttribute?.("role") === "group"
            && /^Preview card for Image asset named \(/.test(current.getAttribute?.("aria-label") || "")) return current;
      }
      return null;
    },
  });
  const panel = node({
    values: { role: "tabpanel" },
    display: () => state.step === 1 ? "block" : "none",
    width: 900,
    height: 600,
  });
  panel.id = "source-panel";
  const step2Panel = node({ values: { role: "tabpanel" }, display: "block" });
  step2Panel.id = "step2-panel";
  const tab = node({
    values: {
      role: "tab",
      "aria-label": "Step 1 of 3, Choose source image",
      "aria-controls": "source-panel",
      "aria-selected": () => state.step === 1 ? "true" : "false",
    },
    width: 253,
    height: 28,
  });
  const cart = node({ parent: panel });
  cart.tagName = "SHOPPING-CART";
  const heading = node({ parent: zeroHeadingOutsideCart ? panel : cart, text: () => "" });
  Object.defineProperty(heading, "textContent", {
    get() { return state.counter === "one" ? "Source image (1/1)" : state.counter === "zero" ? "Source image (0/1)" : ""; },
  });
  const group = node({
    parent: cart,
    values: { role: "group", "aria-label": () => `Preview card for Image asset named (${state.sourceName})` },
  });
  const image = node({ parent: group, width: 300, height: 180 });
  Object.defineProperties(image, {
    src: { get() { return state.sourceUrl; } },
    currentSrc: { get() { return state.sourceUrl; } },
    naturalWidth: { get() { return state.sourceWidth; } },
    naturalHeight: { get() { return state.sourceHeight; } },
  });
  const removeElement = node({ parent: group, values: { "aria-label": "Remove asset" }, text: "Remove asset", width: 28, height: 28 });
  const decoyGroup = node({
    parent: step2Panel,
    values: { role: "group", "aria-label": "Preview card for Image asset named (decoy.jpg)" },
  });
  const decoyImage = node({ parent: decoyGroup, width: 300, height: 180 });
  decoyImage.src = decoyImage.currentSrc = "https://tpc.googlesyndication.com/simgad/decoy";
  const decoyRemoveElement = node({ parent: decoyGroup, values: { "aria-label": "Remove asset" }, text: "Remove asset" });
  const libraryGroups = Array.from({ length: libraryDecoys }, (_, index) => {
    const libraryGroup = node({
      parent: panel,
      values: { role: "group", "aria-label": `Preview card for Image asset named (library-${index}.jpg)` },
    });
    const libraryImage = node({ parent: libraryGroup, width: 300, height: 180 });
    libraryImage.src = libraryImage.currentSrc = "https://tpc.googlesyndication.com/simgad/stale";
    const libraryRemove = node({
      parent: libraryGroup,
      values: { "aria-label": "Remove asset" },
      text: "Remove asset",
    });
    libraryGroup.querySelectorAll = (selector) => selector === "img.asset-thumbnail-img"
      ? [libraryImage]
      : selector.includes("Remove asset") ? [libraryRemove] : [];
    return { group: libraryGroup, image: libraryImage, remove: libraryRemove };
  });
  const uploadElement = node({ parent: panel, values: { role: "tab", "aria-label": "Upload" }, text: "Upload" });
  const uploadButtonElement = node({ parent: panel, values: { role: "button", "aria-label": "Upload" }, text: "Upload" });
  uploadButtonElement.tagName = "BUTTON";
  const choosePrompt = node({ parent: panel, text: "Choose 1 image without faces" });
  const inputElement = node({ parent: panel, width: 0, height: 0 });
  inputElement.type = "file";
  inputElement.accept = "image/jpeg,image/jpg,image/png";
  inputElement.multiple = false;
  inputElement.files = [];

  group.querySelectorAll = (selector) => selector === "img.asset-thumbnail-img"
    ? (state.source ? [image] : [])
    : (state.source && selector.includes("Remove asset") ? [removeElement] : []);
  cart.querySelectorAll = (selector) => {
    if (selector === '[role="group"]') return state.source ? [group] : [];
    if (selector === "img.asset-thumbnail-img") return state.source ? [image] : [];
    if (selector.includes("Remove asset")) return state.source ? [removeElement] : [];
    if (selector.startsWith('div.asset-thumbnail')) return state.source && !unknownCard ? [group] : [];
    return [];
  };
  panel.querySelectorAll = (selector) => {
    if (selector.includes("h1, h2")) return state.counter === "absent" ? [] : [heading];
    if (selector === "shopping-cart") {
      if (state.ambiguousSource) return [cart, cart];
      return state.source || (state.counter === "zero" && !zeroHeadingOutsideCart) || emptyCartWithoutCounter ? [cart] : [];
    }
    if (selector === '[role="group"]') return [...(state.source ? [group] : []), ...libraryGroups.map((item) => item.group)];
    if (selector === "img.asset-thumbnail-img") return [...(state.source ? [image] : []), ...libraryGroups.map((item) => item.image)];
    if (selector.includes("Remove asset")) return [...(state.source ? [removeElement] : []), ...libraryGroups.map((item) => item.remove)];
    if (selector.startsWith("shopping-cart")) return state.source && !unknownCard ? [group] : [];
    if (selector === 'input[type="file"]') return state.inputVisible ? [inputElement] : [];
    if (selector.startsWith("button, material-button")) return Array(state.uploadDuplicates).fill(uploadElement);
    if (selector === "*") return state.source ? [] : Array(state.promptDuplicates).fill(choosePrompt);
    return [];
  };
  step2Panel.querySelectorAll = () => [decoyGroup];
  decoyGroup.querySelectorAll = (selector) => selector === "img.asset-thumbnail-img" ? [decoyImage] : [decoyRemoveElement];

  const handle = (element, click) => ({
    async evaluate(callback, argument) { return callback(element, argument); },
    async click() { if (click) click(); },
  });
  const tabHandle = handle(tab, () => { state.tabClicks += 1; state.step = 1; });
  const removeHandle = handle(removeElement, () => {
    state.removeClicks += 1; state.source = false; state.counter = "absent";
  });
  const decoyRemoveHandle = handle(decoyRemoveElement, () => { throw new Error("step2 decoy clicked"); });
  const libraryRemoveHandle = libraryGroups[0]
    ? handle(libraryGroups[0].remove, () => { state.libraryRemoveClicks += 1; })
    : null;
  const uploadHandle = handle(uploadElement, () => { state.uploadClicks += 1; state.inputVisible = true; });
  const uploadButtonHandle = handle(uploadButtonElement, () => { throw new Error("fallback upload clicked"); });
  const inputHandle = {
    async evaluate(callback, argument) {
      const result = callback(inputElement, argument);
      state.ownedInputChecks += 1;
      if (state.mutateScopeOnOwnedCheck === state.ownedInputChecks) {
        state.url = "https://ads.google.com/aw/assetstudio/animationcreator?ocid=9&uscid=9&authuser=0";
      }
      return result;
    },
  };
  const panelHandle = {
    async evaluate(callback, argument) { return callback(panel, argument); },
    async $$(selector) {
      if (selector === "shopping-cart") {
        return state.source || (state.counter === "zero" && !zeroHeadingOutsideCart) || emptyCartWithoutCounter
          ? [cartHandle]
          : [];
      }
      return state.crossRungUpload
        ? [uploadHandle, uploadButtonHandle]
        : Array(state.uploadDuplicates).fill(uploadHandle);
    },
  };
  const cartHandle = {
    async evaluate(callback, argument) { return callback(cart, argument); },
    async $$(selector) {
      if (selector.includes("Remove asset")) {
        if (wrongPanelRemove) return [decoyRemoveHandle];
        return removable && state.source ? [removeHandle] : [];
      }
      return [];
    },
  };
  let activePanelHandle = panelHandle;
  const step2PanelHandle = { async evaluate(callback, argument) { return callback(step2Panel, argument); } };
  const page = {
    url() { return state.url; },
    on(event, callback) { if (event === "response") state.responseHandler = callback; },
    off() {},
    getByText() {
      return { async evaluateAll() { return state.postCounter === null ? [] : [`Source image (${state.postCounter}/1)`]; } };
    },
    locator(selector) {
      if (selector.includes('Step 1 of 3, Choose source image')) {
        return { async elementHandles() { return duplicateTabs ? [tabHandle, tabHandle] : [tabHandle]; } };
      }
      if (selector === '[role="tabpanel"]') {
        return { async elementHandles() { return [activePanelHandle, step2PanelHandle]; } };
      }
      if (selector === 'input[type="file"]') {
        return { async elementHandles() { return state.inputVisible ? [inputHandle] : []; } };
      }
      if (selector === "img.image-for-animation") {
        state.legacyImageSelectorReads += 1;
        return { async evaluateAll() { return state.postSelected; } };
      }
      return { async elementHandles() { return []; } };
    },
  };
  return {
    state, page, inputHandle, panelHandle, uploadHandle, uploadElement, libraryRemoveHandle,
    remountPanel() {
      const remounted = { ...panel, id: panel.id, querySelectorAll: panel.querySelectorAll };
      activePanelHandle = {
        async evaluate(callback, argument) { return callback(remounted, argument?._element || argument); },
        async $$(selector) { return panelHandle.$$(selector); },
        _element: remounted,
      };
    },
  };
}

async function prepareWizardSourceUpload(harness) {
  const adsParams = "ocid=1&uscid=1&authuser=0";
  const emptyProof = await runner.clearWizardSource(
    harness.page,
    adsParams,
    { attempts: 1, pollMs: 0 },
  );
  assert.equal(emptyProof.ok, true, JSON.stringify(emptyProof));
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    adsParams,
    { attempts: 1, pollMs: 0 },
  );
  assert.equal(upload.ok, true, JSON.stringify(upload));
  await upload.control.click();
  return { adsParams, emptyProof };
}

test("a stale 1/1 wizard source is removed and 0/1 is proved before upload", async () => {
  const harness = wizardSourcePageHarness({ step: 3 });
  assert.deepEqual(
    await runner.clearWizardSource(harness.page, "ocid=1&uscid=1&authuser=0", {
      attempts: 1, pollMs: 0,
    }),
    { ok: true, removed: true, sourceCounter: 0, visibleSources: 0 },
  );
  assert.equal(harness.state.tabClicks, 1);
  assert.equal(harness.state.removeClicks, 1);

  const blocked = wizardSourcePageHarness({ removable: false });
  assert.equal((await runner.clearWizardSource(
    blocked.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  )).reason, "wizard_source_remove_control_not_found");
  assert.equal(blocked.state.removeClicks, 0);
});

test("Asset Library cards never impersonate the Step 1 selected-source cart", async () => {
  const empty = wizardSourcePageHarness({
    step: 1, source: false, counter: "absent", libraryDecoys: 4,
  });
  assert.deepEqual(await runner.clearWizardSource(
    empty.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  ), { ok: true, removed: false, sourceCounter: 0, visibleSources: 0 });

  const selected = wizardSourcePageHarness({
    step: 1, source: true, counter: "one", libraryDecoys: 4,
  });
  assert.equal(await runner.wizardSourcePanelRemoveControlIsUsable(
    selected.libraryRemoveHandle,
    "source-panel",
    "https://tpc.googlesyndication.com/simgad/stale",
  ), false);
  assert.deepEqual(await runner.clearWizardSource(
    selected.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  ), { ok: true, removed: true, sourceCounter: 0, visibleSources: 0 });
  assert.equal(selected.state.removeClicks, 1);
  assert.equal(selected.state.libraryRemoveClicks, 0);
});

test("active empty Step 1 with no counter is proved without a navigation click", async () => {
  const harness = wizardSourcePageHarness({ step: 1, source: false, counter: "absent" });
  assert.deepEqual(
    await runner.clearWizardSource(harness.page, "ocid=1&uscid=1&authuser=0", {
      attempts: 1, pollMs: 0,
    }),
    { ok: true, removed: false, sourceCounter: 0, visibleSources: 0 },
  );
  assert.equal(harness.state.tabClicks, 0);
  assert.equal(harness.state.removeClicks, 0);
});

test("duplicate Step 1 tabs and Step 2 decoy removal fail closed", async () => {
  const duplicate = wizardSourcePageHarness({ duplicateTabs: true });
  assert.equal((await runner.clearWizardSource(
    duplicate.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  )).reason, "wizard_source_step1_tab_ambiguous");
  assert.equal(duplicate.state.tabClicks, 0);
  assert.equal(duplicate.state.removeClicks, 0);

  const decoy = wizardSourcePageHarness({ wrongPanelRemove: true });
  assert.equal((await runner.clearWizardSource(
    decoy.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  )).reason, "wizard_source_remove_control_not_found");
  assert.equal(decoy.state.removeClicks, 0);
});

test("counter and source-card mismatches never mint an empty proof", async () => {
  const inconsistent = wizardSourcePageHarness({ source: true, counter: "zero" });
  const result = await runner.clearWizardSource(
    inconsistent.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wizard_source_zero_state_inconsistent");
  assert.equal(inconsistent.state.removeClicks, 0);
});

test("unknown Step 1 card shapes block with count-only diagnostics", async () => {
  const unknown = wizardSourcePageHarness({ source: true, counter: "absent", unknownCard: true });
  const result = await runner.clearWizardSource(
    unknown.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wizard_source_panel_state_not_confirmed");
  assert.deepEqual(result.detail, {
    counter_state: "absent", counter_count: 0, cart_count: 1, group_count: 1,
    image_count: 1, remove_count: 1, picker_count: 0, upload_count: 1, prompt_count: 0,
  });
  assert.doesNotMatch(JSON.stringify(result.detail), /https|ocid|stale\.jpg/i);
  assert.equal(unknown.state.removeClicks, 0);
});

test("a clean active Step 1 0/1 state mints proof with no clicks", async () => {
  const clean = wizardSourcePageHarness({ source: false, counter: "zero" });
  const state = await runner.wizardSourcePanelState(clean.panelHandle);
  assert.equal(state.cartCount, 1, "the real 0/1 heading remains inside an empty shopping-cart");
  assert.equal(state.counterCartCount, 1);
  assert.equal(state.groupCount, 0);
  assert.deepEqual(await runner.clearWizardSource(
    clean.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  ), { ok: true, removed: false, sourceCounter: 0, visibleSources: 0 });
  assert.equal(clean.state.tabClicks, 0);
  assert.equal(clean.state.removeClicks, 0);

  const counterlessCart = wizardSourcePageHarness({
    source: false, counter: "absent", emptyCartWithoutCounter: true,
  });
  assert.equal((await runner.clearWizardSource(
    counterlessCart.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  )).reason, "wizard_source_panel_state_not_confirmed");

});

test("a 0/1 heading outside the source cart never authorizes upload", async () => {
  const unboundZero = wizardSourcePageHarness({
    source: false, counter: "zero", zeroHeadingOutsideCart: true,
  });
  assert.equal((await runner.clearWizardSource(
    unboundZero.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  )).reason, "wizard_source_panel_state_not_confirmed");
});

test("the Step 1 Upload control rejects hidden ancestors and cross-rung duplicates", async () => {
  const hidden = wizardSourcePageHarness({ step: 3, source: false, counter: "absent" });
  assert.equal(await runner.wizardSourcePanelUploadControlIsUsable(
    hidden.uploadHandle,
    "source-panel",
  ), false);

  const duplicate = wizardSourcePageHarness({ source: false, counter: "absent" });
  duplicate.state.crossRungUpload = true;
  assert.deepEqual(await runner.waitForWizardSourcePanelUploadControl(
    duplicate.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  ), {
    ok: false,
    reason: "wizard_source_upload_tab_ambiguous",
    detail: { tab_count: 1, button_count: 1 },
  });
  assert.equal(duplicate.state.uploadClicks, 0);

  const missing = wizardSourcePageHarness({ source: false, counter: "absent" });
  missing.state.uploadDuplicates = 0;
  assert.deepEqual(await runner.waitForWizardSourcePanelUploadControl(
    missing.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  ), {
    ok: false,
    reason: "wizard_source_upload_tab_not_found",
    detail: { tab_count: 0, button_count: 0 },
  });
});

test("both production source handlers use the same guarded Step 1 chain and retain rung telemetry", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/ads-station/animate-image-runner.cjs"),
    "utf8",
  );
  const handlerBlock = (name) => {
    const start = source.indexOf(`async ${name}() {`);
    assert.notEqual(start, -1, `${name} handler missing`);
    const end = source.indexOf("\n      async ", start + 10);
    assert.notEqual(end, -1, `${name} handler boundary missing`);
    return source.slice(start, end);
  };
  for (const name of ["select_exact_source_asset", "select_exact_optimized_asset"]) {
    const block = handlerBlock(name);
    const clearAt = block.indexOf("clearWizardSource(page, adsParams)");
    const uploadControlAt = block.indexOf("waitForWizardSourcePanelUploadControl(page, adsParams)");
    const exactUploadAt = block.indexOf("uploadExactWizardSource(");
    assert.ok(clearAt >= 0 && clearAt < uploadControlAt && uploadControlAt < exactUploadAt, name);
    assert.match(block, /state\.sourceUploadControlRung\s*=\s*uploadTab\.rung/);
    assert.match(block, /sourceUploadControlRung:\s*uploadTab\.rung/);
  }
});

test("a same-id Step 1 panel remount makes the empty proof stale", async () => {
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const proof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  harness.remountPanel();
  assert.equal((await runner.uploadExactWizardSource(harness.page, harness.inputHandle, {}, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_empty_proof_stale");
});

test("a generic or global file input is never owned by Step 1", async () => {
  const input = {
    async evaluate(callback, argument) {
      return callback({
        isConnected: true, type: "file", disabled: false, multiple: false, files: [],
        accept: "image/jpeg,image/jpg,image/png", closest() { return null; },
      }, argument);
    },
  };
  assert.equal(await runner.wizardSourceUploadHandleIsOwnedByPanel(input, "source-panel"), false);
});

test("scope mutation during the final input check blocks setInputFiles", async () => {
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const proof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  await upload.control.click();
  let uploads = 0;
  harness.inputHandle.setInputFiles = async () => { uploads += 1; };
  harness.state.ownedInputChecks = 0;
  harness.state.mutateScopeOnOwnedCheck = 2;
  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, {}, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  });
  assert.equal(result.reason, "ads_account_scope_not_confirmed");
  assert.equal(uploads, 0);
});

test("ambiguous picker state immediately before upload makes proof stale", async () => {
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const proof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  await upload.control.click();
  harness.state.promptDuplicates = 2;
  assert.equal((await runner.uploadExactWizardSource(harness.page, harness.inputHandle, {}, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_empty_proof_stale");
});

test("empty proofs are page-bound, stale-checked, and single-use", async () => {
  const proofBytes = jpegWithDimensions(1200, 870, 22000);
  const proofSha256 = crypto.createHash("sha256").update(proofBytes).digest("hex");
  const proofPayload = runner.exactDirectSourceUploadPayload(proofBytes, proofSha256);
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const proof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const other = wizardSourcePageHarness({ source: false, counter: "absent" });
  assert.equal((await runner.uploadExactWizardSource(other.page, other.inputHandle, {}, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_empty_proof_required");

  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  await upload.control.click();
  harness.inputHandle.setInputFiles = async () => { throw new Error("local fixture stop"); };
  assert.equal((await runner.uploadExactWizardSource(harness.page, harness.inputHandle, proofPayload, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_upload_failed");
  assert.equal((await runner.uploadExactWizardSource(harness.page, harness.inputHandle, {}, {
    emptyProof: proof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_empty_proof_required");

  const stale = wizardSourcePageHarness({ source: false, counter: "absent" });
  const staleProof = await runner.clearWizardSource(
    stale.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  stale.state.source = true;
  stale.state.counter = "one";
  assert.equal((await runner.uploadExactWizardSource(stale.page, stale.inputHandle, {}, {
    emptyProof: staleProof, adsParams: "ocid=1&uscid=1&authuser=0",
  })).reason, "wizard_source_empty_proof_stale");
});

test("the post-upload selected source must bind to an image response from that upload", async () => {
  const payload = runner.exactDirectSourceUploadPayload(
    jpegWithDimensions(1200, 870, 22000),
    crypto.createHash("sha256").update(jpegWithDimensions(1200, 870, 22000)).digest("hex"),
  );
  const selectedUrl = "https://tpc.googlesyndication.com/simgad/new-source";
  const responseBytes = jpegWithDimensions(1200, 870, 22000);
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const emptyProof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  assert.equal(upload.ok, true, JSON.stringify(upload));
  await upload.control.click();
  harness.inputHandle.setInputFiles = async (observed) => {
    assert.equal(observed, payload);
    harness.state.responseHandler({
        url: () => selectedUrl,
        headers: () => ({ "content-type": "image/jpeg" }),
        body: async () => responseBytes,
      });
    harness.state.sourceUrl = selectedUrl;
    harness.state.sourceName = payload.name;
    harness.state.source = true;
    harness.state.counter = "one";
  };
  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    timeoutMs: 100, pollMs: 0, emptyProof, adsParams: "ocid=1&uscid=1&authuser=0",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sourceUrl, selectedUrl);
  assert.equal(result.sourceWidth, 1200);
  assert.equal(result.sourceHeight, 870);
  assert.equal(result.sourceBinding, "panel_filename_and_response");
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("the exact Step 1 panel binds one uploaded payload without a legacy image selector or image response", async () => {
  const bytes = jpegWithDimensions(1400, 900, 24000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const selectedUrl = "https://tpc.googlesyndication.com/simgad/panel-bound-source";
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const emptyProof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  await upload.control.click();
  harness.inputHandle.setInputFiles = async (observed) => {
    assert.equal(observed, payload);
    harness.state.sourceUrl = selectedUrl;
    harness.state.sourceName = payload.name;
    harness.state.sourceWidth = 1400;
    harness.state.sourceHeight = 900;
    harness.state.source = true;
    harness.state.counter = "one";
  };

  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    timeoutMs: 100,
    pollMs: 0,
    emptyProof,
    adsParams: "ocid=1&uscid=1&authuser=0",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sourceUrl, selectedUrl);
  assert.equal(result.sourceSha256, sha256);
  assert.equal(result.sourceWidth, 1400);
  assert.equal(result.sourceHeight, 900);
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("an upload with no exact Step 1 transition is refused", async () => {
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const emptyProof = await runner.clearWizardSource(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  const upload = await runner.waitForWizardSourcePanelUploadControl(
    harness.page,
    "ocid=1&uscid=1&authuser=0",
    { attempts: 1, pollMs: 0 },
  );
  await upload.control.click();
  harness.inputHandle.setInputFiles = async () => {};

  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    timeoutMs: 1,
    pollMs: 0,
    emptyProof,
    adsParams: "ocid=1&uscid=1&authuser=0",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^wizard_source_post_upload_timeout_/);
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("zero-state and ambiguous exact Step 1 transitions are refused", async () => {
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const attempt = async (mutate) => {
    const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
    const emptyProof = await runner.clearWizardSource(
      harness.page,
      "ocid=1&uscid=1&authuser=0",
      { attempts: 1, pollMs: 0 },
    );
    const upload = await runner.waitForWizardSourcePanelUploadControl(
      harness.page,
      "ocid=1&uscid=1&authuser=0",
      { attempts: 1, pollMs: 0 },
    );
    await upload.control.click();
    harness.inputHandle.setInputFiles = async () => mutate(harness.state);
    const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
      timeoutMs: 100,
      pollMs: 0,
      emptyProof,
      adsParams: "ocid=1&uscid=1&authuser=0",
    });
    assert.equal(harness.state.legacyImageSelectorReads, 0);
    return result;
  };

  const zero = await attempt((state) => {
    state.sourceName = payload.name;
    state.source = true;
    state.counter = "zero";
  });
  assert.equal(zero.ok, false);
  assert.equal(zero.reason, "wizard_source_zero_state_inconsistent");

  const ambiguous = await attempt((state) => {
    state.sourceName = payload.name;
    state.source = true;
    state.counter = "one";
    state.ambiguousSource = true;
  });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.reason, /ambiguous/);
});

test("switching away from Step 1 after upload is refused and the Step 2 decoy is ignored", async () => {
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const { adsParams, emptyProof } = await prepareWizardSourceUpload(harness);
  harness.inputHandle.setInputFiles = async () => {
    harness.state.step = 2;
  };

  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    timeoutMs: 100,
    pollMs: 0,
    emptyProof,
    adsParams,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wizard_source_step1_not_confirmed");
  assert.equal(harness.state.removeClicks, 0);
  assert.equal(harness.state.libraryRemoveClicks, 0);
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("a post-upload filename mismatch is refused", async () => {
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const { adsParams, emptyProof } = await prepareWizardSourceUpload(harness);
  harness.inputHandle.setInputFiles = async () => {
    harness.state.sourceUrl = "https://tpc.googlesyndication.com/simgad/wrong-name";
    harness.state.sourceName = "someone-elses-photo.jpg";
    harness.state.source = true;
    harness.state.counter = "one";
  };

  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    timeoutMs: 100,
    pollMs: 0,
    emptyProof,
    adsParams,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wizard_source_post_upload_name_mismatch");
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("invalid upload name, MIME, and bytes are refused before setInputFiles", async () => {
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const valid = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const invalidBytes = Buffer.alloc(22000, 0);
  const invalidBytesSha = crypto.createHash("sha256").update(invalidBytes).digest("hex");
  const payloads = [
    { ...valid, name: "wrong-name.jpg" },
    { ...valid, mimeType: "image/png" },
    {
      name: `wss-source-${invalidBytesSha.slice(0, 16)}.jpg`,
      mimeType: "image/jpeg",
      buffer: invalidBytes,
    },
  ];

  for (const payload of payloads) {
    const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
    const { adsParams, emptyProof } = await prepareWizardSourceUpload(harness);
    let uploads = 0;
    harness.inputHandle.setInputFiles = async () => { uploads += 1; };
    const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
      emptyProof,
      adsParams,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "wizard_source_upload_identity_invalid");
    assert.equal(uploads, 0);
  }
});

test("one upload can bind after several exact-panel polls on the 90-second path", async () => {
  const bytes = jpegWithDimensions(1400, 900, 24000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const payload = runner.exactDirectSourceUploadPayload(bytes, sha256);
  const selectedUrl = "https://tpc.googlesyndication.com/simgad/delayed-source";
  const harness = wizardSourcePageHarness({ source: false, counter: "absent" });
  const { adsParams, emptyProof } = await prepareWizardSourceUpload(harness);
  let uploads = 0;
  let polls = 0;
  harness.inputHandle.setInputFiles = async () => { uploads += 1; };

  const result = await runner.uploadExactWizardSource(harness.page, harness.inputHandle, payload, {
    pollMs: 500,
    sleepImpl: async () => {
      polls += 1;
      if (polls === 3) {
        harness.state.sourceUrl = selectedUrl;
        harness.state.sourceName = payload.name;
        harness.state.sourceWidth = 1400;
        harness.state.sourceHeight = 900;
        harness.state.source = true;
        harness.state.counter = "one";
      }
    },
    emptyProof,
    adsParams,
  });
  assert.equal(runner.WIZARD_SOURCE_BIND_TIMEOUT_MS, 90000);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sourceUrl, selectedUrl);
  assert.equal(result.sourceSha256, sha256);
  assert.equal(uploads, 1);
  assert.equal(polls, 3);
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("filename-only fallback ignores unrelated image responses", async () => {
  const selectedUrl = "https://tpc.googlesyndication.com/simgad/new-source";
  const unrelatedUrl = "https://tpc.googlesyndication.com/simgad/unrelated";
  const selectedBytes = jpegWithDimensions(1200, 870, 22000);
  const unrelatedBytes = jpegWithDimensions(640, 480, 22000);
  const selectedSha256 = crypto.createHash("sha256").update(selectedBytes).digest("hex");
  const unrelatedSha256 = crypto.createHash("sha256").update(unrelatedBytes).digest("hex");
  let snapshots = 0;
  const expectedSourceName = `wss-source-${selectedSha256.slice(0, 16)}.jpg`;
  const harness = wizardSourcePageHarness({ source: true, counter: "one" });
  harness.state.sourceUrl = selectedUrl;
  harness.state.sourceName = expectedSourceName;
  const unrelated = { url: unrelatedUrl, bytes: unrelatedBytes, sha256: unrelatedSha256 };
  const responseCapture = {
    async snapshot() {
      snapshots += 1;
      return [unrelated];
    },
  };
  const result = await runner.waitForBoundWizardSource(harness.page, responseCapture, {
    timeoutMs: 100,
    pollMs: 0,
    sleepImpl: async () => {},
    adsParams: "ocid=1&uscid=1&authuser=0",
    expectedPanelId: "source-panel",
    expectedSourceName,
    expectedSourceSha256: selectedSha256,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sourceUrl, selectedUrl);
  assert.equal(result.sourceSha256, selectedSha256);
  assert.equal(result.sourceBinding, "panel_filename");
  assert.equal(snapshots, 1);
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("a visible source cannot override an explicit post-upload 0/1 counter", async () => {
  const selectedUrl = "https://tpc.googlesyndication.com/simgad/inconsistent";
  const bytes = jpegWithDimensions(1200, 870, 22000);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const expectedSourceName = `wss-source-${sha256.slice(0, 16)}.jpg`;
  const harness = wizardSourcePageHarness({ source: true, counter: "zero" });
  harness.state.sourceUrl = selectedUrl;
  harness.state.sourceName = expectedSourceName;
  const responseCapture = { async snapshot() { return [{ url: selectedUrl, bytes, sha256 }]; } };
  const result = await runner.waitForBoundWizardSource(harness.page, responseCapture, {
    timeoutMs: 5,
    pollMs: 0,
    adsParams: "ocid=1&uscid=1&authuser=0",
    expectedPanelId: "source-panel",
    expectedSourceName,
    expectedSourceSha256: sha256,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "wizard_source_zero_state_inconsistent");
  assert.equal(harness.state.legacyImageSelectorReads, 0);
});

test("background browser is default-on, has an explicit kill switch, and resolves only an existing Chrome", () => {
  assert.equal(runner.backgroundBrowserEnabled({}), true);
  assert.equal(runner.backgroundBrowserEnabled({ ADS_STATION_BACKGROUND_BROWSER: "1" }), true);
  assert.equal(runner.backgroundBrowserEnabled({ ADS_STATION_BACKGROUND_BROWSER: "0" }), false);
  assert.equal(runner.backgroundBrowserEnabled({ ADS_STATION_BACKGROUND_BROWSER: "false" }), false);

  const configured = "C:\\tools\\chrome.exe";
  assert.equal(runner.resolveBackgroundBrowserExecutable(
    { ADS_STATION_BROWSER_EXECUTABLE: configured },
    { platform: "win32", existsSync: (candidate) => candidate === configured },
  ), path.resolve(configured));
  assert.equal(runner.resolveBackgroundBrowserExecutable(
    { ADS_STATION_BROWSER_EXECUTABLE: "C:\\missing\\chrome.exe" },
    { platform: "win32", existsSync: () => false },
  ), null);
});

test("hidden browser receives only in-memory Google state and the source CDP browser is never closed", async () => {
  const params = "ocid=8474175002&uscid=8474175002&authuser=0";
  const sourceState = {
    cookies: [
      { name: "SID", value: "google-secret", domain: ".google.com", path: "/" },
      { name: "other", value: "unrelated-secret", domain: ".example.com", path: "/" },
    ],
    origins: [
      { origin: "https://ads.google.com", localStorage: [{ name: "ads", value: "scoped" }] },
      { origin: "https://unrelated.example", localStorage: [{ name: "private", value: "exclude" }] },
    ],
  };
  let sourceClosed = 0;
  let hiddenClosed = 0;
  let hiddenContextClosed = 0;
  let contextOptions = null;
  let launchOptions = null;
  const hiddenContext = { async close() { hiddenContextClosed += 1; } };
  const hiddenBrowser = {
    async newContext(options) { contextOptions = options; return hiddenContext; },
    async close() { hiddenClosed += 1; },
  };
  const sourceContext = {
    pages() { return [{ url: () => `https://ads.google.com/aw/assetstudio?${params}` }]; },
    async storageState() { return sourceState; },
  };
  const sourceBrowser = {
    contexts() { return [sourceContext]; },
    async close() { sourceClosed += 1; },
  };
  const driver = {
    async connectOverCDP() { return sourceBrowser; },
    async launch(options) { launchOptions = options; return hiddenBrowser; },
  };
  const executable = "C:\\tools\\chrome.exe";
  const session = await runner.openAdsBrowserSession(driver, {}, {
    env: { ADS_STATION_BROWSER_EXECUTABLE: executable },
    platform: "win32",
    existsSync: (candidate) => candidate === executable,
  });
  assert.equal(session.ok, true);
  assert.equal(session.background, true);
  assert.equal(launchOptions.headless, true);
  assert.equal(launchOptions.executablePath, path.resolve(executable));
  assert.deepEqual(contextOptions.storageState, {
    cookies: [sourceState.cookies[0]],
    origins: [sourceState.origins[0]],
  });
  assert.equal(contextOptions.storageState.cookies.some((cookie) => cookie.value === "unrelated-secret"), false);
  await session.close();
  assert.equal(sourceClosed, 0);
  assert.equal(hiddenContextClosed, 1);
  assert.equal(hiddenClosed, 1);

  assert.equal(runner.scopedGoogleStorageState({
    cookies: [{ domain: ".example.com", value: "x" }], origins: [],
  }), null, "a session with no scoped Google state must fail closed");
});

test("Step 2 selects only Google's Cropped horizontal list item", async () => {
  let checked = "false";
  let clicks = 0;
  const checkbox = {
    async count() { return 1; },
    first() { return this; },
    async getAttribute(name) { return name === "aria-checked" ? checked : null; },
  };
  const item = {
    first() { return this; },
    async waitFor() {},
    async isVisible() { return true; },
    locator() { return checkbox; },
    async click() { clicks += 1; checked = "true"; },
  };
  const page = {
    getByRole(role) {
      assert.equal(role, "listitem");
      return { filter({ hasText }) { assert.match("Cropped (horizontal)", hasText); return item; } };
    },
  };
  assert.deepEqual(await runner.selectHorizontalEnhancedAsset(page, { timeoutMs: 10, pollMs: 0 }), { ok: true });
  assert.equal(clicks, 1);
});

test("animation clicks the unique enabled MATERIAL-BUTTON in the active tabpanel, never an AWSM breadcrumb", async () => {
  const makeHandle = ({ tagName = "MATERIAL-BUTTON", text = "Create animated clips", active = true, disabled = false } = {}) => {
    const view = { getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; } };
    let panel;
    let tab;
    const ownerDocument = {
      defaultView: view,
      querySelectorAll(selector) {
        if (selector === '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]') return [tab];
        if (selector === '[role="tabpanel"]') return [panel];
        return [];
      },
    };
    panel = {
      id: "step-two-panel",
      hidden: !active,
      inert: false,
      isConnected: true,
      ownerDocument,
      getBoundingClientRect() { return active ? { width: 800, height: 500 } : { width: 0, height: 0 }; },
      hasAttribute() { return false; },
      getAttribute(name) {
        if (name === "role") return "tabpanel";
        return name === "aria-hidden" && !active ? "true" : null;
      },
    };
    tab = {
      isConnected: true,
      ownerDocument,
      getBoundingClientRect() { return { width: 240, height: 48 }; },
      getAttribute(name) {
        if (name === "role") return "tab";
        if (name === "aria-selected") return "true";
        if (name === "aria-controls") return panel.id;
        if (name === "aria-label") return "Step 2 of 3, Choose enhanced images";
        return null;
      },
    };
    const element = {
      isConnected: true,
      tagName,
      innerText: text,
      textContent: text,
      disabled,
      ownerDocument,
      closest(selector) { return selector === '[role="tabpanel"]' && active ? panel : null; },
      getBoundingClientRect() { return { width: 220, height: 48 }; },
      hasAttribute(name) { return name === "disabled" && disabled; },
      getAttribute(name) { return name === "aria-disabled" && disabled ? "true" : null; },
    };
    return { async evaluate(callback) { return callback(element); } };
  };
  const breadcrumb = makeHandle({ tagName: "AWSM-BREADCRUMB" });
  const disabled = makeHandle({ disabled: true });
  const action = makeHandle();
  const page = {
    locator(selector) {
      assert.equal(selector, "material-button");
      return { async elementHandles() { return [breadcrumb, disabled, action]; } };
    },
  };
  assert.deepEqual(
    await runner.waitForCreateAnimatedClipsControl(page, { attempts: 1 }),
    { ok: true, control: action },
  );
  assert.equal(await runner.createAnimatedClipsControlIsUsable(action), true);

  const duplicate = {
    locator() { return { async elementHandles() { return [action, makeHandle()]; } }; },
  };
  assert.deepEqual(
    await runner.waitForCreateAnimatedClipsControl(duplicate, { attempts: 1 }),
    { ok: false, reason: "create_animated_clips_control_ambiguous" },
  );
});

test("the Animation Creator receives only the exact verified JPEG or PNG remaster bytes", () => {
  const jpeg = Buffer.alloc(20000, 0x44);
  Buffer.from([0xff, 0xd8, 0xff]).copy(jpeg);
  const jpegSha = crypto.createHash("sha256").update(jpeg).digest("hex");
  const jpegPayload = runner.exactOptimizedUploadPayload(jpeg, jpegSha);
  assert.equal(jpegPayload.name, `wss-remaster-${jpegSha.slice(0, 16)}.jpg`);
  assert.equal(jpegPayload.mimeType, "image/jpeg");
  assert.equal(jpegPayload.buffer, jpeg);

  const png = Buffer.alloc(20000, 0x55);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  const pngSha = crypto.createHash("sha256").update(png).digest("hex");
  assert.equal(runner.exactOptimizedUploadPayload(png, pngSha).mimeType, "image/png");
  assert.equal(runner.exactOptimizedUploadPayload(jpeg, "0".repeat(64)), null);

  const webp = Buffer.alloc(20000, 0x66);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  const webpSha = crypto.createHash("sha256").update(webp).digest("hex");
  assert.equal(runner.exactOptimizedUploadPayload(webp, webpSha), null);
});

test("direct mode uploads the exact raw JPEG and binds SHA, measured dimensions, provenance, and recipe", () => {
  const jpeg = jpegWithDimensions(1280, 720);
  const sha256 = crypto.createHash("sha256").update(jpeg).digest("hex");
  const direct = runner.directSourceState({
    heroImageWidth: 1280,
    heroImageHeight: 720,
    heroImageUrl: "https://client.example/van.jpg",
    heroImageProvenance: { verified: true, sourceUrl: "https://client.example/van.jpg" },
  }, { ok: true, bytes: jpeg, sha256 });

  assert.equal(direct.ok, true);
  assert.equal(direct.payload.name, `wss-source-${sha256.slice(0, 16)}.jpg`);
  assert.equal(direct.payload.buffer, jpeg, "the uploaded buffer must be the exact verified raw bytes");
  assert.deepEqual(runner.exactImageDimensions(jpeg), { width: 1280, height: 720 });
  assert.equal(direct.optimized.sha256, sha256);
  assert.equal(direct.optimized.urlFingerprint, `direct-source:${sha256}`);
  assert.deepEqual(
    { width: direct.remaster.assetIdentity.width, height: direct.remaster.assetIdentity.height },
    { width: 1280, height: 720 },
  );
  assert.equal(direct.remaster.optimizedSha256, sha256);
  assert.equal(direct.remaster.assetFingerprint, `direct-source:${sha256}`);
  assert.equal(direct.remaster.promptSha256, runner.DIRECT_SOURCE_RECIPE_SHA256);
  assert.equal(
    crypto.createHash("sha256").update(runner.DIRECT_SOURCE_RECIPE).digest("hex"),
    runner.DIRECT_SOURCE_RECIPE_SHA256,
  );

  assert.equal(runner.directSourceState({ heroImageWidth: 1279, heroImageHeight: 720 }, {
    ok: true, bytes: jpeg, sha256,
  }).reason, "direct_source_dimensions_mismatch");
  assert.equal(runner.directSourceState({ heroImageWidth: 1280 }, {
    ok: true, bytes: jpeg, sha256,
  }).reason, "direct_source_dimensions_required");

  const webp = Buffer.alloc(2048, 0x44);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  const webpSha = crypto.createHash("sha256").update(webp).digest("hex");
  assert.equal(runner.directSourceState({ heroImageWidth: 1280, heroImageHeight: 720 }, {
    ok: true, bytes: webp, sha256: webpSha,
  }).reason, "direct_source_format_invalid");
});

test("Save and close resolves Google's ACX portal pane", async () => {
  const harness = saveAndCloseDialogHarness([[
    { tagName: "MATERIAL-BUTTON", text: "Save and close", ariaLabel: "Save", portalSibling: true },
  ]], { overlayFlavor: "acx" });
  const result = await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 });
  assert.equal(result.ok, true);
  assert.ok(result.control);
  assert.equal(await runner.saveAndCloseControlIsUsable(result.overlay, result.dialog, result.control), true);
});

test("Save and close refuses an unrelated global duplicate", async () => {
  const harness = saveAndCloseDialogHarness([[
    { tagName: "BUTTON", text: "Save and close", portalSibling: true },
    { tagName: "BUTTON", role: "button", text: "Save and close", outside: true },
  ]]);
  assert.deepEqual(
    await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 }),
    {
      ok: false,
      reason: "optimized_asset_save_and_close_ambiguous",
      detail: {
        scope: "save_image_overlay", active_overlay_resolved: true,
        visible_exact_controls: 2, overlay_exact_controls: 1,
      },
    },
  );
});

test("Save and close refuses two exact controls in the same overlay", async () => {
  const harness = saveAndCloseDialogHarness([[
    { tagName: "BUTTON", role: "button", text: "Save and close", portalSibling: true },
    { tagName: "MATERIAL-BUTTON", text: "Save and close", portalSibling: true },
  ]]);
  assert.deepEqual(
    await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 }),
    {
      ok: false,
      reason: "optimized_asset_save_and_close_ambiguous",
      detail: {
        scope: "save_image_overlay", active_overlay_resolved: true,
        visible_exact_controls: 2, overlay_exact_controls: 2,
      },
    },
  );
});

test("Save and close refuses an unrelated exact control when its overlay has none", async () => {
  const harness = saveAndCloseDialogHarness([[
    { tagName: "BUTTON", text: "Save and close", outside: true },
  ]]);
  assert.deepEqual(
    await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 }),
    {
      ok: false,
      reason: "optimized_asset_save_and_close_not_found",
      detail: {
        scope: "save_image_overlay", active_overlay_resolved: true,
        visible_exact_controls: 1, overlay_exact_controls: 0,
      },
    },
  );
});

test("Save and close zero-match diagnostics contain counts only", async () => {
  const secret = "SECRET-client-url-and-prompt-must-not-leak";
  const harness = saveAndCloseDialogHarness([[
    { tagName: "BUTTON", text: secret, outside: true },
  ]]);
  const result = await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 });
  assert.deepEqual(
    result,
    {
      ok: false,
      reason: "optimized_asset_save_and_close_not_found",
      detail: {
        scope: "save_image_overlay", active_overlay_resolved: true,
        visible_exact_controls: 0, overlay_exact_controls: 0,
      },
    },
  );
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("Save and close refuses a detached or hidden active overlay", async () => {
  for (const mutate of ["detachDialog", "detachOverlay", "hideOverlay"]) {
    const harness = saveAndCloseDialogHarness([[
      { tagName: "BUTTON", text: "Save and close", portalSibling: true },
    ]]);
    harness[mutate]();
    assert.deepEqual(
      await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 }),
      {
        ok: false,
        reason: "optimized_asset_save_and_close_not_found",
        detail: {
          scope: "save_image_overlay", active_overlay_resolved: false,
          visible_exact_controls: 0, overlay_exact_controls: 0,
        },
      },
      mutate,
    );
  }
});

test("Save and close refuses detached and disabled fixed controls", async () => {
  for (const descriptor of [
    { tagName: "BUTTON", text: "Save and close", connected: false },
    { tagName: "MATERIAL-BUTTON", text: "Save and close", disabled: true },
    { tagName: "MATERIAL-BUTTON", text: "Save and close", disabledAttribute: true },
    { tagName: "MATERIAL-BUTTON", text: "Save and close", ariaDisabled: "true" },
  ]) {
    const harness = saveAndCloseDialogHarness([[descriptor]]);
    const result = await runner.waitForSaveAndCloseControl(harness.page, harness.dialog, { attempts: 1 });
    assert.deepEqual(
      result,
      {
        ok: false,
        reason: "optimized_asset_save_and_close_unusable",
        detail: {
          scope: "save_image_overlay", active_overlay_resolved: true,
          visible_exact_controls: 1, overlay_exact_controls: 1,
        },
      },
      JSON.stringify(descriptor),
    );
    assert.equal(
      await runner.saveAndCloseControlIsUsable(
        harness.overlayHandle,
        harness.dialogHandle,
        harness.controlHandle(),
      ),
      false,
      JSON.stringify(descriptor),
    );
  }
  const hidden = saveAndCloseDialogHarness([[
    { tagName: "MATERIAL-BUTTON", text: "Save and close", visible: false },
  ]]);
  assert.equal(
    await runner.saveAndCloseControlIsUsable(
      hidden.overlayHandle,
      hidden.dialogHandle,
      hidden.controlHandle(),
    ),
    false,
  );
});

test("the remastered DOM image must byte-match a post-Generate response", () => {
  const wanted = "a".repeat(64);
  const wrong = "b".repeat(64);
  assert.equal(runner.optimizedResponseMatchesSha([{
    url: "https://lh3.googleusercontent.com/asset/same-url.png",
    urlFingerprint: "lh3.googleusercontent.com/asset/same-url.png",
    sha256: wrong,
  }], wanted), false, "a reused URL cannot substitute for exact pixels");
  assert.equal(runner.optimizedResponseMatchesSha([{ sha256: wanted }], wanted), true);
});

test("horizontal selection ignores an active wizard panel and requires option state", () => {
  const unselectedOptionInsideActivePanel = [
    { isControl: true, className: "aspect-ratio-option" },
    { isControl: false, className: "wizard-panel active" },
  ];
  assert.equal(runner.selectionEvidenceIsSelected(unselectedOptionInsideActivePanel), false);

  assert.equal(runner.selectionEvidenceIsSelected([
    { isControl: true, ariaSelected: "true", className: "aspect-ratio-option" },
  ]), true);
  assert.equal(runner.selectionEvidenceIsSelected([
    { isControl: true, className: "aspect-ratio-option selected" },
  ]), true);
});

test("capture accepts only an MP4 with real magic and a measured duration", () => {
  const mp4 = fourSecondMp4();
  assert.equal(runner.hasMp4Magic(mp4), true);
  assert.equal(runner.hasMp4Magic(Buffer.from("<html>login</html>")), false);
  assert.equal(runner.hasMp4Magic(Buffer.from("RIFF....WEBP")), false);

  const valid = runner.validateMp4Bytes(mp4, { minDurationSeconds: 3, maxDurationSeconds: 6 });
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.durationSeconds, 4);

  const fake = runner.validateMp4Bytes(Buffer.from("video/mp4 but not an mp4"));
  assert.equal(fake.ok, false);
  assert.match(fake.reason, /mp4|magic/i);
});

test("only the selected Step 3 aria-controls panel supplies current, option, and structural clip media", async () => {
  const originalWindow = global.window;
  const view = { getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; } };
  const ownerDocument = { defaultView: view };
  const attrs = (values = {}) => ({
    isConnected: true, hidden: false, inert: false, ownerDocument,
    getAttribute(name) { return Object.hasOwn(values, name) ? values[name] : null; },
    getBoundingClientRect() { return { width: 640, height: 360 }; },
  });
  const image = (src, alt = "") => ({
    ...attrs({ alt }), tagName: "IMG", currentSrc: src, src, parentElement: null,
    querySelectorAll() { return []; },
  });
  const card = (role, label, media) => {
    const element = {
      ...attrs({ role, "aria-label": label }), parentElement: null,
      querySelectorAll(selector) { return selector === "img, video" ? [media] : []; },
    };
    media.parentElement = element;
    return element;
  };
  const current = image("https://tpc.googlesyndication.com/pimgad/current.avif");
  const option = image("https://tpc.googlesyndication.com/pimgad/option.avif");
  const structural = image("https://tpc.googlesyndication.com/pimgad/structural.avif", "Thumbnail preview for animated clip 3");
  const preview = image("https://tpc.googlesyndication.com/pimgad/preview.avif", "Preview of the animated image");
  const videoSource = "https://tpc.googlesyndication.com/pimgad/video-source.mp4";
  const video = {
    ...attrs(), tagName: "VIDEO", currentSrc: "", src: "", readyState: 4, duration: 5, parentElement: null,
    querySelectorAll(selector) { return selector === "source" ? [{ src: videoSource }] : []; },
  };
  const currentCard = card("listitem", "Animated clip 1, select to preview the animated clip", current);
  const optionCard = card("option", "Animated clip 2, select to preview the animated clip", option);
  const videoCard = card("listitem", "Animated clip 3, select to preview the animated clip", video);
  const region = {
    ...attrs(), parentElement: null,
    querySelectorAll(selector) {
      if (selector === "img, video") return [structural];
      return [];
    },
  };
  structural.parentElement = region;
  const heading = { ...attrs(), textContent: "Animated clips", parentElement: region };
  const panel = {
    ...attrs({ role: "tabpanel" }), id: "live-step-three", parentElement: null,
    querySelectorAll(selector) {
      if (selector.startsWith("animated-thumbnail")) return [currentCard];
      if (selector === '[role="listitem"], [role="option"]') return [currentCard, optionCard, videoCard];
      if (selector.includes("[role='heading']")) return [heading];
      if (selector.startsWith("button")) return [];
      return [];
    },
  };
  currentCard.parentElement = panel;
  optionCard.parentElement = panel;
  videoCard.parentElement = panel;
  region.parentElement = panel;
  preview.parentElement = panel;
  const decoyPanel = { ...attrs({ role: "tabpanel" }), id: "wrong-step", parentElement: null };
  const tab = {
    ...attrs({
      role: "tab",
      "aria-label": "Step 3 of 3, Create animated clips",
      "aria-controls": panel.id,
      "aria-selected": "true",
    }),
  };
  let evaluationError = "";
  const handle = (element) => ({
    async evaluate(callback, argument) {
      try { return callback(element, argument); }
      catch (error) { evaluationError = String(error && error.stack || error); throw error; }
    },
  });
  const page = {
    locator(selector) {
      return {
        async elementHandles() {
          return selector.includes("Step 3 of 3") ? [handle(tab)] : [handle(decoyPanel), handle(panel)];
        },
      };
    },
  };
  global.window = {};
  try {
    const descriptors = await runner.renderedMediaDescriptors(page);
    assert.deepEqual(
      descriptors.map((item) => item.src).sort(),
      [current.src, option.src, structural.src, videoSource].sort(),
      `${String(descriptors.reason || "")} ${evaluationError}`,
    );
    assert.deepEqual(descriptors.find((item) => item.src === videoSource).sources, [videoSource]);
    assert.equal(descriptors.some((item) => item.src === preview.src), false, "the panel preview is not a result card");
  } finally {
    global.window = originalWindow;
  }
});

test("same-URL clip media passes only when its post-click response bytes changed", async () => {
  const url = "https://tpc.googlesyndication.com/pimgad/reused-live-id";
  const fingerprint = "tpc.googlesyndication.com/pimgad/reused-live-id";
  const baselineBytes = Buffer.from("baseline-avif-bytes");
  const changedBytes = Buffer.from("changed-animated-avif-bytes");
  const clip = validHeroMp4();
  const run = async (responseBytes) => {
    let responseHandler = null;
    const media = [{
      kind: "image", src: url, sources: [], visible: true, postClick: true,
      lifecycle: {
        activeEpoch: 1, activatedAt: Date.now() - 100,
        baselineNode: true, fingerprintWasBaseline: true, fingerprint,
        insertedEpoch: 0, sourceMutatedEpoch: 1, loadedEpoch: 0,
      },
    }];
    const page = {
      on(event, handler) { if (event === "response") responseHandler = handler; },
      off() {},
      async evaluate(_callback, input) {
        if (input && typeof input === "object" && input.source === url) return baselineBytes.toString("base64");
        if (typeof input === "string") return { ok: true, readyState: 4, duration: 4 };
        return 0;
      },
    };
    let normalized = 0;
    const capture = createMediaCapture(page, {
      async renderedMediaDescriptorsImpl() { return media; },
      normalizeImpl(bytes) {
        normalized += 1;
        assert.deepEqual(bytes, changedBytes);
        return {
          ok: true, bytes: clip, normalized: true,
          originalSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          codec: "av1", inputVideoStreams: 1, streamIndex: 0,
        };
      },
    });
    await capture.arm({ async evaluate() { return { panelId: "step-three", baselineSources: [url] }; } });
    responseHandler({
      url: () => url,
      headers: () => ({ "content-type": "image/avif" }),
      body: async () => responseBytes,
    });
    const result = await capture.download({ timeoutMs: 80, pollMs: 0, stablePollsRequired: 0 });
    await capture.stop();
    return { result, normalized };
  };

  const unchanged = await run(baselineBytes);
  assert.equal(unchanged.result.ok, false);
  assert.equal(unchanged.result.reason, "clip_same_url_unchanged");
  assert.equal(unchanged.normalized, 0);

  const changed = await run(changedBytes);
  assert.equal(changed.result.ok, true, JSON.stringify(changed.result));
  assert.equal(changed.normalized, 1);
});

test("same blob clip media passes only when its fetched bytes changed from the baseline blob", async () => {
  const source = "blob:https://ads.google.com/exact-generated-clip";
  const baselineBytes = Buffer.from("baseline-blob-avif");
  const changedBytes = Buffer.from("changed-blob-avif");
  const clip = validHeroMp4();
  const run = async (postClickBytes) => {
    let fetches = 0;
    const media = [{
      kind: "image", src: source, sources: [], visible: true, postClick: true,
      lifecycle: {
        activeEpoch: 1, activatedAt: Date.now() - 100,
        baselineNode: true, fingerprintWasBaseline: true, fingerprint: source,
        insertedEpoch: 0, sourceMutatedEpoch: 1, loadedEpoch: 0,
      },
    }];
    const page = {
      on() {}, off() {},
      async evaluate(_callback, input) {
        if (input && typeof input === "object" && input.source === source) {
          fetches += 1;
          return (fetches === 1 ? baselineBytes : postClickBytes).toString("base64");
        }
        if (typeof input === "string") return { ok: true, readyState: 4, duration: 4 };
        return 0;
      },
    };
    let normalized = 0;
    const capture = createMediaCapture(page, {
      async renderedMediaDescriptorsImpl() { return media; },
      normalizeImpl(bytes) {
        normalized += 1;
        assert.deepEqual(bytes, changedBytes);
        return {
          ok: true, bytes: clip, normalized: true,
          originalSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          codec: "av1", inputVideoStreams: 1, streamIndex: 0,
        };
      },
    });
    await capture.arm({ async evaluate() { return { panelId: "step-three", baselineSources: [source] }; } });
    const result = await capture.download({ timeoutMs: 80, pollMs: 0, stablePollsRequired: 0 });
    await capture.stop();
    return { result, normalized };
  };

  const unchanged = await run(baselineBytes);
  assert.equal(unchanged.result.ok, false);
  assert.equal(unchanged.result.reason, "clip_same_blob_unchanged");
  assert.equal(unchanged.normalized, 0);

  const changed = await run(changedBytes);
  assert.equal(changed.result.ok, true, JSON.stringify(changed.result));
  assert.equal(changed.normalized, 1);
});

test("oversized DOM media streams are cancelled before buffering past 25 MB", async () => {
  const source = "blob:https://ads.google.com/oversized-generated-clip";
  let cancelled = 0;
  let arrayBufferCalls = 0;
  const page = {
    on() {}, off() {},
    async evaluate(callback, input) {
      if (!input || typeof input !== "object") return 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        let reads = 0;
        return {
          ok: true,
          headers: { get() { return ""; } },
          body: {
            getReader() {
              return {
                async read() {
                  reads += 1;
                  return reads === 1
                    ? { done: false, value: new Uint8Array((25 * 1024 * 1024) + 1) }
                    : { done: true };
                },
                async cancel() { cancelled += 1; },
                releaseLock() {},
              };
            },
          },
          async arrayBuffer() { arrayBufferCalls += 1; return new ArrayBuffer(0); },
        };
      };
      try { return await callback(input); }
      finally { globalThis.fetch = originalFetch; }
    },
  };
  const capture = createMediaCapture(page);
  const armed = await capture.arm({
    async evaluate() { return { panelId: "step-three", baselineSources: [source] }; },
  });
  await capture.stop();
  assert.equal(armed.ok, true);
  assert.equal(cancelled, 1);
  assert.equal(arrayBufferCalls, 0);
});

test("an oversized Playwright AVIF response is rejected before body is called", async () => {
  const url = "https://tpc.googlesyndication.com/pimgad/oversized-live-id";
  let responseHandler = null;
  let bodyCalls = 0;
  const media = [{
    kind: "image", src: url, sources: [], visible: true, postClick: true,
    lifecycle: {
      activeEpoch: 1, activatedAt: Date.now() - 100, baselineNode: false,
      fingerprintWasBaseline: false, fingerprint: "tpc.googlesyndication.com/pimgad/oversized-live-id",
      insertedEpoch: 1, sourceMutatedEpoch: 0, loadedEpoch: 0,
    },
  }];
  const page = {
    on(event, handler) { if (event === "response") responseHandler = handler; },
    off() {},
    async evaluate() { return 0; },
  };
  const capture = createMediaCapture(page, {
    async renderedMediaDescriptorsImpl() { return media; },
    normalizeImpl() { throw new Error("oversized response must never normalize"); },
  });
  await capture.arm({ async evaluate() { return { panelId: "step-three", baselineSources: [] }; } });
  responseHandler({
    url: () => url,
    headers: () => ({
      "content-type": "image/avif",
      "content-length": String((25 * 1024 * 1024) + 1),
    }),
    body() { bodyCalls += 1; return Promise.resolve(Buffer.alloc(0)); },
  });
  const result = await capture.download({ timeoutMs: 20, pollMs: 0, stablePollsRequired: 0 });
  await capture.stop();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "clip_response_not_correlated");
  assert.equal(bodyCalls, 0);
});

test("the final clip poll sleep never exceeds the remaining deadline", async () => {
  const page = { on() {}, off() {}, async evaluate() { return 0; } };
  const capture = createMediaCapture(page, {
    async renderedMediaDescriptorsImpl() { return []; },
  });
  await capture.arm({ async evaluate() { return { panelId: "step-three", baselineSources: [] }; } });
  const started = Date.now();
  const result = await capture.download({ timeoutMs: 20, pollMs: 5000 });
  await capture.stop();
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 250, "poll sleep escaped the clip deadline");
});

test("a hung post-click AVIF body is deadline-bounded and fails closed", async () => {
  const url = "https://tpc.googlesyndication.com/pimgad/hung.avif";
  let responseHandler = null;
  const media = [{
    kind: "image", src: url, sources: [], visible: true, postClick: true,
    lifecycle: {
      activeEpoch: 1, activatedAt: Date.now() - 100, baselineNode: false,
      fingerprintWasBaseline: false, fingerprint: "tpc.googlesyndication.com/pimgad/hung.avif",
      insertedEpoch: 1, sourceMutatedEpoch: 0, loadedEpoch: 0,
    },
  }];
  const page = {
    on(event, handler) { if (event === "response") responseHandler = handler; },
    off() {},
    async evaluate() { return 0; },
  };
  const capture = createMediaCapture(page, {
    async renderedMediaDescriptorsImpl() { return media; },
    normalizeImpl() { throw new Error("hung bytes must never normalize"); },
  });
  await capture.arm({ async evaluate() { return { panelId: "step-three", baselineSources: [] }; } });
  responseHandler({
    url: () => url,
    headers: () => ({ "content-type": "image/avif" }),
    body: () => new Promise(() => {}),
  });
  const started = Date.now();
  const result = await capture.download({ timeoutMs: 25, pollMs: 0, stablePollsRequired: 0 });
  await capture.stop();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "clip_response_body_unavailable");
  assert.ok(Date.now() - started < 250, "hung body escaped the clip deadline");
});

test("generated AVIF image cards are captured after Google stops rendering video elements", async () => {
  const generatedAvif = "https://tpc.googlesyndication.com/pimgad/151904629818";
  const avifBytes = Buffer.from("generated-animated-avif");
  const clip = validHeroMp4();
  let media = [];
  let responseHandler = null;
  const page = {
    on(event, handler) { if (event === "response") responseHandler = handler; },
    off() {},
    async evaluate(_callback, input) {
      if (input === undefined) return 0;
      return { ok: true, readyState: 4, duration: 4 };
    },
  };
  const capture = createMediaCapture(page, {
    async renderedMediaDescriptorsImpl() { return media; },
    normalizeImpl(bytes) {
      assert.deepEqual(bytes, avifBytes);
      return {
        ok: true,
        bytes: clip,
        normalized: true,
        originalSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        codec: "av1",
        inputVideoStreams: 1,
        streamIndex: 0,
      };
    },
  });

  await capture.arm({ async evaluate() { return true; } });
  // Google's response can finish before its generated-card DOM node mounts.
  // It must remain pending and later bind only to that exact post-click card.
  responseHandler({
    url: () => generatedAvif,
    headers: () => ({ "content-type": "image/avif" }),
    body: async () => avifBytes,
  });
  media = [{
    kind: "image", src: generatedAvif, sources: [], readyState: null,
    duration: null, visible: true,
    lifecycle: {
      activeEpoch: 1, activatedAt: Date.now() - 1, baselineNode: false, fingerprintWasBaseline: false,
      fingerprint: "tpc.googlesyndication.com/pimgad/151904629818",
      insertedEpoch: 1, sourceMutatedEpoch: 0, loadedEpoch: 0,
    },
    postClick: true,
  }];
  // This unit test proves response/card binding, not output-set stabilization.
  // Accept the first SHA-bound candidate so a busy full-suite worker cannot
  // exhaust an artificial 100 ms window between two otherwise identical polls.
  const result = await capture.download({ timeoutMs: 100, pollMs: 0, stablePollsRequired: 0 });
  await capture.stop();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.expectedCount, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].capture, "network-body");
  assert.equal(result.candidates[0].sha256, crypto.createHash("sha256").update(clip).digest("hex"));
});

test("live Step 2 create control arms the separate hidden Step 3 panel and fails closed on wrong ownership", async () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const OriginalMutationObserver = global.MutationObserver;
  let cards = [];
  let observerCallback = null;
  let clickListener = null;
  const loadListeners = new Set();
  const view = { getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; } };
  const ownerDocument = {
    defaultView: view,
    querySelectorAll(selector) { return global.document.querySelectorAll(selector); },
  };
  const makeCard = (src, { ariaHidden = false } = {}) => {
    const card = {
      nodeType: 1, isConnected: true, hidden: false, inert: false, parentElement: null, ownerDocument,
      getAttribute(name) {
        if (name === "aria-label") return "Animated clip 1/2, select to preview";
        if (name === "aria-hidden") return ariaHidden ? "true" : null;
        return null;
      },
      getBoundingClientRect() { return { width: 640, height: 360 }; },
      matches() { return false; },
      querySelectorAll() { return [item]; },
    };
    const item = {
      nodeType: 1, tagName: "IMG", isConnected: true, hidden: false, inert: false,
      currentSrc: src, src, parentElement: card, ownerDocument,
      getAttribute() { return null; },
      getBoundingClientRect() { return { width: 640, height: 360 }; },
      matches(selector) { return selector === "img, video"; },
      closest(selector) { return selector === "animated-thumbnail[role='listitem']" ? card : null; },
      querySelectorAll() { return []; },
    };
    return { card, item };
  };
  const baseline = makeCard("https://tpc.googlesyndication.com/pimgad/old?sig=one");
  cards = [baseline.card];
  const panel = {
    id: "step-three-panel", isConnected: true, hidden: true, inert: false, parentElement: null, ownerDocument,
    getAttribute(name) { return name === "role" ? "tabpanel" : null; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    querySelectorAll(selector) {
      if (selector.includes("h1")) return [];
      if (selector.includes("animated-thumbnail") || selector.includes("[role=")) return cards;
      return cards.flatMap((card) => card.querySelectorAll("img, video"));
    },
  };
  const stepThreeTab = {
    isConnected: true, ownerDocument,
    getAttribute(name) {
      if (name === "role") return "tab";
      if (name === "aria-controls") return panel.id;
      if (name === "aria-label") return "Step 3 of 3, Create animated clips";
      if (name === "aria-selected") return "false";
      return null;
    },
  };
  baseline.card.parentElement = panel;
  const stepTwoPanel = {
    id: "step-two-panel", isConnected: true, hidden: false, inert: false, ownerDocument,
    getAttribute(name) { return name === "role" ? "tabpanel" : null; },
    getBoundingClientRect() { return { width: 800, height: 600 }; },
  };
  const stepTwoTab = {
    isConnected: true, ownerDocument,
    getBoundingClientRect() { return { width: 220, height: 48 }; },
    getAttribute(name) {
      if (name === "role") return "tab";
      if (name === "aria-controls") return stepTwoPanel.id;
      if (name === "aria-label") return "Step 2 of 3, Choose enhanced images";
      if (name === "aria-selected") return "true";
      return null;
    },
  };
  const createElement = {
    isConnected: true, tagName: "MATERIAL-BUTTON", innerText: "Create animated clips",
    textContent: "Create animated clips", disabled: false, ownerDocument,
    closest(selector) { return selector === '[role="tabpanel"]' ? stepTwoPanel : null; },
    getBoundingClientRect() { return { width: 220, height: 48 }; },
    hasAttribute() { return false; },
    getAttribute() { return null; },
    addEventListener(event, listener) { if (event === "click") clickListener = listener; },
    removeEventListener(event, listener) { if (event === "click" && clickListener === listener) clickListener = null; },
  };
  global.window = {};
  global.document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]') return [stepTwoTab];
      if (selector === '[role="tab"][aria-label="Step 3 of 3, Create animated clips"]') return [stepThreeTab];
      if (selector === '[role="tabpanel"]') return [stepTwoPanel, panel];
      return [];
    },
    addEventListener(event, listener) { if (event === "load") loadListeners.add(listener); },
    removeEventListener(event, listener) { if (event === "load") loadListeners.delete(listener); },
  };
  global.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    takeRecords() { return []; }
    disconnect() {}
  };
  try {
    const control = { async evaluate(callback) { return callback(createElement); } };
    const handle = (element) => ({
      async evaluate(callback, argument) { return callback(element, argument); },
    });
    const targetPanelHandle = {
      async evaluate(callback, argument) {
        return callback(panel, argument === control ? createElement : argument);
      },
    };
    const targetPage = {
      locator(selector) {
        return {
          async elementHandles() {
            return selector.includes("Step 3 of 3")
              ? [handle(stepThreeTab)] : [handle(stepTwoPanel), targetPanelHandle];
          },
        };
      },
    };
    const target = await runner.resolveAnimationStepThreeTarget(targetPage);
    assert.equal(target.ok, true, JSON.stringify(target));
    assert.equal(target.panelId, panel.id);
    const ambiguousTargetPage = {
      locator(selector) {
        return { async elementHandles() {
          return selector.includes("Step 3 of 3")
            ? [handle(stepThreeTab)] : [targetPanelHandle, targetPanelHandle];
        } };
      },
    };
    assert.equal((await runner.resolveAnimationStepThreeTarget(ambiguousTargetPage)).reason,
      "clip_step3_target_panel_ambiguous");
    assert.equal(await runner.createAnimatedClipsControlIsUsable(control), true);
    const result = await runner.armGeneratedMediaBaseline(control, target);
    assert.equal(result.ok, true);
    assert.equal(result.panelId, panel.id);
    clickListener();

    global.document.querySelectorAll = (selector) => {
      if (selector === '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]') return [stepTwoTab, stepTwoTab];
      if (selector === '[role="tab"][aria-label="Step 3 of 3, Create animated clips"]') return [stepThreeTab];
      if (selector === '[role="tabpanel"]') return [stepTwoPanel, panel];
      return [];
    };
    assert.equal(await runner.createAnimatedClipsControlIsUsable(control), false, "duplicate exact Step 2 ownership must fail closed");
    assert.equal((await runner.armGeneratedMediaBaseline(control, target)).ok, false);
    global.document.querySelectorAll = (selector) => {
      if (selector === '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]') return [{ ...stepTwoTab, getAttribute(name) { return name === "aria-controls" ? "wrong-panel" : stepTwoTab.getAttribute(name); } }];
      if (selector === '[role="tab"][aria-label="Step 3 of 3, Create animated clips"]') return [stepThreeTab];
      if (selector === '[role="tabpanel"]') return [stepTwoPanel, panel];
      return [];
    };
    assert.equal(await runner.createAnimatedClipsControlIsUsable(control), false, "wrong Step 2 panel ownership must fail closed");

    baseline.item.currentSrc = "https://tpc.googlesyndication.com/pimgad/new?sig=two";
    baseline.item.src = baseline.item.currentSrc;
    observerCallback([{ type: "attributes", target: baseline.item }]);
    const lifecycleFor = (item) => {
      const state = global.window.__wssAdsGeneratedMediaLifecycle;
      const fingerprint = state.fingerprint(item.currentSrc || item.src || "");
      return {
        activeEpoch: state.activeEpoch,
        baselineNode: state.baselineNodes.has(item),
        fingerprintWasBaseline: state.baselineFingerprints.has(fingerprint),
        fingerprint,
        insertedEpoch: state.insertedEpoch.get(item) || 0,
        sourceMutatedEpoch: state.sourceMutatedEpoch.get(item) || 0,
        loadedEpoch: state.loadedEpoch.get(item) || 0,
      };
    };
    assert.equal(runner.animationMediaChangedAfterClick({
      visible: true, src: baseline.item.src, lifecycle: lifecycleFor(baseline.item),
    }), true, "a post-click same-node src mutation must pass");

    const staleClone = makeCard("https://tpc.googlesyndication.com/pimgad/old?sig=resigned");
    staleClone.card.parentElement = panel;
    cards.push(staleClone.card);
    observerCallback([{ type: "childList", addedNodes: [staleClone.card] }]);
    const staleLifecycle = lifecycleFor(staleClone.item);
    assert.equal(staleLifecycle.insertedEpoch, 1);
    assert.equal(staleLifecycle.fingerprintWasBaseline, true);
    assert.equal(runner.animationMediaChangedAfterClick({
      visible: true, src: staleClone.item.src, lifecycle: staleLifecycle,
    }), false, "a re-signed baseline URL clone must remain stale");

    const hidden = makeCard("https://tpc.googlesyndication.com/pimgad/brand-new", { ariaHidden: true });
    hidden.card.parentElement = panel;
    cards.push(hidden.card);
    observerCallback([{ type: "childList", addedNodes: [hidden.card] }]);
    assert.equal(runner.animationMediaChangedAfterClick({
      visible: false, src: hidden.item.src, lifecycle: lifecycleFor(hidden.item),
    }), false, "an aria-hidden card must never capture");
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
    global.MutationObserver = OriginalMutationObserver;
  }
});

test("pre-click or hidden animation cards never become clip candidates", async () => {
  const generatedAvif = "https://tpc.googlesyndication.com/pimgad/stale";
  let responseHandler = null;
  const staleMedia = [{
    kind: "image", src: generatedAvif, sources: [], visible: true, postClick: false,
  }];
  const page = {
    on(event, handler) { if (event === "response") responseHandler = handler; },
    off() {},
    async evaluate() { return 0; },
  };
  const capture = createMediaCapture(page, {
    async renderedMediaDescriptorsImpl() { return staleMedia; },
    normalizeImpl() { throw new Error("stale card must not normalize"); },
  });
  await capture.arm({ async evaluate() { return true; } });
  responseHandler({
    url: () => generatedAvif,
    headers: () => ({ "content-type": "image/avif" }),
    body: async () => Buffer.from("stale"),
  });
  const result = await capture.download({ timeoutMs: 5, pollMs: 0, stablePollsRequired: 1 });
  await capture.stop();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "clip_result_stale");
});

test("the live dual-stream AVIF selects its five-second motion stream", () => {
  const plan = runner.candidateStreamPlan({
    format: { duration: "5.000000" },
    streams: [
      // The live preview has no stream duration. It must not inherit the
      // five-second container duration and outrank the actual animation.
      { index: 0, codec_type: "video", codec_name: "av1", width: 1280, height: 670, nb_frames: "1", avg_frame_rate: "1/1" },
      { index: 1, codec_type: "video", codec_name: "av1", width: 1280, height: 670, nb_frames: "120", avg_frame_rate: "24/1", duration: "5.000000" },
    ],
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.streamIndex, 1);
  assert.equal(plan.durationSeconds, 5);
  assert.equal(plan.normalize, true);
  const args = runner.ffmpegNormalizationArgs("in.avif", "out.mp4", plan);
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "0:1"]);
});

test("animation launch retries only the exact scoped Create animated clips control", async () => {
  const labels = [];
  let waits = 0;
  let forceClicks = 0;
  const control = {};
  const page = { url: () => "https://ads.google.com/aw/assetstudio/animationcreator?ocid=1&uscid=1&authuser=0" };
  const result = await runner.startAnimationGeneration(page, control, "ocid=1&uscid=1&authuser=0", {
    evidenceImpl: async () => ({ cardCount: 0, creatingVisible: false, progressVisible: false }),
    clickImpl: async (_control, label) => { labels.push(label); return "pointer"; },
    waitImpl: async () => (++waits === 1 ? { ok: false } : { ok: true }),
    findImpl: async () => ({ ok: true, control }),
    usableImpl: async () => true,
    forceClickImpl: async (_control, label) => { labels.push(label); forceClicks += 1; return "forced-pointer"; },
  });
  assert.deepEqual(result, { ok: true, retried: true });
  assert.equal(forceClicks, 1);
  assert.deepEqual(labels, ["create animated clips", "create animated clips"]);
  assert.equal(labels.some((label) => /start here|save/i.test(label)), false);
});

test("a rendered clip never uploads automatically; approval is exact and SHA-bound", () => {
  const clip = fourSecondMp4();
  const sha256 = crypto.createHash("sha256").update(clip).digest("hex");
  const candidate = { sha256, clipPath: "C:/tmp/client-clip.mp4" };

  assert.equal(runner.validateClipApproval(null, candidate).reason, "clip_approval_required");
  assert.equal(
    runner.validateClipApproval({ approved: true }, candidate).reason,
    "clip_approval_identity_required",
  );
  assert.equal(
    runner.validateClipApproval({ approved: true, sha256: "f".repeat(64) }, candidate).reason,
    "approved_clip_sha_mismatch",
  );
  assert.equal(runner.validateClipApproval({ approved: true, sha256 }, candidate).ok, true);
});

test("the source closes the original async capture hole", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "ads-station", "animate-image-runner.cjs"), "utf8");
  assert.doesNotMatch(src, /const\s+\w+\s*=\s*captureClip\s*\([^;]+\)\s*;[\s\S]{0,400}\b\1\.download\s*\(/,
    "captureClip was treated as a finished capture instead of awaited work");
  assert.match(src, /await\s+(?:captureClip\s*\(|\w+\.download\s*\()/,
    "the rendered clip bytes must settle before the verdict can be emitted");
  assert.doesNotMatch(src, /\bbrowser\s*\.\s*close\s*\(/,
    "a CDP runner must never close the owner's browser");
  assert.doesNotMatch(src, /JSON\.stringify\s*\(\s*storageState|writeFileSync\s*\([^\n]*storageState|console\.[a-z]+\s*\([^\n]*storageState/i,
    "authenticated browser state must remain in memory and must never be serialized or logged");
  const activateAt = src.indexOf("const activate = () => {");
  const takeRecordsAt = src.indexOf("observer.takeRecords();", activateAt);
  const activateEpochAt = src.indexOf("state.activeEpoch += 1;", activateAt);
  assert.notEqual(activateAt, -1, "click-epoch activation must exist");
  assert.notEqual(takeRecordsAt, -1, "queued pre-click mutations must be discarded");
  assert.notEqual(activateEpochAt, -1, "click epoch must activate");
  assert.ok(takeRecordsAt < activateEpochAt, "pre-click records must clear before the click epoch activates");
});

test("CLI main emits one JSON verdict and exits with an active CDP-style handle", () => {
  const runnerPath = path.join(__dirname, "..", "scripts", "ads-station", "animate-image-runner.cjs");
  const verdict = { ok: false, status: "awaiting_review", reason: "clip_approval_required" };
  const script = [
    `const runner = require(${JSON.stringify(runnerPath)});`,
    "setInterval(() => {}, 1000);",
    `runner.main({ argv: ["node", "animate-image-runner.cjs", "--observe"], runJobImpl: async () => (${JSON.stringify(verdict)}) });`,
  ].join("\n");
  const child = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 2500,
  });

  assert.equal(child.error, undefined, child.error && child.error.message);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout.trim()), verdict);
});
