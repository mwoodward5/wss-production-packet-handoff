"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { consoleOrbitHtml } = require("../lib/console-orbit");

test("Command Center depth layer is GPU-backed, local, pointer-transparent and motion-safe", () => {
  assert.match(consoleOrbitHtml, /id="wss-command-orbit"/);
  assert.match(consoleOrbitHtml, /getContext\("webgl"/);
  assert.match(consoleOrbitHtml, /pointer-events:none/);
  assert.match(consoleOrbitHtml, /prefers-reduced-motion/);
  assert.match(consoleOrbitHtml, /document\.hidden/);
  assert.match(consoleOrbitHtml, /data-fallback/);
  assert.doesNotMatch(consoleOrbitHtml, /https?:\/\//);
});

test("the approved Command Center page actually mounts the depth layer", () => {
  const page = require("../lib/console-page");
  assert.match(page, /wss-command-orbit/);
  assert.match(page, /id="laneMode"/);
  assert.match(page, /data-n="50"/);
});
