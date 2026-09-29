import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

test("app server serves supported video containers with video MIME types", () => {
  const cases = [
    ['".mp4": "video/mp4"'],
    ['".m4v": "video/x-m4v"'],
    ['".mov": "video/quicktime"'],
    ['".ogg": "video/ogg"'],
    ['".ogv": "video/ogg"'],
    ['".webm": "video/webm"'],
  ];

  for (const [mapping] of cases) assert.ok(serverSource.includes(mapping), mapping);
});
