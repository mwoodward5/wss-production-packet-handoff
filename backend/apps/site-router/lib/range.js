"use strict";

const { MAX_RANGE_BYTES } = require("./constants");

function parseSingleRange(header, size, maxBytes = MAX_RANGE_BYTES) {
  if (typeof header !== "string" || !Number.isSafeInteger(size) || size < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - Math.min(suffix, maxBytes));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start >= size || end < start) return null;
    end = Math.min(end, size - 1, start + maxBytes - 1);
  }

  const length = end - start + 1;
  if (length <= 0) return null;
  return Object.freeze({ start, end, length });
}

module.exports = { parseSingleRange };
