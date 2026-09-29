"use strict";

const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { MAX_ASSET_BYTES } = require("./constants");
const { unavailable } = require("./errors");

const RESPONSE_CHUNK_BYTES = 256 * 1024;

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function asNodeReadable(value) {
  if (value && typeof value.pipe === "function") return value;
  if (value && typeof value.getReader === "function") return Readable.fromWeb(value);
  return null;
}

async function verifiedBody(body, {
  expectedLength,
  expectedSha256,
  signal,
  maxBytes = MAX_ASSET_BYTES
}) {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > maxBytes) {
    throw unavailable("asset_size_refused");
  }
  const buffer = asBuffer(body);
  if (buffer) {
    if (buffer.length !== expectedLength) throw unavailable("asset_length_mismatch");
    const actual = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actual !== expectedSha256) throw unavailable("asset_integrity_mismatch");
    return Buffer.from(buffer);
  }

  const readable = asNodeReadable(body);
  if (!readable) throw unavailable("asset_body_missing");
  const chunks = [];
  let seen = 0;
  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of readable) {
      if (signal && signal.aborted) throw unavailable("asset_read_aborted");
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      seen += bytes.length;
      if (seen > expectedLength || seen > maxBytes) throw unavailable("asset_length_mismatch");
      hash.update(bytes);
      chunks.push(bytes);
    }
  } catch (error) {
    if (typeof readable.destroy === "function") readable.destroy();
    throw error;
  }
  if (seen !== expectedLength) throw unavailable("asset_length_mismatch");
  if (hash.digest("hex") !== expectedSha256) throw unavailable("asset_integrity_mismatch");
  return Buffer.concat(chunks, seen);
}

function waitForDrain(res, signal) {
  if (signal && signal.aborted) return Promise.reject(unavailable("response_write_aborted"));
  if (res.destroyed || res.writableEnded) {
    return Promise.reject(unavailable("response_write_aborted"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (typeof res.off === "function") {
        res.off("drain", onDrain);
        res.off("error", onError);
        res.off("close", onClose);
      }
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const settle = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => settle();
    const onError = () => settle(unavailable("response_write_failed"));
    const onClose = () => settle(unavailable("response_write_aborted"));
    const onAbort = () => settle(unavailable("response_write_aborted"));

    res.once("drain", onDrain);
    res.once("error", onError);
    res.once("close", onClose);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    if (signal && signal.aborted) onAbort();
  });
}

async function writeVerifiedResponse(res, body, {
  signal,
  chunkBytes = RESPONSE_CHUNK_BYTES
} = {}) {
  const buffer = asBuffer(body);
  if (!buffer || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1
      || chunkBytes > RESPONSE_CHUNK_BYTES || !res
      || typeof res.write !== "function" || typeof res.end !== "function") {
    throw unavailable("response_write_refused");
  }

  for (let offset = 0; offset < buffer.length; offset += chunkBytes) {
    if ((signal && signal.aborted) || res.destroyed || res.writableEnded) {
      throw unavailable("response_write_aborted");
    }
    const end = Math.min(offset + chunkBytes, buffer.length);
    if (!res.write(buffer.subarray(offset, end))) await waitForDrain(res, signal);
  }
  if ((signal && signal.aborted) || res.destroyed || res.writableEnded) {
    throw unavailable("response_write_aborted");
  }
  res.end();
}

module.exports = { RESPONSE_CHUNK_BYTES, verifiedBody, writeVerifiedResponse };
