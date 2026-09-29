"use strict";

// Private Vercel Queue consumer. `experimentalTriggers` in vercel.json makes
// this function unreachable from the public internet.
const { createLineQueueConsumer } = require("../../lib/line-queue");

function loadContinuation() {
  // Human-first production wrapper: preserves the proven durable timing/truth
  // gates while making the newest active Practice run own the factory.
  // Kept lazy so deployment loading never starts Line work and so the service
  // can import the producer without a CommonJS initialization cycle.
  return require("../../lib/line-continuation-human");
}

function createLineBatchQueueHandler(dependencies = {}) {
  return createLineQueueConsumer({
    ...dependencies,
    loadContinuation: dependencies.loadContinuation || loadContinuation,
  });
}

module.exports = createLineBatchQueueHandler();
module.exports.createLineBatchQueueHandler = createLineBatchQueueHandler;
module.exports.loadContinuation = loadContinuation;
