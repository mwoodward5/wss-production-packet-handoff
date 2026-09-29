"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_SEND_RATE_PER_MINUTE,
  MAX_SEND_RATE_PER_MINUTE,
  MIN_SEND_RATE_PER_MINUTE,
  createSerializedSendLimiter,
  normalizeSendRate,
  prospectSendsEnabled,
  sendIntervalMs,
  sendRatePerMinute,
} = require("../lib/send-policy");

test("prospect delivery is default-off and requires an explicit positive flag", () => {
  for (const value of [undefined, null, "", "0", "false", "no", "off", "unexpected"]) {
    assert.equal(
      prospectSendsEnabled({ GHOST_AGENCY_PROSPECT_SEND_ENABLED: value }),
      false,
      `expected ${String(value)} to keep prospect sends disabled`,
    );
  }

  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(
      prospectSendsEnabled({ GHOST_AGENCY_PROSPECT_SEND_ENABLED: value }),
      true,
      `expected ${value} to enable prospect sends`,
    );
  }
});

test("SEND_RATE means emails per minute, defaults to 10, and clamps to 1-60", () => {
  assert.equal(sendRatePerMinute({}), DEFAULT_SEND_RATE_PER_MINUTE);
  assert.equal(sendRatePerMinute({ SEND_RATE: "" }), DEFAULT_SEND_RATE_PER_MINUTE);
  assert.equal(sendRatePerMinute({ SEND_RATE: "not-a-number" }), DEFAULT_SEND_RATE_PER_MINUTE);
  assert.equal(sendRatePerMinute({ SEND_RATE: "0" }), MIN_SEND_RATE_PER_MINUTE);
  assert.equal(sendRatePerMinute({ SEND_RATE: "-20" }), MIN_SEND_RATE_PER_MINUTE);
  assert.equal(sendRatePerMinute({ SEND_RATE: "12.9" }), 12);
  assert.equal(sendRatePerMinute({ SEND_RATE: "999" }), MAX_SEND_RATE_PER_MINUTE);
  assert.equal(normalizeSendRate(Number.POSITIVE_INFINITY), DEFAULT_SEND_RATE_PER_MINUTE);
  assert.equal(sendIntervalMs(10), 6_000);
  assert.equal(sendIntervalMs(60), 1_000);
  assert.equal(sendIntervalMs(1), 60_000);
});

test("the limiter serializes concurrent callers at the configured start rate", async () => {
  let clock = 0;
  const sleeps = [];
  const limiter = createSerializedSendLimiter({
    getRate: () => 10,
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
  });

  const slots = await Promise.all([
    limiter.waitForSlot(),
    limiter.waitForSlot(),
    limiter.waitForSlot(),
  ]);

  assert.deepEqual(slots.map((slot) => slot.acquiredAt), [0, 6_000, 12_000]);
  assert.deepEqual(slots.map((slot) => slot.waitedMs), [0, 6_000, 6_000]);
  assert.deepEqual(sleeps, [6_000, 6_000]);
});

test("an idle limiter starts immediately and reads the rate for each new slot", async () => {
  let clock = 0;
  let rate = 10;
  const sleeps = [];
  const limiter = createSerializedSendLimiter({
    getRate: () => rate,
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
  });

  const first = await limiter.waitForSlot();
  rate = 60;
  const second = await limiter.waitForSlot();
  clock = 30_000;
  const afterIdle = await limiter.waitForSlot();

  assert.deepEqual(
    [first.acquiredAt, second.acquiredAt, afterIdle.acquiredAt],
    [0, 6_000, 30_000],
  );
  assert.deepEqual(sleeps, [6_000]);
  assert.equal(second.ratePerMinute, 60);
  assert.equal(second.intervalMs, 1_000);
  assert.equal(afterIdle.waitedMs, 0);
});

test("one failed sleeper does not poison later serialized slot requests", async () => {
  let clock = 0;
  let failOnce = true;
  const limiter = createSerializedSendLimiter({
    getRate: () => 10,
    now: () => clock,
    sleep: async (milliseconds) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("sleep failed");
      }
      clock += milliseconds;
    },
  });

  await limiter.waitForSlot();
  await assert.rejects(limiter.waitForSlot(), /sleep failed/);
  const recovered = await limiter.waitForSlot();

  assert.equal(recovered.acquiredAt, 6_000);
  assert.equal(recovered.waitedMs, 6_000);
});
