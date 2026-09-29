"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { contentFloorReport } = require("../lib/mirror-lane-build");

test("appended sections cannot hide a failed donor-native services route proof", () => {
  const out = contentFloorReport(
    {
      services: [{ name: "Drain cleaning" }],
      reviews: [{ text: "The crew arrived on time." }],
    },
    {
      checks: {
        content: {
          status: "injected",
          sections: 1,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              services: {
                supplied: 1,
                rendered: 0,
                target_checked: true,
                baseline_checked: true,
                target_changed: false,
              },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.sections, 1, "the unrelated appended section is still measured");
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.deepEqual(out.native_channels_unproven, ["services"]);
  assert.match(out.reason, /did not prove it visible/);
});

test("an appended section cannot hide a failed donor-native FAQ route proof", () => {
  const out = contentFloorReport(
    {
      faqs: [{ q: "Do you offer estimates?", a: "Call to discuss the job." }],
      about: "Locally operated.",
    },
    {
      checks: {
        content: {
          status: "injected",
          sections: 1,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["faq"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              faqs: {
                supplied: 1,
                rendered: 0,
                target_checked: true,
                baseline_checked: true,
                target_changed: false,
              },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.deepEqual(out.native_channels_unproven, ["faqs"]);
});

test("all supplied donor-native channels pass only when each has route proof", () => {
  const proven = {
    supplied: 1,
    rendered: 1,
    target_checked: true,
    baseline_checked: true,
    target_changed: true,
  };
  const out = contentFloorReport(
    {
      services: [{ name: "Drain cleaning" }],
      faqs: [{ q: "Do you offer estimates?", a: "Call to discuss the job." }],
    },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services", "faq"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              services: { ...proven },
              faqs: { ...proven },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.status, "passed");
  assert.equal(out.verdict, "met");
  assert.equal(out.render_mode, "donor_native");
  assert.deepEqual(out.native_channels, ["services", "faqs"]);
});

test("an appended channel still passes when the donor claims none of the supplied content", () => {
  const out = contentFloorReport(
    { reviews: [{ text: "The crew arrived on time." }] },
    {
      checks: {
        content: {
          status: "injected",
          sections: 1,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services", "faq"],
        },
      },
    },
  );

  assert.equal(out.status, "passed");
  assert.equal(out.verdict, "met");
  assert.equal(out.sections, 1);
  assert.equal(out.render_mode, undefined);
});

// HAYS ROOFING, 2026-08-31: five supplied channels, photos, NAP and a verified
// Genie compile died because the roofing donor's manifest declared
// `renders: ["services","faq"]` while `content_render_targets` named only
// `services`. The FAQ channel had no selector to prove, so `target_checked`
// was false BY CONSTRUCTION and the whole build went not_revealable. The bar
// stays (a claimed channel must be proven); the sentence now names the exact
// broken link so the next manifest gap is readable from the row alone.
test("a claimed channel with no declared audit target fails naming the manifest gap", () => {
  const proven = {
    supplied: 3,
    rendered: 3,
    target_checked: true,
    baseline_checked: true,
    target_changed: true,
    targets_expected: 1,
    targets_found: 1,
  };
  const out = contentFloorReport(
    {
      services: [{ name: "Roof replacement" }, { name: "Gutter repair" }, { name: "Storm repair" }],
      reviews: [{ text: "Great work." }],
      hours: [{ day: "Monday", hours: "8-5" }],
      faqs: [{ q: "Free estimates?", a: "Yes." }],
      about: "Family owned.",
    },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services", "faq"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              services: { ...proven },
              faqs: {
                supplied: 1,
                rendered: 0,
                target_checked: false,
                baseline_checked: false,
                target_changed: false,
                targets_expected: 0,
                targets_found: 0,
              },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.deepEqual(out.native_channels_unproven, ["faqs"]);
  assert.equal(out.native_channels_why.faqs, "no_target_declared");
  assert.match(out.diagnostic, /native_unproven:faqs\(no_target_declared\)/,
    "the row's parenthetical must name the channel and the manifest gap");
  assert.match(out.reason, /no_target_declared/);
});

test("a claimed channel whose declared selector matched nothing names a stale selector", () => {
  const out = contentFloorReport(
    { faqs: [{ q: "Free estimates?", a: "Yes." }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["faq"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              faqs: {
                supplied: 1,
                rendered: 0,
                target_checked: false,
                baseline_checked: false,
                target_changed: false,
                targets_expected: 1,
                targets_found: 0,
              },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.status, "failed");
  assert.equal(out.native_channels_why.faqs, "target_not_found");
  assert.match(out.diagnostic, /faqs\(target_not_found\)/);
});

test("when the native proof never ran, the reason names the failed precondition", () => {
  const out = contentFloorReport(
    { services: [{ name: "Roof replacement" }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services"],
        },
        route_render: {
          status: "unavailable",
          pages: [],
        },
      },
    },
  );

  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.deepEqual(out.native_channels_unproven, ["services"]);
  assert.deepEqual(out.native_preconditions, ["route_render:unavailable"]);
  assert.match(out.reason, /native proof never ran/);
  assert.match(out.reason, /route_render:unavailable/);
  assert.match(out.diagnostic, /@route_render:unavailable/);
});

test("a proven donor-native pass names its channels in the diagnostic", () => {
  const proven = {
    supplied: 1,
    rendered: 1,
    target_checked: true,
    baseline_checked: true,
    target_changed: true,
  };
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }], faqs: [{ q: "Estimates?", a: "Free." }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services", "faq"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: {
              services: { ...proven },
              faqs: { ...proven },
            },
          }],
        },
      },
    },
  );

  assert.equal(out.status, "passed");
  assert.equal(out.render_mode, "donor_native");
  assert.match(out.diagnostic, /native:services\+faqs/);
});
