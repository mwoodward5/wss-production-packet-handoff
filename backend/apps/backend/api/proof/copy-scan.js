"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { PUBLIC_BANNED_TERMS, findPublicCopyTerms } = require("../../lib/copy-ban");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { publicConfig } = require("../../lib/registry");
const { recordEvent } = require("../../lib/store");

const DEFAULT_PATHS = ["/", "/report", "/factory-os", "/intake"];

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.method === "POST" ? await readJson(req) : {};
    const base = (body.publicAppUrl || publicConfig().publicAppUrl || "").replace(/\/+$/, "");
    const paths = Array.isArray(body.paths) && body.paths.length ? body.paths : DEFAULT_PATHS;
    const results = [];

    for (const path of paths) {
      const url = /^https?:\/\//i.test(path) ? path : `${base}${path}`;
      try {
        const response = await fetch(url, { redirect: "follow" });
        const text = await response.text();
        const terms = findPublicCopyTerms(text);
        results.push({ url, status: response.status, ok: response.ok && terms.length === 0, terms });
      } catch (error) {
        results.push({ url, ok: false, error: error.message || String(error) });
      }
    }

    const ok = results.every((item) => item.ok);
    await recordEvent("proof.copy_scan", {
      ok,
      results: results.map((item) => ({ url: item.url, status: item.status, terms: item.terms || [] })),
    });

    sendJson(res, ok ? 200 : 409, {
      ok,
      bannedTerms: PUBLIC_BANNED_TERMS,
      results,
    });
  } catch (error) {
    handleError(res, error);
  }
};
