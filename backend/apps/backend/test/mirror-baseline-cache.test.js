"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveDonor, loadDonor, donorBaselineCacheIdentity } = require("../lib/mirror-engine/donor");
const { renderAuditOnce } = require("../lib/mirror-engine/verify");
const {
  baselineTargetsFor,
  resetBaselineMeasurementsForTest,
} = require("../lib/mirror-engine/baseline-cache");

function normalAuditInfo() {
  const text = "Drain cleaning and water heater repair are available for local homes. Contact the plumbing team for scheduling details and service information.";
  return {
    text,
    prose_text: text,
    verbatim_blocks: 0,
    injected_sections: 0,
    injected_sections_in_markup: 0,
    content_channels: {
      services: {
        supplied: 1,
        _expected: ["drain cleaning"],
        _target_text: "Drain Cleaning",
        target_checked: true,
        targets_expected: 1,
        targets_found: 1,
      },
      faqs: {
        supplied: 1,
        _expected: ["do you offer drain cleaning"],
        _target_text: "Do you offer drain cleaning?",
        target_checked: true,
        targets_expected: 1,
        targets_found: 1,
      },
    },
    title: "Acme Plumbing",
    h1: "Acme Plumbing",
    h1_count: 1,
    found: [],
  };
}

function fakeLaunch(counter) {
  return async () => {
    let pageNumber = 0;
    return {
      newPage: async () => {
        pageNumber += 1;
        if (pageNumber === 1) {
          return {
            on() {},
            goto: async () => ({ status: () => 200 }),
            evaluate: async () => normalAuditInfo(),
          };
        }
        return {
          on() {},
          addInitScript: async () => {},
          goto: async () => {
            counter.baselineRenders += 1;
            return { status: () => 200 };
          },
          evaluate: async (_fn, channelTargets) => Object.fromEntries(
            Object.entries(channelTargets).map(([channel, selectors]) => [channel, {
              _baseline_target_text: "",
              baseline_checked: true,
              baseline_targets_found: Array.isArray(selectors) && selectors.length ? 1 : 0,
            }]),
          ),
        };
      },
      close: async () => {},
    };
  };
}

test("repeated builds reuse one donor empty-baseline render and keep the exact audit verdict", async () => {
  resetBaselineMeasurementsForTest();
  const donor = resolveDonor({ donor: "plumbing-clean", industry: "plumbing" });
  assert.equal(donor.ok, true);
  const loaded = loadDonor(donor.dir);
  assert.ok(loaded.contentHash);
  assert.deepEqual(donorBaselineCacheIdentity(donor.manifest.content_render_targets), {
    donorId: "plumbing-clean",
    donorVersion: "2026-08-16",
    donorHash: loaded.contentHash,
  });

  const counter = { baselineRenders: 0 };
  const options = {
    paths: ["/"],
    contentRenderTargets: donor.manifest.content_render_targets,
    launch: fakeLaunch(counter),
  };

  const uncached = await renderAuditOnce("https://mirror.test", options);
  const cached = await renderAuditOnce("https://mirror.test", options);

  assert.equal(counter.baselineRenders, 1, "the same donor+channel baseline must render only once");
  assert.deepEqual(cached, uncached, "cached and uncached route_render verdict/evidence must be identical");
  assert.equal(cached.status, "passed");
  assert.deepEqual(cached.pages[0].content_channels, {
    services: {
      supplied: 1,
      rendered: 1,
      target_checked: true,
      baseline_checked: true,
      target_changed: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
    faqs: {
      supplied: 1,
      rendered: 1,
      target_checked: true,
      baseline_checked: true,
      target_changed: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
  });
});

test("donor content-hash changes invalidate the cached baseline", async () => {
  resetBaselineMeasurementsForTest();
  const contentTargets = { services: ["section#services"] };
  const measurement = {
    services: {
      _baseline_target_text: "Template service",
      baseline_checked: true,
      baseline_targets_found: 1,
    },
  };
  let renders = 0;
  const measure = async () => {
    renders += 1;
    return measurement;
  };

  const common = { donorId: "plumbing-clean", donorVersion: "2026-08-16" };
  await baselineTargetsFor({ identity: { ...common, donorHash: "tree-a" }, path: "/", contentTargets, measure });
  await baselineTargetsFor({ identity: { ...common, donorHash: "tree-a" }, path: "/", contentTargets, measure });
  await baselineTargetsFor({ identity: { ...common, donorHash: "tree-b" }, path: "/", contentTargets, measure });

  assert.equal(renders, 2, "same hash hits once; changed donor tree hash must miss");
});
