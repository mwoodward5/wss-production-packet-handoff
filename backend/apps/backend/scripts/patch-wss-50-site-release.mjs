import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const REPO = path.resolve(BACKEND, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function write(rel, content) {
  const target = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
}

function replaceOnce(rel, needle, replacement) {
  const before = read(rel);
  const count = before.split(needle).length - 1;
  if (count !== 1) throw new Error(`${rel}: expected exactly one patch anchor, found ${count}: ${needle.slice(0, 120)}`);
  write(rel, before.replace(needle, replacement));
}

function replaceRegexOnce(rel, pattern, replacement) {
  const before = read(rel);
  const matches = before.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`${rel}: expected exactly one regex patch anchor, found ${matches.length}: ${pattern}`);
  write(rel, before.replace(pattern, replacement));
}

// ---------------------------------------------------------------------------
// 1. Restore the existing CI contract. The gold-standard email now contains
//    the new-site proof twice (comparison + primary preview), so the old count
//    of five external images was stale even though every required role existed.
// ---------------------------------------------------------------------------
replaceOnce(
  "apps/backend/scripts/smoke-tests.js",
  `  // Mark + old/new screenshots + Connect funnel + Riley avatar = five external image tags.\n  // Footer includes inline marks, not another external <img>.\n  const allExternalImageHtml = (html.match(/<img\\b[^>]*\\bsrc="https?:\\/\\/[^\"]+"/g) || []).join("\\n");\n  assert.equal((html.match(/<img\\b[^>]*\\bsrc="https?:\\/\\/[^\"]+"/g) || []).length, 5, images);`,
  `  // Mark + old screenshot + TWO new-site proofs (comparison + primary hero)\n  // + Connect funnel + Riley avatar = six external image tags. Footer marks\n  // remain inline, not another external <img>. Count the duplicate new-site\n  // role deliberately: the side-by-side email is itself a release surface.\n  const externalImageTags = html.match(/<img\\b[^>]*\\bsrc="https?:\\/\\/[^\"]+"/g) || [];\n  const allExternalImageHtml = externalImageTags.join("\\n");\n  assert.equal(externalImageTags.length, 6, images);\n  assert.equal((allExternalImageHtml.match(/alt="Ready Roofing new website"/g) || []).length, 2, allExternalImageHtml);`,
);

// ---------------------------------------------------------------------------
// 2. Mobile hero polish. The email compares first screens side by side, so the
//    generated hero has to look cinematic on a phone, not merely avoid broken
//    tokens. Keep the mathematically-proven scrim; improve composition beneath
//    it without changing any donor source.
// ---------------------------------------------------------------------------
replaceOnce(
  "apps/backend/lib/hero-wash.js",
  `    "@media (max-width: 640px) {",\n    \`  :is(\${sel}) {\`,\n    \`    background-image: linear-gradient(to bottom, \${rgba} 0%, \${rgba} 38%, \${clear} 100%), url("\${imageHref}");\`,\n    "  }",\n    "}",`,
  `    "@media (max-width: 640px) {",\n    \`  :is(\${sel}) {\`,\n    \`    background-image: linear-gradient(to bottom, \${rgba} 0%, \${rgba} 42%, \${clear} 100%), url("\${imageHref}");\`,\n    "    min-height: clamp(520px, 78svh, 760px);",\n    "    background-size: cover;",\n    "    background-position: center 32%;",\n    "    overflow: clip;",\n    "    isolation: isolate;",\n    "    box-shadow: inset 0 -110px 110px -92px rgba(0,0,0,.78);",\n    "  }",\n    \`  :is(\${sel}) h1 {\`,\n    "    max-width: 12ch;",\n    "    font-size: clamp(2.15rem, 10.5vw, 4.5rem);",\n    "    line-height: .94;",\n    "    letter-spacing: -.045em;",\n    "    text-wrap: balance;",\n    "    text-shadow: 0 3px 28px rgba(0,0,0,.78), 0 1px 2px rgba(0,0,0,.96);",\n    "  }",\n    \`  :is(\${sel}) > video, :is(\${sel}) > img, :is(\${sel}) > picture > img {\`,\n    "    width: 100%;",\n    "    height: 100%;",\n    "    object-fit: cover;",\n    "    object-position: center 32%;",\n    "    filter: saturate(1.12) contrast(1.06) brightness(.72);",\n    "    transform: scale(1.035);",\n    "  }",\n    \`  :is(\${sel}) a[href^=\\"tel:\\"], :is(\${sel}) a[href*=\\"contact\\"], :is(\${sel}) a[href*=\\"quote\\"], :is(\${sel}) button {\`,\n    "    box-shadow: 0 14px 34px rgba(0,0,0,.32);",\n    "    backdrop-filter: blur(12px);",\n    "  }",\n    "}",`,
);

replaceOnce(
  "apps/backend/test/hero-wash.test.js",
  `  // Three :is() rules, none escalating specificity: the flat desktop scrim, its\n  // reduced-motion sibling, and the @media(max-width:640px) cinematic gradient\n  // that lets the client's photo pop on the mobile fold.\n  assert.equal((out.css.match(/:is\\(/g) || []).length, 3, "desktop scrim, reduced-motion sibling, mobile gradient");\n  assert.match(out.css, /@media \\(max-width: 640px\\)/, "mobile cinematic gradient block present");`,
  `  // The mobile block now carries a complete first-screen composition: wash,\n  // headline scale, direct media treatment and conversion affordance. It stays\n  // selector-scoped and media-gated, so desktop remains unchanged.\n  assert.ok((out.css.match(/:is\\(/g) || []).length >= 7, "desktop proof plus mobile composition selectors");\n  assert.match(out.css, /@media \\(max-width: 640px\\)/, "mobile cinematic gradient block present");\n  assert.match(out.css, /min-height: clamp\\(520px, 78svh, 760px\\)/);\n  assert.match(out.css, /font-size: clamp\\(2\\.15rem, 10\\.5vw, 4\\.5rem\\)/);\n  assert.match(out.css, /filter: saturate\\(1\\.12\\) contrast\\(1\\.06\\) brightness\\(\\.72\\)/);`,
);

// ---------------------------------------------------------------------------
// 3. Browser-enforced mobile hero gate. Source-level contrast checks are not
//    enough for the proof email: load the shipped page at 390x844 and refuse a
//    shallow, empty, clipped, actionless or horizontally-overflowing first fold.
// ---------------------------------------------------------------------------
replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `const STATIC_PROBLEM = /^(rendered_raw_tokens|entity_residue_in_rendered_text|route_collisions|missing_hash_targets|broken_prose|injected_content_|non_200_paths|empty_rendered_body)/;`,
  `const STATIC_PROBLEM = /^(rendered_raw_tokens|entity_residue_in_rendered_text|route_collisions|missing_hash_targets|broken_prose|injected_content_|non_200_paths|empty_rendered_body|mobile_hero_|mobile_horizontal_overflow)/;`,
);

replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `async function renderCheckOnce(url, {\n  timeoutMs = 45000, signal, deadlineAt, launch = launchChromium,\n} = {}) {`,
  `function mobileHeroProblems(audit = {}) {\n  if (!audit || audit.status === "unavailable") return [];\n  const problems = [];\n  if (audit.present !== true) return ["mobile_hero_missing"];\n  if (Number(audit.hero_height || 0) < 460) problems.push(\`mobile_hero_too_shallow:\${Math.round(Number(audit.hero_height || 0))}\`);\n  if (audit.media_present !== true) problems.push("mobile_hero_media_missing");\n  if (audit.headline_present !== true) problems.push("mobile_hero_headline_missing");\n  else {\n    if (Number(audit.headline_font_px || 0) < 32) problems.push(\`mobile_hero_headline_too_small:\${Number(audit.headline_font_px || 0).toFixed(1)}\`);\n    if (audit.headline_clipped === true) problems.push("mobile_hero_headline_clipped");\n  }\n  if (audit.action_present !== true) problems.push("mobile_hero_action_missing");\n  if (Number(audit.horizontal_overflow_px || 0) > 4) problems.push(\`mobile_horizontal_overflow:\${Math.round(Number(audit.horizontal_overflow_px || 0))}\`);\n  return problems;\n}\n\nasync function renderCheckOnce(url, {\n  timeoutMs = 45000, signal, deadlineAt, launch = launchChromium,\n} = {}) {`,
);

replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `    const rawTokens = (bodyText.match(/\\{\\{[A-Z_]+\\}\\}/g) || []).slice(0, 5);\n\n    const problems = [];`,
  `    const rawTokens = (bodyText.match(/\\{\\{[A-Z_]+\\}\\}/g) || []).slice(0, 5);\n\n    let mobileHero = { status: "unavailable", reason: "viewport_api_unavailable" };\n    if (typeof page.setViewportSize === "function") {\n      await abortRace(page.setViewportSize({ width: 390, height: 844 }), bounded.signal);\n      mobileHero = await abortRace(page.evaluate(() => {\n        const visible = (node) => {\n          if (!node) return false;\n          const rect = node.getBoundingClientRect();\n          const style = getComputedStyle(node);\n          return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02;\n        };\n        const selectors = [\n          "[data-hero-wash]", "[data-hero]", "section.hero", "header.hero", ".hero",\n          "main > section:first-of-type", "main > header:first-of-type",\n        ];\n        let hero = null;\n        for (const selector of selectors) {\n          hero = [...document.querySelectorAll(selector)].find((node) => {\n            if (!visible(node)) return false;\n            const rect = node.getBoundingClientRect();\n            return rect.top < innerHeight * 0.45 && rect.bottom > 220 && rect.width >= innerWidth * 0.82;\n          });\n          if (hero) break;\n        }\n        if (!hero) return { status: "measured", present: false, horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - innerWidth) };\n        const heroRect = hero.getBoundingClientRect();\n        const h1 = hero.querySelector("h1") || document.querySelector("h1");\n        const h1Rect = h1 ? h1.getBoundingClientRect() : null;\n        const h1Style = h1 ? getComputedStyle(h1) : null;\n        const style = getComputedStyle(hero);\n        const media = [...hero.querySelectorAll("video,img,picture img")].find((node) => {\n          if (!visible(node)) return false;\n          const rect = node.getBoundingClientRect();\n          const identity = `${node.getAttribute("class") || ""} ${node.getAttribute("alt") || ""}`;\n          return rect.width >= 200 && rect.height >= 120 && !/(logo|icon|badge|avatar)/i.test(identity);\n        });\n        const actionCandidates = [\n          ...hero.querySelectorAll("a[href^='tel:'],a[href*='contact'],a[href*='quote'],button"),\n          ...document.querySelectorAll("[data-wss-sticky-bar] a,[data-wss-sticky-cta] a,.wss-sticky a,a[href^='tel:']"),\n        ];\n        const action = actionCandidates.find((node) => {\n          if (!visible(node)) return false;\n          const rect = node.getBoundingClientRect();\n          return rect.top < innerHeight && rect.bottom > 0 && rect.width >= 72 && rect.height >= 34;\n        });\n        const trust = [...hero.querySelectorAll("[class*='rating'],[class*='star'],[id*='trust'],[class*='trust'],[aria-label*='star' i]")].filter(visible).length;\n        return {\n          status: "measured",\n          present: true,\n          selector_hint: hero.getAttribute("data-hero") || hero.getAttribute("class") || hero.tagName,\n          hero_height: Number(heroRect.height.toFixed(1)),\n          hero_width: Number(heroRect.width.toFixed(1)),\n          media_present: /url\\(/i.test(style.backgroundImage || "") || Boolean(media),\n          media_kind: /url\\(/i.test(style.backgroundImage || "") ? "background" : media ? media.tagName.toLowerCase() : "none",\n          headline_present: Boolean(h1 && visible(h1) && String(h1.innerText || h1.textContent || "").trim()),\n          headline_font_px: h1Style ? Number.parseFloat(h1Style.fontSize) || 0 : 0,\n          headline_clipped: Boolean(h1Rect && (h1Rect.left < -2 || h1Rect.right > innerWidth + 2 || h1Rect.top < heroRect.top - 2 || h1Rect.bottom > heroRect.bottom + 2)),\n          action_present: Boolean(action),\n          trust_signals: trust,\n          horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - innerWidth),\n        };\n      }), bounded.signal);\n    }\n\n    const problems = [];`,
);

replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `    if (rawTokens.length) problems.push(\`rendered_raw_tokens:\${rawTokens.join(",")}\`);\n\n    return {`,
  `    if (rawTokens.length) problems.push(\`rendered_raw_tokens:\${rawTokens.join(",")}\`);\n    problems.push(...mobileHeroProblems(mobileHero));\n\n    return {`,
);

replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `      page_errors: pageErrors.slice(0, 10),\n      video,\n    };`,
  `      page_errors: pageErrors.slice(0, 10),\n      video,\n      mobile_hero: mobileHero,\n    };`,
);

replaceOnce(
  "apps/backend/lib/mirror-engine/verify.js",
  `  renderAuditOnce,\n  // exported so the exemption can be tested on its own`,
  `  renderAuditOnce,\n  mobileHeroProblems,\n  // exported so the exemption can be tested on its own`,
);

// ---------------------------------------------------------------------------
// 4. GPU dashboard constellation. Native WebGL gives the depth of a Three.js
//    scene without adding a render-blocking CDN dependency to the operator's
//    emergency controls. It never accepts pointer input and pauses off-screen.
// ---------------------------------------------------------------------------
write("apps/backend/lib/console-orbit.js", `"use strict";\n\nconst consoleOrbitHtml = String.raw\`\n<style>\n  #wss-command-orbit{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.78;mix-blend-mode:screen;mask-image:linear-gradient(to bottom,rgba(0,0,0,.95),rgba(0,0,0,.28) 72%,transparent);}\n  #wss-command-orbit[data-fallback=\\"1\\"]{background:radial-gradient(circle at 70% 15%,rgba(124,108,246,.16),transparent 32%),radial-gradient(circle at 18% 42%,rgba(52,211,153,.09),transparent 28%);}\n  body>.wrap,body>.halt,body>.access{position:relative;z-index:1;}\n  @media (prefers-reduced-motion:reduce){#wss-command-orbit{opacity:.42}}\n</style>\n<canvas id=\\"wss-command-orbit\\" aria-hidden=\\"true\\"></canvas>\n<script>\n(function(){\n  var canvas=document.getElementById(\\"wss-command-orbit\\");if(!canvas)return;\n  var gl=canvas.getContext(\\"webgl\\",{alpha:true,antialias:false,preserveDrawingBuffer:false});\n  if(!gl){canvas.setAttribute(\\"data-fallback\\",\\"1\\");return;}\n  var reduce=window.matchMedia&&window.matchMedia(\\"(prefers-reduced-motion: reduce)\\").matches;\n  var vertex=\\"attribute vec2 p;uniform float t;uniform float activity;uniform vec2 aspect;varying float glow;void main(){float i=p.x;float ring=fract(i*.6180339);float arm=6.2831853*(ring+t*(.012+.026*activity));float radius=.16+.82*fract(i*.381966);float depth=.38+.62*fract(i*.754877);vec2 q=vec2(cos(arm),sin(arm))*radius;q.x/=aspect.x;float drift=sin(t*.21+i*8.1)*.045*(1.0-activity*.35);q.y+=drift;gl_Position=vec4(q,0.,1.);gl_PointSize=(1.4+4.8*depth)*(1.0+activity*.35);glow=depth;}\\";\n  var fragment=\\"precision mediump float;uniform float activity;varying float glow;void main(){vec2 d=gl_PointCoord-.5;float a=smoothstep(.5,.06,length(d));vec3 violet=vec3(.38,.32,1.);vec3 mint=vec3(.20,.83,.60);vec3 c=mix(violet,mint,glow*.7+activity*.2);gl_FragColor=vec4(c,a*(.18+.48*glow));}\\";\n  function shader(type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))return null;return s;}\n  var vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);if(!vs||!fs){canvas.setAttribute(\\"data-fallback\\",\\"1\\");return;}\n  var program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS)){canvas.setAttribute(\\"data-fallback\\",\\"1\\");return;}\n  var n=260,data=new Float32Array(n*2);for(var i=0;i<n;i++){data[i*2]=i/n;data[i*2+1]=0;}\n  var buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);\n  var loc=gl.getAttribLocation(program,\\"p\\");var ut=gl.getUniformLocation(program,\\"t\\"),ua=gl.getUniformLocation(program,\\"activity\\"),uaspect=gl.getUniformLocation(program,\\"aspect\\");\n  function resize(){var d=Math.min(window.devicePixelRatio||1,1.5),w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);canvas.width=Math.floor(w*d);canvas.height=Math.floor(h*d);canvas.style.width=w+\\"px\\";canvas.style.height=h+\\"px\\";gl.viewport(0,0,canvas.width,canvas.height);}\n  function number(sel){var el=document.querySelector(sel);return Number(el&&el.textContent)||0;}\n  var start=performance.now(),lastActivity=0;\n  function frame(now){if(document.hidden){requestAnimationFrame(frame);return;}resize();var moving=number(\\".ph-stat.building b\\"),ready=number(\\".ph-stat.ready b\\"),bad=number(\\".ph-stat.refused b\\");var target=Math.min(1,(moving*1.5+ready*.25+bad*.5)/10);lastActivity+= (target-lastActivity)*.035;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);gl.uniform1f(ut,reduce?0:(now-start)/1000);gl.uniform1f(ua,lastActivity);gl.uniform2f(uaspect,Math.max(1,canvas.width/canvas.height),1);gl.drawArrays(gl.POINTS,0,n);if(!reduce)requestAnimationFrame(frame);}\n  addEventListener(\\"resize\\",resize,{passive:true});document.addEventListener(\\"visibilitychange\\",function(){if(!document.hidden&&!reduce)requestAnimationFrame(frame);});resize();requestAnimationFrame(frame);\n})();\n</script>\n\`;\n\nmodule.exports={consoleOrbitHtml};\n`);

replaceOnce(
  "apps/backend/lib/console-page.js",
  `const { operatorNav } = require("./operator-nav");`,
  `const { operatorNav } = require("./operator-nav");\nconst { consoleOrbitHtml } = require("./console-orbit");`,
);
replaceOnce(
  "apps/backend/lib/console-page.js",
  `})();\n</script>\n</body></html>\`;`,
  `})();\n</script>\n\${consoleOrbitHtml}\n</body></html>\`;`,
);

// ---------------------------------------------------------------------------
// 5. Deterministic donor primaries. Exact verticals may have several clean
//    donors; filesystem order is not a product decision. Keep aliases and all
//    explicit donor requests unchanged.
// ---------------------------------------------------------------------------
replaceOnce(
  "apps/backend/lib/mirror-engine/donor.js",
  `function readManifest(dir) {`,
  `function preferredDonorFor(vertical) {\n  const tablePath = path.join(__dirname, "..", "..", "data", "donor-verticals.json");\n  try {\n    const table = JSON.parse(fs.readFileSync(tablePath, "utf8"));\n    return String((table.canonical || {})[String(vertical || "").toLowerCase()] || "").trim();\n  } catch {\n    return "";\n  }\n}\n\nfunction readManifest(dir) {`,
);
replaceOnce(
  "apps/backend/lib/mirror-engine/donor.js",
  `  const inService = forVertical.filter((d) => !donorRetirement(d));\n  const match = inService[0];`,
  `  const inService = forVertical.filter((d) => !donorRetirement(d));\n  const preferred = preferredDonorFor(wanted);\n  const match = (preferred ? inService.find((d) => d.name === preferred) : null)\n    || inService.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];`,
);
replaceOnce(
  "apps/backend/lib/mirror-engine/donor.js",
  `module.exports = { donorRoot, listDonors, resolveDonor, loadDonor, loadDonorFiles, donorRetirement };`,
  `module.exports = { donorRoot, listDonors, resolveDonor, loadDonor, loadDonorFiles, donorRetirement, preferredDonorFor };`,
);

const verticalsPath = "apps/backend/data/donor-verticals.json";
const verticals = JSON.parse(read(verticalsPath));
verticals.updated = "2026-08-15";
verticals.canonical = {
  concrete: "concrete-elconstruction",
  fencing: "fencing-sterling",
  hvac: "hvac-premier",
  landscaping: "landscaping-evergreen",
  "med spa": "medspa-luma",
  plumbing: "plumbing-clean",
  roofing: "roofing-falcon-clean",
  salon: "salon-lacquer-studio",
  tattoo: "tattoo-aurelia",
};
verticals.canonical_note = "Authoritative primary donor for every Command Center vertical. Exact vertical resolution uses this map first, then a stable alphabetical fallback. Explicit donor requests and adjacent aliases are unchanged.";
write(verticalsPath, JSON.stringify(verticals, null, 2));

// ---------------------------------------------------------------------------
// 6. Permanent release tests: mobile visual gate, GPU console contract, and a
//    real 50-row batch using all nine donor families with one injected failure.
// ---------------------------------------------------------------------------
write("apps/backend/test/mobile-hero-quality.test.js", `"use strict";\n\nconst test=require("node:test");\nconst assert=require("node:assert/strict");\nconst {mobileHeroProblems}=require("../lib/mirror-engine/verify");\n\ntest("a cinematic mobile first screen clears the email comparison gate",()=>{\n  assert.deepEqual(mobileHeroProblems({status:"measured",present:true,hero_height:658,media_present:true,headline_present:true,headline_font_px:43,headline_clipped:false,action_present:true,horizontal_overflow_px:0}),[]);\n});\n\ntest("a flat or broken first screen names every defect",()=>{\n  assert.deepEqual(mobileHeroProblems({status:"measured",present:true,hero_height:280,media_present:false,headline_present:true,headline_font_px:24,headline_clipped:true,action_present:false,horizontal_overflow_px:19}),[\n    "mobile_hero_too_shallow:280",\n    "mobile_hero_media_missing",\n    "mobile_hero_headline_too_small:24.0",\n    "mobile_hero_headline_clipped",\n    "mobile_hero_action_missing",\n    "mobile_horizontal_overflow:19",\n  ]);\n});\n\ntest("missing hero is a hard rendered failure; unavailable browser does not invent one",()=>{\n  assert.deepEqual(mobileHeroProblems({status:"measured",present:false}),["mobile_hero_missing"]);\n  assert.deepEqual(mobileHeroProblems({status:"unavailable"}),[]);\n});\n`);

write("apps/backend/test/console-orbit-ui.test.js", `"use strict";\n\nconst test=require("node:test");\nconst assert=require("node:assert/strict");\nconst {consoleOrbitHtml}=require("../lib/console-orbit");\nconst page=require("../lib/console-page");\n\ntest("Command Center ships a non-blocking GPU constellation",()=>{\n  assert.match(consoleOrbitHtml,/id=\\\\"wss-command-orbit\\\\"/);\n  assert.match(consoleOrbitHtml,/getContext\\(\\\\"webgl\\\\"/);\n  assert.match(consoleOrbitHtml,/pointer-events:none/);\n  assert.match(consoleOrbitHtml,/prefers-reduced-motion/);\n  assert.match(consoleOrbitHtml,/document\\.hidden/);\n  assert.doesNotMatch(consoleOrbitHtml,/https?:\\/\\//);\n  assert.match(page,/wss-command-orbit/);\n});\n`);

write("apps/backend/test/line-50-site-release.test.js", `"use strict";\n\nconst test=require("node:test");\nconst assert=require("node:assert/strict");\nconst fs=require("node:fs");\nconst os=require("node:os");\nconst path=require("node:path");\nconst {createHash}=require("node:crypto");\n\nconst BACKEND=path.join(__dirname,"..");\nprocess.env.MIRROR_DONOR_ROOT=path.join(BACKEND,"donors-clean");\nprocess.env.MIRROR_CLIENT_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),"wss-50-clients-"));\n\nconst runner=require("../lib/line-runner");\nconst lineState=require("../lib/line-state");\nconst {mirror}=require("../lib/mirror-engine/engine");\nconst {createRegistry}=require("../lib/mirror-engine/build-hash");\nconst {resolveDonor}=require("../lib/mirror-engine/donor");\n\nconst VERTICALS=["concrete","fencing","hvac","landscaping","med spa","plumbing","roofing","salon","tattoo"];\nconst PLACES=[\n  ["Tucson","AZ"],["Portland","OR"],["Austin","TX"],["Spokane","WA"],["Denver","CO"],\n  ["Nashville","TN"],["Charlotte","NC"],["Boise","ID"],["Madison","WI"],\n];\nconst slug=(value)=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");\n\ntest("all nine Command Center verticals resolve to their declared primary donor",()=>{\n  for(const vertical of VERTICALS){\n    const out=resolveDonor({industry:vertical});\n    assert.equal(out.ok,true,`${vertical}: ${out.error||"no donor"}`);\n    assert.equal(out.manifest.vertical,vertical);\n  }\n});\n\ntest("50 real donor hydrations finish with bounded concurrency, intact emails and isolated failure",async()=>{\n  runner.resetBatches();\n  const registry=createRegistry();\n  const input=Array.from({length:50},(_,i)=>{\n    const vertical=VERTICALS[i%VERTICALS.length];\n    const [city,state]=PLACES[i%PLACES.length];\n    return {\n      prospectId:`wss-test-release-${String(i+1).padStart(2,"0")}`,\n      businessName:`Release Proof ${i+1} ${vertical}`,\n      city,state,vertical,\n      email:`owner${String(i+1).padStart(2,"0")}@release-proof.example`,\n    };\n  });\n  const expectedEmail=new Map(input.map((row)=>[row.prospectId,row.email]));\n  const queued=[];\n  let active=0,maxActive=0;\n  const failing=input[17].prospectId;\n  const result=await runner.startBatch({count:50,lane:"sandbox",target:"leadminer"},{\n    pick:async()=>input,\n    qualify:async()=>({ok:true}),\n    concurrency:6,\n    snapshot:()=>{},\n    mirror:async(row)=>{\n      active+=1;maxActive=Math.max(maxActive,active);\n      try{\n        if(row.prospectId===failing)return {ok:false,reason:"injected_release_proof_failure"};\n        const request={\n          slug:`wss-test-${slug(row.prospectId)}-${slug(row.vertical)}`.slice(0,63),\n          facts:{business_name:row.businessName,industry:row.vertical,city:row.city,state:row.state,email:row.email},\n        };\n        const built=await mirror(request,{dryRun:true,registry});\n        if(!built.ok)return {ok:false,reason:`dry_run_${built.status}_${built.body&&built.body.error}`};\n        return {\n          ok:true,\n          previewUrl:`https://${request.slug}.wss-ai.com/`,\n          buildHash:built.body.build_hash,\n          currentWebsite:`https://current-${row.prospectId}.example/`,\n        };\n      }finally{active-=1;}\n    },\n    sourceFacts:async(row)=>({business_name:row.businessName,vertical:row.vertical,email:row.email}),\n    gate:async({source})=>({pass:true,failed:[],checks:[{fact:"logo_own_and_unique",pass:true,evidence:{sha256:createHash("sha256").update(source.prospect_id).digest("hex")}}]}),\n    writePreviewUrl:async(row)=>({ok:true,rowPatch:{email:row.email}}),\n    queueEmail:async(row)=>{\n      assert.equal(row.email,expectedEmail.get(row.prospectId),`${row.prospectId}: email changed or disappeared`);\n      queued.push({prospectId:row.prospectId,email:row.email});\n      return {ok:true};\n    },\n  });\n  assert.equal(result.ok,true);\n  assert.equal(result.batch.rows.length,50);\n  assert.ok(maxActive>1,"the proof must actually overlap builds");\n  assert.ok(maxActive<=6,`concurrency escaped its bound: ${maxActive}`);\n  const counts=lineState.batchCounts(result.batch);\n  assert.equal(counts.queued,49);\n  assert.equal(counts.failed,1);\n  assert.equal(queued.length,49);\n  assert.equal(new Set(queued.map((row)=>row.email)).size,49);\n  const casualty=result.batch.rows.find((row)=>row.prospectId===failing);\n  assert.equal(casualty.status,"error");\n  assert.equal(casualty.reason,"injected_release_proof_failure");\n  assert.ok(result.batch.rows.every((row)=>row.status==="queued"||lineState.isFailed(row.status)),"all 50 rows must be terminal");\n  const represented=new Set(result.batch.rows.map((row)=>row.vertical));\n  assert.deepEqual([...represented].sort(),[...VERTICALS].sort());\n  assert.equal(result.batch.status,"awaiting_approval");\n  assert.equal(result.batch.lane,"sandbox");\n});\n`);

const packagePath = "apps/backend/package.json";
const pkg = JSON.parse(read(packagePath));
pkg.scripts["test:wss-release"] = "node --test test/mobile-hero-quality.test.js test/console-orbit-ui.test.js test/line-50-site-release.test.js";
if (!pkg.scripts.ci.includes("npm run test:wss-release")) {
  pkg.scripts.ci = pkg.scripts.ci.replace("npm run test:mirror-engine &&", "npm run test:mirror-engine && npm run test:wss-release &&");
}
write(packagePath, JSON.stringify(pkg, null, 2));

console.log("WSS 50-site release patch applied successfully.");
