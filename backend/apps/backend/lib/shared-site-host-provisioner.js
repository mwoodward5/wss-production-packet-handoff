"use strict";

// One exact hostname is attached to the immutable shared-site router before a
// staged release can be previewed or activated. This never creates a project,
// deployment, alias, or DNS record.

const { isLocalSharedSiteEnvironment } = require("./shared-site-release");

const VERCEL_API = "https://api.vercel.com";
const ROUTER_PROJECT_ID = "prj_IFmcTaUYJbkslPf41Cx0LuVuUOXP";
const SHARED_HOST_SUFFIX = ".wss-ai.com";
// LOCAL PREVIEW SEAM: receipt marker recorded when the host attach is skipped
// under WSS_SHARED_SITE_ENV=local. The publisher's host gate accepts exactly
// this receipt in the local environment and nothing else.
const LOCAL_DOMAIN_ATTACH = "domain_attach_skipped:local_env";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TEAM_RE = /^team_[A-Za-z0-9]+$/;
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "auth", "ghost", "mail", "smtp", "imap", "pop",
  "mx", "webmail", "autodiscover", "autoconfig", "ns1", "ns2", "dns",
  "cdn", "assets", "static", "status", "staging", "dev", "test",
  "dashboard", "console", "connect", "email", "gallery", "campaigns", "labs",
  "ledger", "line", "preview", "replies", "callprep", "siteforge", "stripe",
  "billing", "support", "help", "docs", "blog", "vercel", "root", "localhost",
]);
const HEALTH_BODY = Buffer.from(JSON.stringify({
  ok: true,
  service: "wss-shared-site-router",
  status: "ready",
}), "utf8");
const METHOD_BODY = Buffer.from("Method Not Allowed", "utf8");
const API_RESPONSE_LIMIT = 64 * 1024;
const ROUTER_RESPONSE_LIMIT = 512;

function exactSharedHost(value) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 253
      || !value.endsWith(SHARED_HOST_SUFFIX)) return "";
  const slug = value.slice(0, -SHARED_HOST_SUFFIX.length);
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug) ? value : "";
}

function exactCredential(value) {
  return typeof value === "string" && value === value.trim()
    && value.length >= 8 && value.length <= 4096
    && !/[\x00-\x1f\x7f]/.test(value)
    ? value
    : "";
}

function headerValue(response, name) {
  if (!response || !response.headers) return "";
  if (typeof response.headers.get === "function") {
    return String(response.headers.get(name) || "").trim();
  }
  for (const [key, value] of Object.entries(response.headers)) {
    if (String(key).toLowerCase() === String(name).toLowerCase()) {
      return String(value || "").trim();
    }
  }
  return "";
}

function stopReason({ signal, deadlineAt, now }) {
  if (signal && signal.aborted) return "shared_site_host_aborted";
  if (Number(now()) >= Number(deadlineAt)) return "shared_site_host_deadline_exceeded";
  return "";
}

function boundedSignal({ signal, deadlineAt, now }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timer = null;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const remaining = Math.max(0, Number(deadlineAt) - Number(now()));
  if (remaining === 0) controller.abort();
  else timer = setTimeout(abort, Math.min(remaining, 2_147_483_647));
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (signal && !signal.aborted) signal.removeEventListener("abort", abort);
    },
  };
}

async function guardedFetch(fetchImpl, url, options, context, consume) {
  const before = stopReason(context);
  if (before) throw new Error(before);
  const bounded = boundedSignal(context);
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(new Error(context.signal && context.signal.aborted
      ? "shared_site_host_aborted"
      : "shared_site_host_deadline_exceeded"));
    if (bounded.signal.aborted) onAbort();
    else bounded.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(url, { ...options, signal: bounded.signal });
        if (!response || !Number.isFinite(Number(response.status))) {
          throw new Error("shared_site_host_response_invalid");
        }
        return typeof consume === "function" ? consume(response) : response;
      }),
      stopped,
    ]);
    const after = stopReason(context);
    if (after) throw new Error(after);
    return result;
  } catch (error) {
    const reason = stopReason(context);
    if (reason) throw new Error(reason);
    if (error && error.name === "AbortError") {
      throw new Error("shared_site_host_deadline_exceeded");
    }
    throw error;
  } finally {
    bounded.signal.removeEventListener("abort", onAbort);
    bounded.cleanup();
  }
}

async function boundedResponseBytes(response, maxBytes) {
  const declaredRaw = headerValue(response, "content-length");
  if (declaredRaw && !/^(?:0|[1-9]\d*)$/.test(declaredRaw)) {
    throw new Error("shared_site_host_response_invalid");
  }
  const declared = declaredRaw ? Number(declaredRaw) : -1;
  if (declared > maxBytes) throw new Error("shared_site_host_response_too_large");

  const chunks = [];
  let size = 0;
  if (response && response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value || []);
        size += chunk.length;
        if (size > maxBytes) {
          if (typeof reader.cancel === "function") await reader.cancel().catch(() => {});
          throw new Error("shared_site_host_response_too_large");
        }
        chunks.push(chunk);
      }
    } finally {
      if (typeof reader.releaseLock === "function") reader.releaseLock();
    }
  } else if (response && typeof response.arrayBuffer === "function") {
    const bytes = Buffer.from(await response.arrayBuffer());
    size = bytes.length;
    if (size > maxBytes) throw new Error("shared_site_host_response_too_large");
    chunks.push(bytes);
  } else if (response && typeof response.text === "function") {
    const bytes = Buffer.from(await response.text(), "utf8");
    size = bytes.length;
    if (size > maxBytes) throw new Error("shared_site_host_response_too_large");
    chunks.push(bytes);
  } else {
    throw new Error("shared_site_host_response_unreadable");
  }
  if (declared >= 0 && declared !== size) throw new Error("shared_site_host_response_invalid");
  return Buffer.concat(chunks, size);
}

async function boundedJsonObject(response) {
  const bytes = await boundedResponseBytes(response, API_RESPONSE_LIMIT);
  return jsonObjectFromBytes(bytes);
}

function jsonObjectFromBytes(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (_) {
    throw new Error("shared_site_host_response_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("shared_site_host_response_invalid");
  }
  return value;
}

function defaultWait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error("shared_site_host_aborted"));
      return;
    }
    let timer;
    const aborted = () => {
      clearTimeout(timer);
      reject(new Error("shared_site_host_aborted"));
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", aborted);
      resolve();
    }, Math.max(0, ms));
    if (signal) signal.addEventListener("abort", aborted, { once: true });
  });
}

async function waitForPoll(wait, pollMs, context) {
  const before = stopReason(context);
  if (before) throw new Error(before);
  const remaining = Math.max(0, Number(context.deadlineAt) - Number(context.now()));
  try {
    await wait(Math.min(pollMs, remaining), context.signal);
  } catch (error) {
    const reason = stopReason(context);
    if (reason) throw new Error(reason);
    throw error;
  }
  const after = stopReason(context);
  if (after) throw new Error(after);
}

function isHostError(error) {
  return /^shared_site_host_[a-z_]+$/.test(String(error && error.message || error));
}

function retryableStatus(status) {
  return status === 404 || status === 429 || status >= 500;
}

function pollLimit(context, pollMs) {
  const remaining = Math.max(1, Number(context.deadlineAt) - Number(context.now()));
  return Math.max(2, Math.ceil(remaining / pollMs) + 2);
}

function createVercelSharedSiteHostProvisioner({
  env = process.env,
  fetchImpl = global.fetch,
  now = Date.now,
  wait = defaultWait,
  pollMs = 750,
  maxWaitMs = 120_000,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function" || typeof wait !== "function"
      || !Number.isFinite(Number(pollMs)) || Number(pollMs) < 1
      || !Number.isFinite(Number(maxWaitMs)) || Number(maxWaitMs) < 1) {
    throw new TypeError("shared_site_host_dependency_invalid");
  }

  return async function ensureSharedSiteHost({ host, signal, deadlineAt } = {}) {
    const canonicalHost = exactSharedHost(host);
    if (!canonicalHost) throw new Error("shared_site_host_invalid");

    // LOCAL PREVIEW SEAM: the compose stack serves this host on the local
    // site-router behind the TLS gateway (localSiteGatewayOrigin). Attaching
    // it to the production Vercel router project from a local build is a real
    // production side-effect, so the local environment records the skip and
    // performs zero provider I/O — before any credential requirement.
    if (isLocalSharedSiteEnvironment(env)) {
      return Object.freeze({
        ok: true,
        host: canonicalHost,
        domainAttach: LOCAL_DOMAIN_ATTACH,
      });
    }

    const token = exactCredential(env && env.VERCEL_TOKEN);
    const teamId = typeof (env && env.VERCEL_TEAM_ID) === "string"
      && TEAM_RE.test(env.VERCEL_TEAM_ID)
      ? env.VERCEL_TEAM_ID
      : "";
    if (!token || !teamId) throw new Error("shared_site_host_configuration_required");

    const startedAt = Number(now());
    const requestedDeadline = Number(deadlineAt);
    const context = {
      signal,
      deadlineAt: Number.isFinite(requestedDeadline) && requestedDeadline > 0
        ? Math.min(requestedDeadline, startedAt + Number(maxWaitMs))
        : startedAt + Number(maxWaitMs),
      now,
    };
    const initialStop = stopReason(context);
    if (initialStop) throw new Error(initialStop);

    const query = `?teamId=${encodeURIComponent(teamId)}`;
    const projectPath = encodeURIComponent(ROUTER_PROJECT_ID);
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const attachUrl = `${VERCEL_API}/v10/projects/${projectPath}/domains${query}`;
    const domainUrl = `${VERCEL_API}/v9/projects/${projectPath}/domains/${encodeURIComponent(canonicalHost)}${query}`;
    let attachState = "unattempted";
    let ownershipProven = false;

    const ownershipAttempts = pollLimit(context, Number(pollMs));
    for (let attempt = 0; attempt < ownershipAttempts; attempt += 1) {
      if (attachState === "unattempted" || attachState === "transient") {
        try {
          const attached = await guardedFetch(fetchImpl, attachUrl, {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            headers: authHeaders,
            body: JSON.stringify({ name: canonicalHost }),
          }, context, async (response) => {
            const status = Number(response.status);
            const bytes = await boundedResponseBytes(response, API_RESPONSE_LIMIT);
            let errorCode = "";
            if (status === 400) {
              try {
                const body = jsonObjectFromBytes(bytes);
                errorCode = typeof body.error?.code === "string" ? body.error.code : "";
              } catch (_) {
                errorCode = "";
              }
            }
            return { status, errorCode };
          });
          const status = attached.status;
          if (status >= 200 && status < 300) attachState = "accepted";
          else if (status === 400 && attached.errorCode === "not_modified") attachState = "conflict";
          else if (status === 409) attachState = "conflict";
          else if (status === 429 || status >= 500) attachState = "transient";
          else throw new Error("shared_site_host_attach_failed");
        } catch (error) {
          if (isHostError(error)) throw error;
          attachState = "transient";
        }
      }

      try {
        const owned = await guardedFetch(fetchImpl, domainUrl, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        }, context, async (response) => {
          const status = Number(response.status);
          if (status === 200 && response.ok === true) {
            return { status, ok: true, row: await boundedJsonObject(response) };
          }
          await boundedResponseBytes(response, API_RESPONSE_LIMIT);
          return { status, ok: false, row: null };
        });
        const status = owned.status;
        if (status === 200 && owned.ok === true) {
          const row = owned.row;
          if (row.name !== canonicalHost || row.projectId !== ROUTER_PROJECT_ID) {
            throw new Error("shared_site_host_project_mismatch");
          }
          if (row.verified === true) {
            ownershipProven = true;
            break;
          }
          attachState = "accepted";
        } else {
          if (status === 404 && attachState === "conflict") {
            throw new Error("shared_site_host_project_mismatch");
          }
          if (!retryableStatus(status)) throw new Error("shared_site_host_ownership_failed");
          if (status === 404 && attachState === "transient") attachState = "unattempted";
        }
      } catch (error) {
        if (isHostError(error)) throw error;
        if (attachState === "transient") attachState = "unattempted";
      }
      await waitForPoll(wait, Number(pollMs), context);
    }
    if (!ownershipProven) throw new Error("shared_site_host_not_ready");

    const origin = `https://${canonicalHost}`;
    const healthUrl = `${origin}/_wss/health`;
    const previewRouteUrl = `${origin}/api/preview-session`;
    const readinessAttempts = pollLimit(context, Number(pollMs));
    for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
      try {
        const health = await guardedFetch(fetchImpl, healthUrl, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          headers: { Accept: "application/json", "Accept-Encoding": "identity" },
        }, context, async (response) => ({
          status: Number(response.status),
          ok: response.ok === true,
          url: String(response.url || ""),
          contentType: headerValue(response, "content-type").toLowerCase(),
          body: await boundedResponseBytes(response, ROUTER_RESPONSE_LIMIT),
        }));
        const status = health.status;
        if (status === 200 && health.ok === true) {
          if (health.url !== healthUrl
              || health.contentType !== "application/json; charset=utf-8"
              || !health.body.equals(HEALTH_BODY)) {
            throw new Error("shared_site_host_router_identity_mismatch");
          }
          const route = await guardedFetch(fetchImpl, previewRouteUrl, {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            headers: { Accept: "text/plain", "Accept-Encoding": "identity" },
          }, context, async (response) => ({
            status: Number(response.status),
            url: String(response.url || ""),
            allow: headerValue(response, "allow").toUpperCase(),
            contentType: headerValue(response, "content-type").toLowerCase(),
            body: await boundedResponseBytes(response, ROUTER_RESPONSE_LIMIT),
          }));
          if (route.status !== 405 || route.url !== previewRouteUrl
              || route.allow !== "POST"
              || route.contentType !== "text/plain; charset=utf-8"
              || !route.body.equals(METHOD_BODY)) {
            throw new Error("shared_site_host_router_identity_mismatch");
          }
          return Object.freeze({ ok: true, host: canonicalHost, projectId: ROUTER_PROJECT_ID });
        }
        if (!retryableStatus(status)) throw new Error("shared_site_host_router_not_ready");
      } catch (error) {
        if (isHostError(error)) throw error;
      }
      await waitForPoll(wait, Number(pollMs), context);
    }
    throw new Error("shared_site_host_not_ready");
  };
}

module.exports = {
  HEALTH_BODY,
  LOCAL_DOMAIN_ATTACH,
  METHOD_BODY,
  ROUTER_PROJECT_ID,
  createVercelSharedSiteHostProvisioner,
  exactSharedHost,
};
