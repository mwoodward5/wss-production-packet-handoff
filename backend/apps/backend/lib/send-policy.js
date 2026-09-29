"use strict";

const DEFAULT_SEND_RATE_PER_MINUTE = 10;
const MIN_SEND_RATE_PER_MINUTE = 1;
const MAX_SEND_RATE_PER_MINUTE = 60;

function positiveFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

// Live prospect delivery is fail-closed. An absent, empty, malformed, or
// explicitly false value keeps the system in its owner-only proof posture.
function prospectSendsEnabled(env = process.env) {
  return positiveFlag(env?.GHOST_AGENCY_PROSPECT_SEND_ENABLED);
}

function normalizeSendRate(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_SEND_RATE_PER_MINUTE;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SEND_RATE_PER_MINUTE;
  return Math.min(
    MAX_SEND_RATE_PER_MINUTE,
    Math.max(MIN_SEND_RATE_PER_MINUTE, Math.floor(parsed)),
  );
}

// SEND_RATE is the maximum number of live prospect messages started per minute.
function sendRatePerMinute(env = process.env) {
  return normalizeSendRate(env?.SEND_RATE);
}

function sendIntervalMs(ratePerMinute = DEFAULT_SEND_RATE_PER_MINUTE) {
  return Math.ceil(60_000 / normalizeSendRate(ratePerMinute));
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Serialize slot acquisition inside one warm server process. This deliberately
// controls provider start times rather than caller completion times, so a batch
// cannot burst merely because several callers request a slot concurrently.
// Durable/global coordination is outside this helper's scope.
function createSerializedSendLimiter({
  getRate = () => sendRatePerMinute(),
  now = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  let tail = Promise.resolve();
  let nextSlotAt = 0;

  function waitForSlot() {
    const turn = tail.then(async () => {
      const ratePerMinute = normalizeSendRate(getRate());
      const intervalMs = sendIntervalMs(ratePerMinute);
      const before = Number(now());
      const current = Number.isFinite(before) ? before : Date.now();
      const waitedMs = Math.max(0, Math.ceil(nextSlotAt - current));

      if (waitedMs > 0) await sleep(waitedMs);

      const after = Number(now());
      const acquiredAt = Number.isFinite(after)
        ? Math.max(after, current + waitedMs)
        : current + waitedMs;
      nextSlotAt = Math.max(nextSlotAt, acquiredAt) + intervalMs;

      return {
        ratePerMinute,
        intervalMs,
        waitedMs,
        acquiredAt,
      };
    });

    // A failed waiter must reject to its own caller without poisoning every
    // later slot request in this process.
    tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  return Object.freeze({ waitForSlot });
}

const processSendLimiter = createSerializedSendLimiter();

function waitForProspectSendSlot() {
  return processSendLimiter.waitForSlot();
}

module.exports = {
  DEFAULT_SEND_RATE_PER_MINUTE,
  MIN_SEND_RATE_PER_MINUTE,
  MAX_SEND_RATE_PER_MINUTE,
  createSerializedSendLimiter,
  normalizeSendRate,
  prospectSendsEnabled,
  sendIntervalMs,
  sendRatePerMinute,
  waitForProspectSendSlot,
};
