"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const VERCEL = path.resolve(__dirname, "../../labs-site/vercel.json");
const html = fs.readFileSync(DASHBOARD, "utf8");
const config = JSON.parse(fs.readFileSync(VERCEL, "utf8"));

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const next = html.indexOf("\n  function ", start + 12);
  return html.slice(start, next < 0 ? html.length : next);
}

test("Assistant is a 1/3 Riley rail plus a 2/3 real-site preview", () => {
  assert.match(html, /\.editor-split\{[^}]*grid-template-columns:clamp\(360px,34%,420px\) minmax\(0,1fr\)/);
  assert.match(html, /<iframe id="sitepreview" title="Live preview of your website"/);
  assert.match(html, /id="previewdesktop"[^>]*aria-pressed="true"/);
  assert.match(html, /id="previewphone"[^>]*aria-pressed="false"/);
  assert.match(html, /id="previewrefresh"/);
  assert.match(html, /id="previewopen"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.match(html, /@media\(max-width:820px\)\{[\s\S]*?\.editor-split\{grid-template-columns:1fr/);
  assert.match(functionSource("syncEditorOrder"), /insertBefore\(preview,chat\)/,
    "mobile must put the collapsible preview before chat");
  assert.match(functionSource("onPreviewLoaded"), /if\(!previewUrl\)return/,
    "the iframe's initial about:blank load must not claim a live site");
});

test("the theater accepts only server narration and tracks a bounded job id", () => {
  const meter = functionSource("editMeter");
  const key = functionSource("editKey");
  const sync = functionSource("syncEditTheater");
  const reload = functionSource("rememberPreviewReload");
  const apply = functionSource("applyChange");

  assert.match(meter, /meter\.plainWords/);
  assert.match(meter, /return null/);
  assert.doesNotMatch(key, /edit\.at|edit\.message/,
    "message text and timestamps must never impersonate a job id");
  assert.match(sync, /editKey\(list\[i\]\)===activeTheaterKey/);
  assert.match(sync, /editMeter\(candidate\)/);
  assert.match(reload, /MAX_PREVIEW_RELOAD_JOBS/);
  assert.match(reload, /delete previewReloadedJobs\[previewReloadedOrder\.shift\(\)\]/);
  assert.doesNotMatch(apply, /paintEditTheater\([^)]*pending/,
    "approval alone is not a real build stage");
});

test("voice is in-browser, public-config only, and narrowly allowed by policy", () => {
  assert.match(html, /import\("https:\/\/cdn\.jsdelivr\.net\/npm\/@vapi-ai\/web@2\.6\.1\/\+esm"\)/);
  assert.match(functionSource("startVoiceCall"), /fetch\("\/api\/connect\/voice-config"/);
  assert.match(functionSource("startVoiceCall"), /new Vapi\(config\.publicKey/);
  assert.match(functionSource("startVoiceCall"), /vapi\.start\(config\.assistantId,\{metadata:config\.metadata\}\)/);
  assert.doesNotMatch(html.slice(html.indexOf('id="panel-assistant"'), html.indexOf('id="panel-reports"')), /tel:/);
  assert.doesNotMatch(html, /(?:privateKey|admin[_-]?token|service_role)/i);

  const rewrite = config.rewrites.find((entry) => entry.source === "/api/connect/voice-config");
  assert.deepEqual(rewrite, {
    source: "/api/connect/voice-config",
    destination: "https://ghost-agency-backend.vercel.app/api/connect/voice-config",
  });
  const headers = Object.fromEntries(config.headers[0].headers.map((entry) => [entry.key, entry.value]));
  assert.match(headers["Permissions-Policy"], /microphone=\(self\)/);
  assert.match(headers["Content-Security-Policy"], /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(headers["Content-Security-Policy"], /script-src[^;]*https:\/\/c\.daily\.co/);
  assert.match(headers["Content-Security-Policy"], /frame-src https:\/\/\*\.wss-ai\.com https:\/\/\*\.daily\.co/);
  assert.match(headers["Content-Security-Policy"], /connect-src[^;]*https:\/\/\*\.vapi\.ai[^;]*wss:\/\/\*\.vapi\.ai[^;]*https:\/\/\*\.daily\.co[^;]*wss:\/\/\*\.daily\.co/);
  assert.match(headers["Content-Security-Policy"], /connect-src[^;]*https:\/\/prod-ks\.pluot\.blue[^;]*wss:\/\/prod-ks\.pluot\.blue/);
  assert.match(headers["Content-Security-Policy"], /media-src 'self' blob:/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /'unsafe-eval'/);
});

test("a thin DOM cannot let preview or voice stop login, chat, and tabs", () => {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match);
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        textContent: "",
        innerHTML: "",
        style: {},
        listeners: {},
        addEventListener(type, handler) {
          (this.listeners[type] = this.listeners[type] || []).push(handler);
        },
      });
    }
    return elements.get(id);
  };
  const sandbox = {
    Promise,
    console,
    Date,
    document: { getElementById: element },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    location: { hash: "", pathname: "/dashboard", reload() {} },
    history: { replaceState() {} },
  };

  assert.doesNotThrow(() => vm.runInNewContext(match[1], sandbox));
  assert.equal(element("loginbtn").listeners.click.length, 1);
  assert.equal(element("chatsend").listeners.click.length, 1);
  assert.equal(element("chatinput").listeners.keydown.length, 1);
  assert.equal(element("tab-assistant").listeners.click.length, 1);
  assert.equal(element("voicecall").listeners.click.length, 1);
});

test("motion, live narration, and mobile controls stay accessible", () => {
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /id="theaterannounce" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="theaterbar" role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  assert.match(html, /id="previewcollapse"[^>]*aria-expanded="true"[^>]*aria-controls="previewviewport"/);
  assert.match(html, /id="voicestatus" role="status" aria-live="polite"/);
  assert.match(html, /id="voicemute"[^>]*aria-pressed="false"/);
  assert.match(html, /:focus-visible\{outline:3px solid var\(--green\)/);
  assert.match(html, /#themetoggle\{width:44px;max-width:44px;min-width:44px;justify-self:end;grid-column:2\}/);
  assert.match(html, /\.mast-actions:has\(#mastcontrols\[style\*="display:none"\]\)\{width:auto;display:flex;flex:0 0 auto;margin-left:auto\}/);
  assert.match(html, /\.command-nav \.tab\{flex:1 1 0;min-width:0/,
    "all five phone tab labels must fit instead of clipping Reports");
  assert.match(html, /\.editor-chat \.preset-row\{flex-wrap:wrap;overflow-x:visible/,
    "phone suggestion chips must wrap cleanly");
});
