import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = Number(process.env.CDP_PORT || 9347);
const proofRoot = path.join(__dirname, "proof", "ca-landscape-leadminer-2026-07-05", "preview-sites");
const outDir = path.join(proofRoot, "screenshots");
const profile = path.join(os.tmpdir(), `ca-landscape-cdp-${Date.now()}`);
const currentManifest = JSON.parse(readFileSync(path.join(proofRoot, "CA_LANDSCAPE_THREE_KITCHEN_REBUILD_2026-07-06.json"), "utf8"));
const manifest = Array.isArray(currentManifest) ? currentManifest : currentManifest.manifest;
const sites = manifest.map((item) => [item.project.replace(/^wss-ca-landscape-/, ""), item.url]);

mkdirSync(outDir, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 80) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      last = error;
    }
    await delay(125);
  }
  throw last || new Error(`Timed out waiting for ${url}`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result || {});
      return;
    }
    const waiters = events.get(msg.method);
    if (waiters?.length) waiters.splice(0).forEach((resolve) => resolve(msg.params || {}));
  });
  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
    waitFor(method, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
        const list = events.get(method) || [];
        list.push((params) => {
          clearTimeout(timer);
          resolve(params);
        });
        events.set(method, list);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function capture(client, slug, url, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", viewport);
  await client.send("Page.navigate", { url });
  await client.waitFor("Page.loadEventFired", 20000).catch(() => null);
  await client.send("Runtime.evaluate", {
    expression: "document.fonts ? document.fonts.ready.then(() => true) : true",
    awaitPromise: true,
  }).catch(() => null);
  await delay(1400);
  const audit = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const hero = document.querySelector('.hero');
      const h1 = document.querySelector('.hero h1');
      const visual = document.querySelector('.media-stage, .hero-video, .visual, .stage, .motion-frame');
      const primary = document.querySelector('.btn.primary');
      return {
        title: document.title,
        fontsReady: document.fonts ? document.fonts.status === "loaded" : true,
        bodyFont: getComputedStyle(document.body).fontFamily,
        h1Font: h1 ? getComputedStyle(h1).fontFamily : "",
        h1Size: h1 ? getComputedStyle(h1).fontSize : "",
        buttonFont: primary ? getComputedStyle(primary).fontFamily : "",
        buttonSize: primary ? getComputedStyle(primary).fontSize : "",
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.body.scrollHeight,
        sections: document.querySelectorAll("section").length,
        images: document.images.length,
        loadedImages: [...document.images].filter(img => img.complete && img.naturalWidth > 0).length,
        heroRect: hero ? hero.getBoundingClientRect().toJSON() : null,
        visualRect: visual ? visual.getBoundingClientRect().toJSON() : null,
        controls: ["platform", "source", "package"].every(id => document.getElementById(id)),
        videoReady: !!document.querySelector('[data-video-status="veo-ready"] video'),
        kitchenStack: document.querySelector("[data-kitchen-stack]")?.getAttribute("data-kitchen-stack") || "",
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2
      };
    })()`,
    returnByValue: true,
  });
  const shot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const kind = viewport.mobile ? "mobile" : "desktop";
  const file = path.join(outDir, `${slug}-${kind}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  return { slug, url, kind, file, audit: audit.result.value };
}

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const client = cdp(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  const outputs = [];
  for (const [slug, url] of sites) {
    outputs.push(await capture(client, slug, url, { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }));
    outputs.push(await capture(client, slug, url, { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }));
  }
  client.close();
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(outputs, null, 2));
  console.log(JSON.stringify({ ok: true, count: outputs.length, outDir }, null, 2));
} finally {
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
  } catch {}
}
