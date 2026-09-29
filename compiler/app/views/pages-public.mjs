// SiteForge SaaS — public pages: landing, templates, pricing, login, legal.
import { esc, fmtMoney } from "../lib/util.mjs";
import { page, MOTIF_SVG } from "./layout.mjs";
import { HERO_FAMILIES } from "../lib/engine-adapter.mjs";
import { CATALOG } from "../lib/billing.mjs";

const INDUSTRIES = ["roofing", "landscaping", "plumbing", "electrical", "hvac", "tree care", "concrete", "fencing", "painting", "pool service", "cleaning", "general contracting", "excavation", "solar", "pest control", "garage door", "other"];
export const industryOptions = (sel) => INDUSTRIES.map((i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${i[0].toUpperCase() + i.slice(1)}</option>`).join("");
const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
export const stateOptions = (sel) => STATES.map((s) => `<option ${s === sel ? "selected" : ""}>${s}</option>`).join("");

export function tplPoster(family, i) {
  const hues = [["#22301F", "#C2571B"], ["#1E2733", "#B98A2F"], ["#2C2420", "#3E5C41"], ["#252525", "#A97E24"], ["#30231C", "#93400F"], ["#1F2B29", "#C2571B"]];
  const [bg, ac] = hues[i % hues.length];
  const shapes = [
    `<rect x="30" y="150" width="240" height="16" rx="4" fill="#FAF6EE" opacity=".9"/><rect x="30" y="178" width="170" height="16" rx="4" fill="#FAF6EE" opacity=".55"/><rect x="30" y="216" width="90" height="26" rx="13" fill="${ac}"/><circle cx="430" cy="120" r="85" fill="${ac}" opacity=".25"/><path d="M340 260 Q 430 140 520 250" stroke="${ac}" stroke-width="2" fill="none"/>`,
    `<rect x="30" y="40" width="230" height="220" rx="8" fill="${ac}" opacity=".3"/><rect x="290" y="60" width="220" height="12" rx="4" fill="#FAF6EE" opacity=".85"/><rect x="290" y="86" width="180" height="12" rx="4" fill="#FAF6EE" opacity=".5"/><rect x="290" y="120" width="200" height="1.5" fill="#FAF6EE" opacity=".3"/><rect x="290" y="140" width="150" height="10" rx="4" fill="#FAF6EE" opacity=".4"/>`,
    `<circle cx="180" cy="140" r="100" fill="none" stroke="${ac}" stroke-width="1.4" opacity=".7"/><circle cx="180" cy="140" r="65" fill="none" stroke="${ac}" stroke-width="1.2" opacity=".5"/><circle cx="215" cy="105" r="5" fill="${ac}"/><circle cx="150" cy="170" r="5" fill="${ac}"/><circle cx="240" cy="180" r="5" fill="${ac}"/><rect x="330" y="110" width="180" height="14" rx="4" fill="#FAF6EE" opacity=".9"/><rect x="330" y="136" width="120" height="12" rx="4" fill="#FAF6EE" opacity=".5"/>`,
    `<g>${[0, 1, 2, 3].map((c) => `<rect x="${40 + c * 120}" y="80" width="100" height="140" rx="8" fill="${ac}" opacity="${0.55 - c * 0.1}"/>`).join("")}</g><rect x="40" y="245" width="200" height="10" rx="4" fill="#FAF6EE" opacity=".6"/>`,
    `<rect x="60" y="50" width="300" height="10" rx="4" fill="#FAF6EE" opacity=".8"/><rect x="60" y="76" width="340" height="10" rx="4" fill="#FAF6EE" opacity=".6"/><rect x="60" y="102" width="260" height="10" rx="4" fill="#FAF6EE" opacity=".6"/><path d="M70 230 q 30 -35 60 0 t 60 0" stroke="${ac}" stroke-width="2.4" fill="none"/><circle cx="450" cy="160" r="70" fill="${ac}" opacity=".3"/>`,
    `<g>${Array.from({ length: 12 }, (_, c) => `<rect x="${35 + (c % 4) * 125}" y="${45 + Math.floor(c / 4) * 78}" width="110" height="64" rx="6" fill="${c === 5 ? ac : "#FAF6EE"}" opacity="${c === 5 ? ".9" : ".14"}"/>`).join("")}</g>`,
  ];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 300"><rect width="560" height="300" fill="${bg}"/>${shapes[i % shapes.length]}</svg>`)}`;
}

export function landing({ user, demos = [] }) {
  const tpls = HERO_FAMILIES.map((f, i) => {
    const demo = demos.find((d) => d.family === f.key);
    return `<article class="tpl-card">
      <img class="tpl-poster" src="${demo?.poster || tplPoster(f.key, i)}" alt="${esc(f.name)} template collection preview" loading="lazy" width="560" height="300">
      <div class="tpl-body">
        <h3>${esc(f.name)}</h3>
        <p>${esc(f.blurb)}</p>
        <div class="btn-row">
          ${demo ? `<a class="btn ghost sm" href="${demo.url}" target="_blank" rel="noopener">Visit example</a>` : ""}
          <a class="btn sm" href="/templates/${f.key}">Try this look</a>
        </div>
      </div>
    </article>`;
  }).join("");

  const pricing = CATALOG.plans.map((p) => priceCard(p)).join("");

  return page({
    title: "Woodward Software Labs Intake Genie",
    desc: "A source-first intake that reads a business website, Google listing, social profile, and real assets, then forges a graded local-service preview from verified evidence.",
    path: "/", user,
    body: `
<section class="hero">
  ${MOTIF_SVG}
  <div class="wrap hero-inner">
    <div>
      <p class="eyebrow">Woodward Software Labs</p>
      <h1 class="kinetic">Intake Genie turns real business evidence into a graded website preview.</h1>
      <p class="sub">Paste a website, Google listing, social profile, or public asset folder. Intake Genie resolves the business name, market, trade, proof, media, and local-search plan before the forge builds anything. No fake reviews, no guessed service areas, no empty preview panes.</p>
      <div class="btn-row" style="margin:1.6rem 0 1rem">
        <a class="btn ember" href="#intake-genie">Build my real preview</a>
        <a class="btn ghost" href="/templates">Browse the collections</a>
      </div>
      <p class="muted" style="font-size:.85rem">Free to compile and preview. Pay only to publish. Failed quality gates stay internal.</p>
    </div>
    <div class="forge-card intake-genie-card" id="intake-genie">
      <h3 style="margin-top:0">Build from sources</h3>
      <p style="color:#C9C1B0;font-size:.9rem">Use anything you have. The engine will ask only one follow-up if a required fact is missing.</p>
      <form id="intake-genie-form" data-endpoint="/api/try/intake" enctype="multipart/form-data">
        <div class="grid-2 compact-fields">
          <div class="field"><label for="ig-web">Website URL</label><input id="ig-web" name="website_url" type="url" placeholder="https://business.com"></div>
          <div class="field"><label for="ig-gbp">Google Business or Maps URL</label><input id="ig-gbp" name="gbp_url" type="url" placeholder="https://maps.google.com/..."></div>
        </div>
        <div class="grid-2 compact-fields">
          <div class="field"><label for="ig-social">Facebook or Instagram URL</label><input id="ig-social" name="social_url" type="url" placeholder="https://instagram.com/..."></div>
          <div class="field"><label for="ig-assets">Asset folder URL</label><input id="ig-assets" name="asset_url" type="url" placeholder="https://drive.google.com/..."></div>
        </div>
        <div class="field"><label for="ig-desc">Or describe the business</label>
          <textarea id="ig-desc" name="description" rows="2" maxlength="800" placeholder="Planet Pools — pool cleaning and repair in Mission Viejo, CA" style="width:100%;resize:vertical"></textarea></div>
        <div class="field"><label for="ig-photos">Real photos <span class="muted" style="font-weight:normal">(optional, 1-6)</span></label>
          <input id="ig-photos" name="photos" type="file" accept="image/*" multiple></div>
        <button class="btn ember" type="submit" style="width:100%">Build my real preview</button>
        <p class="muted" style="font-size:.78rem;margin:.5rem 0 0">Public previews are noindexed and expire after 24 hours.</p>
      </form>
      <div id="intake-genie-evidence" class="source-evidence">
        <b>Readiness / Source Evidence</b>
        <ul>
          <li data-source-row="website">Website: waiting</li>
          <li data-source-row="gbp">Google listing: waiting</li>
          <li data-source-row="social">Social profile: waiting</li>
          <li data-source-row="asset">Asset folder: waiting</li>
          <li data-source-row="description">Description: waiting</li>
          <li data-source-row="facts">Resolved facts: waiting</li>
          <li data-source-row="cache">Cache: waiting</li>
        </ul>
      </div>
      <div id="try-result" style="margin-top:.9rem"></div>
    </div>
  </div>
</section>

<section class="section alt" id="how">
  <div class="wrap">
    <div class="section-head"><div><p class="eyebrow">How it works</p><h2>Watch it forge.</h2></div>
    <p>Every stage streams live to your screen. Nothing is hidden, including the grade.</p></div>
    <div class="how-grid">
      <div class="how"><h3>Discover</h3><p>We read your current site and business listing for your logo, colors, photos, services, reviews, contact details, and search gaps.</p></div>
      <div class="how"><h3>Approve</h3><p>You see everything we found and approve, remove, or edit it. Nothing renders that you didn't sanction — and nothing is ever invented.</p></div>
      <div class="how"><h3>Forge</h3><p>A deterministic engine composes a one-of-one site: unique hero anatomy, layered visuals, your voice. Same inputs, same site — no slot-machine rerolls.</p></div>
      <div class="how"><h3>Grade</h3><p>A hard QC gate checks hero depth, anti-template uniqueness, copy bans, schema, mobile at 320px, and accessibility. You see the report card.</p></div>
      <div class="how"><h3>Publish</h3><p>Grade A unlocks publish. Your domain, SSL, sitemap, robots, llms.txt — live. Add the AI Voice Receptionist when you're ready.</p></div>
    </div>
  </div>
</section>

<section class="section" id="templates">
  <div class="wrap">
    <div class="section-head"><div><p class="eyebrow">Collections</p><h2>Six hero anatomies. Zero clones.</h2></div>
    <p>These aren't templates you squeeze into — they're layout systems the forge composes around <em>your</em> content. Two businesses never get the same site; the QC gate enforces it.</p></div>
    <div class="tpl-grid">${tpls}</div>
  </div>
</section>

<section class="section alt">
  <div class="wrap">
    <div class="section-head"><div><p class="eyebrow">The difference</p><h2>Before the forge / after the forge</h2></div></div>
    <div class="grid-2">
      <div class="panel"><h3 style="color:var(--danger)">The site you have</h3>
        <ul class="qc-list">
          <li class="fail"><span class="mark">✗</span><span class="detail">Stock template shared with 40,000 other businesses</span></li>
          <li class="fail"><span class="mark">✗</span><span class="detail">No schema — invisible to Google's local pack and AI answers</span></li>
          <li class="fail"><span class="mark">✗</span><span class="detail">Phone number buried, no quote path, broken on phones</span></li>
          <li class="fail"><span class="mark">✗</span><span class="detail">"We pride ourselves on quality" — copy written by nobody, for nobody</span></li>
        </ul>
      </div>
      <div class="panel"><h3 style="color:var(--ok)">The site we forge</h3>
        <ul class="qc-list">
          <li class="pass"><span class="mark">✓</span><span class="detail">One-of-one layout — uniqueness enforced by a batch-level QC gate</span></li>
          <li class="pass"><span class="mark">✓</span><span class="detail">LocalBusiness, Service, FAQ + speakable schema, llms.txt for AI engines</span></li>
          <li class="pass"><span class="mark">✓</span><span class="detail">Call, quote, and booking paths above the fold, graded at 320px</span></li>
          <li class="pass"><span class="mark">✓</span><span class="detail">Copy in your voice from your real story — fabricated claims are a build failure</span></li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="section" id="pricing">
  <div class="wrap">
    <div class="section-head"><div><p class="eyebrow">Pricing</p><h2>Flat prices. Never credits.</h2></div>
    <p>Vibe-coder tools charge you per attempt and profit from their own failures. WSS Launch's QC gate means a failed forge is our problem, not your bill.</p></div>
    <div class="price-grid">${pricing}</div>
    <p class="muted" style="margin-top:1.4rem;font-size:.9rem">Want it done for you? <a href="/pricing#dfy">Done-For-You builds</a> from ${fmtMoney(CATALOG.one_time[0].price_cents)} — our operators run the forge until it grades A.</p>
  </div>
</section>

<section class="section alt" id="faq">
  <div class="wrap" style="max-width:860px">
    <p class="eyebrow">FAQ</p>
    <h2>Fair questions.</h2>
    ${faq("Is this another AI website toy?", "No. WSS Launch is a production engine with a hard quality gate: hero-layer depth, anti-template signatures, copy ban-lists, schema, 320px mobile integrity, accessibility. If a build doesn't clear the gate, it doesn't ship — and it doesn't count against your quota.")}
    ${faq("Where does my content come from?", "From you and your real footprint: your current website, your Google Business Profile, photos and reviews you approve. Every fact on the site traces to a source. If we can't source it, we don't say it — the engine refuses to invent awards, years, or testimonials.")}
    ${faq("What if I don't have a website yet?", "Give us your business name, city, and trade. The forge builds from your intake and anything public we can verify, and you can upload photos and your logo in the import step.")}
    ${faq("What's GEO / AEO?", "Generative-engine optimization: structured answers, speakable schema, llms.txt, and FAQ surfaces so AI assistants (ChatGPT, Gemini, Claude) can cite your business, not just Google.")}
    ${faq("Can it answer my phone too?", "Yes — the AI Voice Receptionist add-on gives your business a trained voice agent that answers calls, books jobs, and texts you transcripts. It wires straight into your site's call CTAs.")}
    ${faq("Do you lock me in?", "No. Pro and Agency plans include full static export of your site. Your domain stays yours.")}
  </div>
</section>`,
  });
}

const faq = (q, a) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`;

export function priceCard(p, { compact = false } = {}) {
  return `<div class="price-card ${p.highlight ? "highlight" : ""}">
    <div><h3 style="margin:0">${esc(p.name)}</h3><p class="muted" style="font-size:.88rem;margin:.2rem 0 0">${esc(p.tagline || "")}</p></div>
    <div class="price">${p.price_cents === 0 ? "Free" : fmtMoney(p.price_cents)}${p.interval ? `<small>/${p.interval}</small>` : ""}</div>
    <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    <form method="post" action="/api/checkout"><input type="hidden" name="kind" value="plan"><input type="hidden" name="key" value="${p.key}">
      <button class="btn ${p.highlight ? "ember" : ""}" style="width:100%" type="submit" ${p.key === "free" ? "" : ""}>${p.price_cents === 0 ? "Start free" : `Choose ${esc(p.name)}`}</button>
    </form>
  </div>`;
}

export function pricingPage({ user }) {
  const addons = CATALOG.addons.map((a) => `<div class="panel">
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline"><h3>${esc(a.name)}</h3><b>${fmtMoney(a.price_cents)}<small class="muted">/${a.interval}</small></b></div>
    <p style="font-size:.93rem">${esc(a.description)}</p>
    <form method="post" action="/api/checkout"><input type="hidden" name="kind" value="addon"><input type="hidden" name="key" value="${a.key}">
    <button class="btn ghost sm" type="submit">Add to plan</button></form>
  </div>`).join("");
  const dfy = CATALOG.one_time.map((o) => `<div class="panel">
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline"><h3>${esc(o.name)}</h3><b>${fmtMoney(o.price_cents)}</b></div>
    <p style="font-size:.93rem">${esc(o.description)}</p>
    <form method="post" action="/api/checkout"><input type="hidden" name="kind" value="one_time"><input type="hidden" name="key" value="${o.key}">
    <button class="btn sm" type="submit">Book it</button></form>
  </div>`).join("");
  return page({
    title: "Simple pricing", desc: "See your website free. Choose a plan only when you are ready to publish it.", path: "/pricing", user,
    body: `<section class="section"><div class="wrap">
      <p class="eyebrow">Simple pricing</p><h1 style="font-size:clamp(2rem,4.5vw,3.4rem)">See it free. Pay when you are ready to publish.</h1>
      <p style="max-width:56ch">Start with a private website preview at no cost. Choose a monthly plan when you want to make it public, use your own web address, or ask us to handle ongoing changes.</p>
      <div class="price-grid" style="margin-top:2rem">${CATALOG.plans.map((p) => priceCard(p)).join("")}</div>
      <h2 id="upgrades" style="margin-top:3.5rem">Optional extras</h2>
      <p>Add help with phone calls, local search, or website chat whenever your business needs it.</p>
      <div class="grid-3">${addons}</div>
      <h2 id="dfy" style="margin-top:3.5rem">Want us to do everything?</h2>
      <p>Give us what you have and our team will gather the details, organize your content, build the website, and prepare it for launch.</p>
      <div class="grid-2">${dfy}</div>
    </div></section>`,
  });
}

export function templatesPage({ user, demos = [] }) {
  const cards = HERO_FAMILIES.map((f, i) => {
    const demo = demos.find((d) => d.family === f.key);
    return `<article class="tpl-card" id="${f.key}">
      <img class="tpl-poster" src="${demo?.poster || tplPoster(f.key, i)}" alt="${esc(f.name)} collection" loading="lazy" width="560" height="300">
      <div class="tpl-body"><h3>${esc(f.name)}</h3><p>${esc(f.blurb)}</p>
      <div class="btn-row">${demo ? `<a class="btn ghost sm" href="${demo.url}" target="_blank" rel="noopener">Live demo</a>` : ""}<a class="btn sm ember" href="/templates/${f.key}">Try it with your business</a></div></div>
    </article>`;
  }).join("");
  return page({
    title: "Website styles", desc: "Choose a website look you love and see it remade around your own business for free.", path: "/templates", user,
    body: `<section class="section"><div class="wrap">
      <p class="eyebrow">Website styles</p>
      <h1 style="font-size:clamp(2rem,4.5vw,3.4rem)">Find a look that feels like you.</h1>
      <p style="max-width:60ch">Pick a starting style, then WSS Launch reshapes it around your business, photos, words, and customers. No two finished websites are the same.</p>
      <div class="tpl-grid" style="margin-top:2rem">${cards}</div>
    </div></section>`,
  });
}

export function templateTryPage({ user, family }) {
  const f = HERO_FAMILIES.find((x) => x.key === family);
  return page({
    title: `Try ${f.name}`, desc: `See the ${f.name} look remade around your business in a free private preview.`, path: `/templates/${family}`, user,
    body: `<section class="section"><div class="wrap" style="max-width:720px">
      <p class="eyebrow">Try it free</p>
      <h1 style="font-size:clamp(2rem,4vw,3rem)">See ${esc(f.name)} with <em>your</em> business.</h1>
      <p>${esc(f.blurb)} Add three simple details and WSS Launch will make a private preview built around your business.</p>
      <div class="panel" style="margin-top:1.5rem">
        <form id="try-form">
          <input type="hidden" name="family" value="${f.key}">
          <div class="field"><label for="t-name">Business name</label><input id="t-name" name="name" required maxlength="60" type="text" placeholder="Ironvale Excavation"></div>
          <div class="grid-2">
            <div class="field"><label for="t-city">City</label><input id="t-city" name="city" required maxlength="40" type="text" placeholder="Boise"></div>
            <div class="field"><label for="t-state">State</label><select id="t-state" name="state">${stateOptions("ID")}</select></div>
          </div>
          <div class="field"><label for="t-cat">Industry</label><select id="t-cat" name="category">${industryOptions("excavation")}</select></div>
          <button class="btn ember" type="submit">Make my free preview</button>
          <p class="hint" style="margin-top:.6rem">Your preview is private and stays available for 24 hours. Sign up if you want to keep working on it.</p>
        </form>
        <div id="try-result" style="margin-top:.9rem"></div>
      </div>
    </div></section>`,
  });
}

export function loginPage({ sent = false, error = null, googleEnabled = false, csrf = "" }) {
  return page({
    title: "Sign in", desc: "Sign in to WSS Launch with a magic link or Google.", path: "/login", noindex: true,
    body: `<section class="section"><div class="wrap" style="max-width:460px">
      <p class="eyebrow">Sign in</p>
      <h1 style="font-size:2.4rem">Welcome back.</h1>
      ${error ? `<div class="notice bad">${esc(error)}</div>` : ""}
      ${sent ? `<div class="notice ok">Check your email — your sign-in link is on the way. (No email service configured? It's waiting in the <a href="/dev/inbox">dev inbox</a>.)</div>` : ""}
      <div class="panel">
        <form method="post" action="/auth/magic-link">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required placeholder="you@business.com"></div>
          ${process.env.SITEFORGE_BETA_CODE ? `<div class="field"><label for="beta">Beta access code</label><input id="beta" name="beta_code" type="text" required placeholder="FORGE-…"><p class="hint">Private beta — email hello@woodwardsoftware.com for a code.</p></div>
          <button class="btn ember" style="width:100%" type="submit">Open my account</button>` : `<button class="btn ember" style="width:100%" type="submit">Email me a sign-in link</button>`}
        </form>
        <hr class="rule" style="margin:1.3rem 0">
        ${googleEnabled
          ? `<a class="btn ghost" style="width:100%" href="/auth/google">Continue with Google</a>`
          : `<button class="btn ghost" style="width:100%" disabled title="Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable">Continue with Google (not configured)</button>`}
        <p class="hint" style="margin-top:.9rem">New here? Same form — your account is created on first sign-in.</p>
      </div>
    </div></section>`,
  });
}

export function legalPage({ user, kind }) {
  const bodies = {
    privacy: ["Privacy Policy", `<p>WSS Launch collects the minimum needed to run the service: your email, the business details you provide, and content discovered from sources you point us at (your website, your Google Business Profile). We use it to build and host your sites. We don't sell your data, and we don't run ad trackers on this product.</p><p>Discovered content stays attached to your project and is deleted when you delete the project. Payment details are handled by Stripe and never touch our servers.</p><p class="muted">Placeholder for counsel review before public launch. Contact: hello@woodwardsoftware.com</p>`],
    terms: ["Terms of Service", `<p>WSS Launch forges websites from content you provide or approve. You're responsible for having the rights to that content and for the accuracy of claims about your business. We enforce a no-fabrication policy: the engine will not invent reviews, awards, or credentials — please don't ask it to.</p><p>Paid plans renew until canceled; you can export your site on plans that include export. Failed builds never consume your quota. Service is provided as-is during the launch period.</p><p class="muted">Placeholder for counsel review before public launch.</p>`],
    accessibility: ["Accessibility", `<p>Every WSS Launch website is checked for readable colors, keyboard access, helpful image descriptions, visible focus, and reduced-motion support. This product website follows the same standards. Found an issue? <a href="/support">Tell us</a> and we will treat it as a priority.</p>`],
  };
  const [title, html] = bodies[kind];
  return page({ title, desc: `${title} for WSS Launch.`, path: `/legal/${kind}`, user, body: `<section class="section"><div class="wrap" style="max-width:760px"><p class="eyebrow">Legal</p><h1>${title}</h1>${html}</div></section>` });
}

export function supportPage({ user }) {
  return page({
    title: "Support", desc: "Get help with WSS Launch.", path: "/support", user,
    body: `<section class="section"><div class="wrap" style="max-width:680px">
      <p class="eyebrow">Real human help</p><h1>Tell us where you are stuck.</h1>
      <p>Email <a href="mailto:hello@woodwardsoftware.com">hello@woodwardsoftware.com</a> and a real person will reply, usually the same day and always within one business day. Customers on Care+ and Agency plans receive priority help.</p>
      <div class="panel"><h3>A few quick places to look</h3><ul class="qc-list">
        <li class="pass"><span class="mark">→</span><span class="detail">Website not ready to publish? Open the Review tab to see what still needs attention.</span></li>
        <li class="pass"><span class="mark">→</span><span class="detail">Sign-in link missing? Check spam, then request a fresh one; links expire after 15 minutes.</span></li>
        <li class="pass"><span class="mark">→</span><span class="detail">Web address not connecting? The Publish tab shows the settings to share with your domain company.</span></li>
      </ul></div>
    </div></section>`,
  });
}

export function devInboxPage({ user, messages }) {
  const rows = messages.map((m) => `<tr><td>${esc(m.created_at?.slice(0, 19).replace("T", " ") || "")}</td><td>${esc(m.to || "")}</td><td>${esc(m.subject || "")}</td><td style="font-family:var(--font-mono);font-size:.8rem">${m.link ? `<a href="${esc(m.link)}">${esc(m.link)}</a>` : esc((m.body || "").slice(0, 140))}</td></tr>`).join("");
  return page({
    title: "Dev inbox", desc: "Local email inbox for development.", user, noindex: true,
    body: `<section class="section"><div class="wrap">
      <p class="eyebrow">Development</p><h1>Dev inbox</h1>
      <p class="muted">No email provider is configured (set <code>RESEND_API_KEY</code> for real delivery), so outbound mail lands here. This page only exists in dev mode.</p>
      <div class="panel flush"><table class="data"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Content</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted" style="padding:2rem">Nothing sent yet.</td></tr>'}</tbody></table></div>
    </div></section>`,
  });
}
