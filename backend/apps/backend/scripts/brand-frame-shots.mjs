// Brand-frame before/after mock shots for the dashboard-branding PR.
// Renders the customer Command Center (wss-ai.com/dashboard), the operator
// deck, the operator console, and WSS Connect from BEFORE (a HEAD worktree)
// and AFTER (this working tree), dropping PNGs into artifacts/brand-frame-shots/.
// Usage: node scripts/brand-frame-shots.mjs
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(BACKEND, "../..");
const OUT = path.join(REPO, "artifacts", "brand-frame-shots");
mkdirSync(OUT, { recursive: true });

// BEFORE = a throwaway worktree pinned to HEAD, so every relative require in
// the page modules resolves exactly as it does in the real tree.
const BEFORE = path.join(REPO, ".brand-before-wt");
const haveWorktree = (() => {
  try { execSync(`git worktree add "${BEFORE}" HEAD`, { cwd: REPO, stdio: "pipe" }); return true; }
  catch { return false; } // already present from a previous run — reuse it
})();

const { chromium } = await import("playwright");

function serve(root) {
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
      import("node:fs").then((fs) => {
        fs.readFile(path.join(root, rel), (err, body) => {
          if (err) { res.writeHead(404); res.end("nope"); return; }
          res.writeHead(200, { "content-type": types[path.extname(rel)] || "application/octet-stream" });
          res.end(body);
        });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const fetchText = async (url) => (await fetch(url)).text();

async function shot(page, urlOrHtml, file, { isUrl = true, clip = null, signedInMock = false } = {}) {
  if (isUrl) await page.goto(urlOrHtml, { waitUntil: "load" });
  else await page.setContent(urlOrHtml, { waitUntil: "load" });
  if (signedInMock) {
    // Mock the signed-in state without live APIs: show the app shell, hide
    // the sign-in card. Skeletons are the page's own honest loading state.
    await page.addStyleTag({ content: "#login{display:none!important}#dash{display:block!important}" });
    await page.waitForTimeout(300);
  }
  if (clip) await page.screenshot({ path: file, clip });
  else await page.screenshot({ path: file });
  console.log("wrote", path.basename(file));
}

const TOP = { x: 0, y: 0, width: 1280, height: 520 };
const lab = await serve(path.join(REPO, "apps", "labs-site"));
const connectSrv = await serve(path.join(REPO, "apps", "connect"));
const beforeLab = await serve(path.join(BEFORE, "apps", "labs-site"));
const beforeConnect = await serve(path.join(BEFORE, "apps", "connect"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Customer dashboard (wss-ai.com/dashboard — the surface the outreach email's
// "Open your dashboard" button lands on). BEFORE: HEAD. AFTER: this tree,
// signed-out and mocked signed-in.
await shot(page, `http://127.0.0.1:${beforeLab.port}/dashboard/index.html`, path.join(OUT, "dashboard-before.png"));
await shot(page, `http://127.0.0.1:${lab.port}/dashboard/index.html`, path.join(OUT, "dashboard-after.png"));
await shot(page, `http://127.0.0.1:${lab.port}/dashboard/index.html`, path.join(OUT, "dashboard-after-signedin.png"), { signedInMock: true });

// WSS Connect.
await shot(page, `http://127.0.0.1:${beforeConnect.port}/index.html`, path.join(OUT, "connect-before.png"), { clip: TOP });
await shot(page, `http://127.0.0.1:${connectSrv.port}/index.html`, path.join(OUT, "connect-after.png"), { clip: TOP });

// Operator deck: render the template module from each tree.
const deckBefore = await import(pathToFileURL(path.join(BEFORE, "apps", "backend", "lib", "dashboard-html.js")).href);
const deckAfter = await import(pathToFileURL(path.join(BACKEND, "lib", "dashboard-html.js")).href);
await shot(page, deckBefore.renderOperatorDashboard({}), path.join(OUT, "deck-before.png"), { isUrl: false });
await shot(page, deckAfter.renderOperatorDashboard({}), path.join(OUT, "deck-after.png"), { isUrl: false });

// Operator console: the page is one big template-literal string.
const consoleBefore = await import(pathToFileURL(path.join(BEFORE, "apps", "backend", "lib", "console-page.js")).href);
const consoleAfter = await import(pathToFileURL(path.join(BACKEND, "lib", "console-page.js")).href);
const beforePage = consoleBefore.default ?? consoleBefore;
const afterPage = consoleAfter.default ?? consoleAfter;
await shot(page, beforePage, path.join(OUT, "console-before.png"), { isUrl: false, clip: TOP });
await shot(page, afterPage, path.join(OUT, "console-after.png"), { isUrl: false, clip: TOP });

await browser.close();
for (const { server } of [lab, connectSrv, beforeLab, beforeConnect]) server.close();
try { execSync(`git worktree remove --force "${BEFORE}"`, { cwd: REPO, stdio: "pipe" }); } catch { /* best effort */ }
console.log("done ->", OUT);
