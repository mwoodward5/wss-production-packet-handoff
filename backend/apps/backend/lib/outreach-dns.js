"use strict";

const dns = require("node:dns").promises;

const EXPECTED = {
  dkimHost: "resend._domainkey.go.wss-ai.com",
  spfHost: "send.go.wss-ai.com",
  dmarcHost: "_dmarc.go.wss-ai.com",
  mxHost: "send.go.wss-ai.com",
  mxExchange: "feedback-smtp.us-east-1.amazonses.com",
};

let cached = null;

function flattenTxt(records = []) {
  return records.map((parts) => parts.join("")).filter(Boolean);
}

async function withTimeout(label, promise, timeoutMs = 1800) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTxt(host) {
  try {
    return flattenTxt(await withTimeout(`txt_${host}`, dns.resolveTxt(host)));
  } catch (error) {
    return { error: error.code || error.message || "txt_lookup_failed" };
  }
}

async function resolveMx(host) {
  try {
    return await withTimeout(`mx_${host}`, dns.resolveMx(host));
  } catch (error) {
    return { error: error.code || error.message || "mx_lookup_failed" };
  }
}

async function outreachDnsStatus({ cacheMs = 60_000 } = {}) {
  const now = Date.now();
  if (cached && now - cached.at < cacheMs) return cached.value;

  const [dkim, spf, dmarc, mx] = await Promise.all([
    resolveTxt(EXPECTED.dkimHost),
    resolveTxt(EXPECTED.spfHost),
    resolveTxt(EXPECTED.dmarcHost),
    resolveMx(EXPECTED.mxHost),
  ]);

  const checks = {
    dkim: Array.isArray(dkim) && dkim.some((value) => /^p=MIGf/i.test(value)),
    spf: Array.isArray(spf) && spf.some((value) => /v=spf1\s+include:amazonses\.com\s+~all/i.test(value)),
    dmarc: Array.isArray(dmarc) && dmarc.some((value) => /^v=DMARC1/i.test(value)),
    mx:
      Array.isArray(mx) &&
      mx.some((record) => String(record.exchange || "").replace(/\.$/, "") === EXPECTED.mxExchange),
  };

  const value = {
    ok: Object.values(checks).every(Boolean),
    expected: EXPECTED,
    checks,
    errors: {
      dkim: dkim.error || null,
      spf: spf.error || null,
      dmarc: dmarc.error || null,
      mx: mx.error || null,
    },
  };
  cached = { at: now, value };
  return value;
}

module.exports = {
  outreachDnsStatus,
};
