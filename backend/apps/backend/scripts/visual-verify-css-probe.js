"use strict";

// scripts/visual-verify-css-probe.js — WHY DID AN INJECTED RULE NOT TAKE?
//
// Reads the answer off the rendered page: every stylesheet rule that matches
// the element and touches its size, with the @layer it lives in, plus the
// computed value that actually won.
//
// WHAT IT FOUND, and the reason it is kept rather than thrown away. Run against
// wss-test-rimrock-plumbing-billings.wss-ai.com on 2026-08-11:
//
//   · the page carries ELEVEN <style data-wss-edit> blocks — ten previously
//     landed customer edits, stacked in <head>
//   · one of them sizes the logo through
//         header a img[src*="client-logo"], … { height: var(--wss-logo-h); … }
//     unlayered, at specificity (0,1,3)
//   · so a NEW edit written at `header img[src*="client-logo"]` (0,1,2) is
//     unlayered against unlayered, loses, and changes nothing — while the plan
//     validates, the bytes change, the archive matches and the deploy goes
//     READY
//   · the logo's own utility class says h-9 (36px) and it computes to 72px,
//     which is the prior edit winning, not the donor
//
// That is a live precedence ceiling on further edits to an element that has
// already been edited once, and this script is how to check it on any mirror.
//
//   node scripts/visual-verify-css-probe.js

const http = require("http");
const { launchChromium } = require("../lib/serverless-chromium");

const LIVE = "https://wss-test-rimrock-plumbing-billings.wss-ai.com/";
const CSS = 'header img[src*="client-logo"] { height:97px; width:auto; max-width:100%; }';

async function main() {
  const origin = new URL(LIVE);
  const baseHtml = await (await fetch(LIVE, { headers: { "cache-control": "no-cache" } })).text();
  console.log(`index.html contains a logo <img>: ${/client-logo/.test(baseHtml)}`);
  const m = baseHtml.match(/<img[^>]*client-logo[^>]*>/i);
  console.log(`  ${m ? m[0].slice(0, 220) : "(not in the static html — rendered by the app)"}`);

  const html = baseHtml.replace("</head>", `\n<style data-wss-edit="probe">\n${CSS}\n</style>\n</head>`);

  const server = http.createServer(async (req, reply) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = Buffer.from(html, "utf8");
      reply.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
      reply.end(body);
      return;
    }
    const up = await fetch(new URL(url.pathname + url.search, origin).toString());
    const buf = Buffer.from(await up.arrayBuffer());
    reply.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/octet-stream", "content-length": buf.length, "cache-control": "no-store" });
    reply.end(buf);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: "load", timeout: 25000 });
    await page.waitForTimeout(800);

    const out = await page.evaluate(() => {
      const report = {};
      const all = Array.from(document.querySelectorAll('img[src*="client-logo"]'));
      report.logos = all.map((el) => ({
        selectorMatches: document.querySelectorAll('header img[src*="client-logo"]').length,
        inHeader: Boolean(el.closest("header")),
        src: el.getAttribute("src"),
        cls: el.className,
        inlineStyle: el.getAttribute("style") || "",
        computedH: getComputedStyle(el).height,
        computedW: getComputedStyle(el).width,
        rect: { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height },
      }));

      // Is our block still in the document, and where does it sit?
      const ours = document.querySelector('style[data-wss-edit="probe"]');
      report.ourBlockPresent = Boolean(ours);
      report.ourBlockText = ours ? ours.textContent.trim().slice(0, 120) : "";
      const sheets = Array.from(document.styleSheets);
      report.sheetCount = sheets.length;
      report.ourSheetIndex = sheets.findIndex((s) => s.ownerNode === ours);
      report.headChildren = Array.from(document.head.children).map((n) => `${n.tagName}${n.getAttribute("data-wss-edit") ? "[ours]" : ""}${n.tagName === "LINK" ? `:${(n.getAttribute("href") || "").slice(-24)}` : ""}`);

      // Every rule in every sheet that matches the logo, with its layer.
      const el = all[0];
      report.matching = [];
      if (el) {
        for (const sheet of sheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          const walk = (list, layer) => {
            for (const rule of list) {
              if (rule.cssRules && (rule.constructor.name === "CSSLayerBlockRule")) { walk(rule.cssRules, rule.name || "(anonymous)"); continue; }
              if (rule.cssRules && rule.media) { walk(rule.cssRules, layer); continue; }
              if (!rule.selectorText) continue;
              let hits = false;
              try { hits = el.matches(rule.selectorText); } catch { hits = false; }
              if (!hits) continue;
              if (/height|width/i.test(rule.style.cssText)) {
                report.matching.push({ layer: layer || "(unlayered)", selector: rule.selectorText, css: rule.style.cssText.slice(0, 160) });
              }
            }
            return undefined;
          };
          walk(rules, "");
        }
      }
      return report;
    });
    console.log(JSON.stringify(out, null, 2));
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => { console.error(String((e && e.stack) || e)); process.exitCode = 1; });
