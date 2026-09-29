// SiteForge SaaS — authenticated app pages.
import { esc, fmtMoney, fmtDate } from "../lib/util.mjs";
import { page } from "./layout.mjs";
import { HERO_FAMILIES, SECTION_TOGGLES, GOALS } from "../lib/engine-adapter.mjs";
import { industryOptions, stateOptions, priceCard } from "./pages-public.mjs";
import { CATALOG } from "../lib/billing.mjs";
import { mediaEnginePanel, logoCandidateBar, scorecardPanel, sourceChip } from "./v7-partials.mjs";

const gradeBadge = (g) => `<span class="grade ${g || "unknown"}" title="Website quality rating">${g || "–"}</span>`;
const statusChip = (s) => {
  const map = { draft: ["chip", "Getting started"], discovery_ready: ["chip warn", "Details ready"], generating: ["chip warn", "Making website…"], preview_ready: ["chip ok", "Ready to review"], published: ["chip ok", "Published"] };
  const [cls, label] = map[s] || ["chip", s || "New"];
  return `<span class="${cls}">${label}</span>`;
};

export function dashboard({ user, projects, ent, gens }) {
  const rows = projects.map((p) => `
    <tr>
      <td><a href="/p/${p.id}"><b>${esc(p.name)}</b></a><br><small class="muted">${esc(p.city || "")}${p.city ? ", " : ""}${esc(p.state || "")} · ${esc(p.industry || "")}</small></td>
      <td>${statusChip(p.status)}</td>
      <td>${p.last_grade ? gradeBadge(p.last_grade) : '<span class="muted">not checked yet</span>'}</td>
      <td>${p.deploy_url ? `<a href="${esc(p.deploy_url)}" target="_blank" rel="noopener">${esc(p.deploy_url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : '<span class="muted">—</span>'}</td>
      <td><a class="btn ghost sm" href="/p/${p.id}">Open</a></td>
    </tr>`).join("");
  return page({
    title: "My websites", desc: "Your WSS Launch websites.", path: "/dashboard", user, noindex: true,
    body: `<section class="section" style="padding-top:2rem"><div class="wrap">
      <div class="app-head">
        <div><p class="eyebrow">My websites</p><h1 style="font-size:2.2rem;margin:0">${esc(user.name || "Your")} websites</h1></div>
        <a class="btn ember" href="/new">+ Start a website</a>
      </div>
      <div class="stat-row" style="margin-bottom:1.8rem">
        <div class="stat"><b>${projects.length}</b><span>websites</span></div>
        <div class="stat"><b>${gens.used}/${gens.max}</b><span>new versions this month</span></div>
        <div class="stat"><b>${esc(ent.plan_name)}</b><span>plan${ent.subscription?.mode === "mock" ? " (mock)" : ent.subscription?.mode === "stripe-test" ? " (test)" : ""}</span></div>
        <div class="stat"><b>${projects.filter((p) => p.status === "published").length}</b><span>published</span></div>
      </div>
      ${projects.length ? `<div class="panel flush"><table class="data">
        <thead><tr><th>Website</th><th>Status</th><th>Quality</th><th>Web address</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty"><h3>Let us make your first website.</h3><p>Start with your business name and location. Add your current website or Google page if you have one.</p><a class="btn ember" href="/new">Start my website</a></div>`}
      <p class="muted" style="margin-top:1.4rem;font-size:.88rem">Need a person? <a href="/support">Get help</a> · Change your plan in <a href="/account">Account</a>.</p>
    </div></section>`,
  });
}

export function wizardPage({ user, csrf }) {
  const styleCards = HERO_FAMILIES.map((f, i) => `
    <label class="asset" style="cursor:pointer">
      <input type="radio" name="hero_family" value="${f.key}" ${i === 0 ? "" : ""} style="accent-color:var(--ember)">
      <span class="kind">${esc(f.name)}</span><span style="font-size:.83rem;color:var(--ink-2)">${esc(f.blurb)}</span>
    </label>`).join("");
  const goalOpts = GOALS.map((g) => `<label class="chip" style="cursor:pointer;padding:.5rem 1rem"><input type="radio" name="goal" value="${g}" ${g === "calls" ? "checked" : ""} style="accent-color:var(--ember);margin-right:.4rem">${g[0].toUpperCase() + g.slice(1)}</label>`).join(" ");
  return page({
    title: "Start a website", desc: "Tell WSS Launch about your business.", path: "/new", user, noindex: true,
    body: `<section class="section" style="padding-top:2rem"><div class="wrap" style="max-width:760px">
      <p class="eyebrow">Start a website</p><h1 style="font-size:2.2rem">Tell us about your business.</h1>
      <p>Three short steps. Use what you know and skip anything you do not have.</p>
      <div class="steps"><span>1 · Your business</span><span>2 · Helpful links</span><span>3 · Look & purpose</span></div>
      <form id="wizard" method="post" action="/api/projects">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <div class="wiz-step panel">
          <div class="field"><label for="w-name">Business name</label><input id="w-name" name="business_name" type="text" required maxlength="80" placeholder="Summit Roofing"></div>
          <div class="grid-2">
            <div class="field"><label for="w-city">City</label><input id="w-city" name="city" type="text" required maxlength="60" placeholder="Plano"></div>
            <div class="field"><label for="w-state">State</label><select id="w-state" name="state">${stateOptions("TX")}</select></div>
          </div>
          <div class="grid-2">
            <div class="field"><label for="w-ind">Industry</label><select id="w-ind" name="industry">${industryOptions("roofing")}</select></div>
            <div class="field"><label for="w-phone">Phone <span class="muted" style="text-transform:none">(optional)</span></label><input id="w-phone" name="phone" type="tel" maxlength="20" placeholder="(214) 555-0148"></div>
          </div>
          <div class="btn-row" style="justify-content:end"><button class="btn" type="button" data-next>Next: add helpful links →</button></div>
        </div>
        <div class="wiz-step panel" hidden>
          <div class="field"><label for="w-site">Current website <span class="muted" style="text-transform:none">(optional)</span></label><input id="w-site" name="website" type="url" maxlength="200" placeholder="https://summitroofingtx.com"><p class="hint">We can reuse your best words, services, colors, and photos.</p></div>
          <div class="field"><label for="w-gbp">Google Maps or business page <span class="muted" style="text-transform:none">(optional)</span></label><input id="w-gbp" name="gbp_url" type="url" maxlength="300" placeholder="https://maps.google.com/…"><p class="hint">This helps us find your hours, reviews, photos, location, and contact details.</p></div>
          <div class="field"><label for="w-services">Services <span class="muted" style="text-transform:none">(comma-separated, optional)</span></label><input id="w-services" name="services" type="text" maxlength="400" placeholder="Roof replacement, storm repair, gutters"></div>
          <div class="btn-row" style="justify-content:space-between"><button class="btn ghost" type="button" data-back>← Back</button><button class="btn" type="button" data-next>Next: choose the look →</button></div>
        </div>
        <div class="wiz-step panel" hidden>
          <div class="field"><label>Website size</label>
            <label class="chip" style="cursor:pointer;padding:.5rem 1rem;margin-right:.5rem"><input type="radio" name="build_type" value="single_page_cinematic" checked style="accent-color:var(--ember);margin-right:.4rem">One-page website</label>
            <label class="chip" style="cursor:pointer;padding:.5rem 1rem"><input type="radio" name="build_type" value="premier_multi_page" style="accent-color:var(--ember);margin-right:.4rem">Full multi-page website</label>
            <p class="hint">One page keeps everything in one smooth visit. Multi-page adds separate pages for your story, services, service areas, common questions, and contact details.</p>
          </div>
          <div class="field"><label>Primary goal</label><div class="btn-row">${goalOpts}</div></div>
          <div class="field"><label>Website style <span class="muted" style="text-transform:none">(optional — we can choose for you)</span></label>
            <div class="asset-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
              <label class="asset" style="cursor:pointer"><input type="radio" name="hero_family" value="" checked style="accent-color:var(--ember)"><span class="kind">Choose for me</span><span style="font-size:.83rem;color:var(--ink-2)">WSS Launch will choose a strong direction for your kind of business. Recommended.</span></label>
              ${styleCards}
            </div>
          </div>
          <div class="btn-row" style="justify-content:space-between"><button class="btn ghost" type="button" data-back>← Back</button><button class="btn ember" type="submit">Find my details and start</button></div>
        </div>
      </form>
    </div></section>`,
  });
}

export function projectShell({ user, project, tab, inner, notice = "" }) {
  const tabs = [["", "Overview"], ["discovery", "Business details"], ["build", "Make website"], ["preview", "Review"], ["publish", "Publish"]];
  return page({
    title: project.name, desc: `Project ${project.name}`, user, noindex: true,
    body: `<section class="section" style="padding-top:2rem"><div class="wrap">
      <div class="app-head">
        <div><p class="eyebrow">Website</p><h1 style="font-size:2rem;margin:0">${esc(project.name)} ${statusChip(project.status)}</h1>
        <small class="muted">${esc(project.city || "")}${project.city ? ", " : ""}${esc(project.state || "")} · ${esc(project.industry || "")}${project.hero_family ? ` · ${esc(project.hero_family)}` : ""}</small></div>
        <div class="btn-row">${project.last_grade ? gradeBadge(project.last_grade) : ""}</div>
      </div>
      <div class="tabs">${tabs.map(([t, label]) => `<a href="/p/${project.id}${t ? "/" + t : ""}" class="${t === tab ? "active" : ""}">${label}</a>`).join("")}</div>
      ${notice}
      ${inner}
    </div></section>`,
  });
}

export function projectOverview({ user, project, profile, gens, edits, csrf }) {
  const genRows = gens.map((g) => `<tr>
    <td>v${g.version} ${Number(project.active_version) === g.version ? '<span class="chip ok">active</span>' : ""}</td><td>${esc(g.hero_family || "—")}</td><td>${esc(g.build_type || "")}</td>
    <td>${g.qc_grade ? gradeBadge(g.qc_grade) : esc(g.status)}</td>
    <td>${g.status === "done" ? `<a href="/preview/${project.id}/${g.version}/" target="_blank" rel="noopener">open</a> · <a href="/p/${project.id}/preview?v=${g.version}">review</a> ${Number(project.active_version) === g.version ? "" : `· <form method="post" action="/api/projects/${project.id}/revert" style="display:inline"><input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="version" value="${g.version}"><button class="link-btn" type="submit">use this version</button></form>`}` : esc(g.status)}</td>
    <td class="muted">${fmtDate(g.created_at)}</td></tr>`).join("");
  const editRows = edits.map((e) => `<tr><td>${fmtDate(e.created_at)}</td><td>${esc(e.message)}</td><td><span class="chip ${e.status === "done" ? "ok" : "warn"}">${esc(e.status)}</span></td></tr>`).join("");
  return projectShell({
    user, project, tab: "",
    inner: `
    <div class="grid-2">
      <div class="panel"><h3>Business</h3>
        <table class="data"><tbody>
          <tr><td class="muted">Name</td><td>${esc(profile.business_name)}</td></tr>
          <tr><td class="muted">Location</td><td>${esc(profile.city)}, ${esc(profile.state)}</td></tr>
          <tr><td class="muted">Industry</td><td>${esc(profile.industry)}</td></tr>
          <tr><td class="muted">Website</td><td>${profile.website ? `<a href="${esc(profile.website)}" target="_blank" rel="noopener">${esc(profile.website)}</a>` : "—"}</td></tr>
          <tr><td class="muted">Google page</td><td>${profile.gbp_url ? `<a href="${esc(profile.gbp_url)}" target="_blank" rel="noopener">open</a>` : "—"}</td></tr>
          <tr><td class="muted">Goal</td><td>${esc(project.goal || "calls")}</td></tr>
        </tbody></table>
      </div>
      <div class="panel"><h3>Ask us to change something</h3>
        <p style="font-size:.92rem">Tell us what you want in your own words. On Care+ and Agency plans, a person handles the change and confirms it by email.</p>
        <form method="post" action="/api/projects/${project.id}/edit-requests">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <div class="field"><textarea name="message" rows="3" required maxlength="2000" placeholder="Swap the hero photo for the crew shot, and add our Saturday hours."></textarea></div>
          <button class="btn sm" type="submit">Send edit request</button>
        </form>
        <hr class="rule" style="margin:1.2rem 0">
        <h3 style="font-size:1.05rem">Try the change now</h3>
        <p style="font-size:.88rem">Describe the change and WSS Launch will make a new version, check it, and keep your current version safe. Requests involving unconfirmed claims are sent to a person for review.</p>
        ${gens.some((g) => g.status === "done") ? `
        <form method="post" action="/api/projects/${project.id}/prompt-edit">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <div class="field"><textarea name="message" rows="3" required maxlength="2000" placeholder="Use the crew photo at the top, make Saturday hours easier to see, and mention Mission Viejo more clearly."></textarea></div>
          <button class="btn sm ember" type="submit">Make and check this change</button>
        </form>` : `<p class="muted" style="font-size:.88rem">Make your first website version before asking for changes.</p>`}
        ${editRows ? `<table class="data" style="margin-top:1rem"><thead><tr><th>When</th><th>Request</th><th>Status</th></tr></thead><tbody>${editRows}</tbody></table>` : ""}
      </div>
    </div>
    <div class="panel" style="margin-top:1.2rem"><h3>Website versions</h3>
      ${genRows ? `<table class="data"><thead><tr><th>Version</th><th>Top style</th><th>Size</th><th>Quality</th><th>Preview</th><th>When</th></tr></thead><tbody>${genRows}</tbody></table>`
      : `<div class="empty"><h3>No website version yet.</h3><p>Check the business details we found, then let WSS Launch make your first version.</p><a class="btn ember" href="/p/${project.id}/discovery">Review business details</a></div>`}
    </div>`,
  });
}

export function projectDiscovery({ user, project, profile, assets, csrf, jobId = null }) {
  const d = project.discovery;
  const foundBar = d ? `<div class="stat-row" style="margin-bottom:1.4rem">
      <div class="stat"><b>${d.logo_found ? "✓" : "–"}</b><span>logo</span></div>
      <div class="stat"><b>${d.colors_found}</b><span>brand colors</span></div>
      <div class="stat"><b>${d.photos_found}</b><span>photos</span></div>
      <div class="stat"><b>${d.services_found}</b><span>services</span></div>
      <div class="stat"><b>${d.socials_found}</b><span>social links</span></div>
      <div class="stat"><b>${d.map_found ? "✓" : "–"}</b><span>map pin</span></div>
    </div>
    ${d.seo_gaps?.length ? `<div class="notice warn"><b>Things your current website may be missing:</b> ${d.seo_gaps.map(esc).join(" · ")}. WSS Launch will address these in the new website.</div>` : ""}` : "";
  const grouped = {};
  for (const a of assets) (grouped[a.kind] ??= []).push(a);
  const order = ["logo", "color", "photo", "service", "review", "contact", "social", "citation", "map"];
  const sections = order.filter((k) => grouped[k]?.length).map((k) => `
    <h3 style="margin-top:1.6rem;text-transform:capitalize">${k === "citation" ? "Citations & profiles" : k + "s"}</h3>
    <div class="asset-grid">${grouped[k].map((a) => assetCard(a)).join("")}</div>`).join("");
  return projectShell({
    user, project, tab: "discovery",
    inner: `
    <div class="grid-2" style="align-items:start">
      <div>
        <h2 style="font-size:1.5rem">Gather my business details</h2>
        <p style="font-size:.95rem">WSS Launch checks your current website${project.gbp_url ? " and Google page" : ""} for useful details such as your logo, colors, photos, services, and reviews. You choose what belongs on the new website.</p>
        <form method="post" action="/api/projects/${project.id}/discover">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button class="btn ember" type="submit">${d ? "Check for updated details" : "Find my business details"}</button>
          ${!process.env.FIRECRAWL_API_KEY ? `<p class="hint" style="margin-top:.5rem">Automatic lookup is temporarily unavailable. You can still add your photos, logo, services, and reviews below.</p>` : ""}
        </form>
      </div>
      <div class="panel"><h3>Add something we missed</h3>
        <form method="post" action="/api/projects/${project.id}/assets">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <div class="grid-2">
            <div class="field"><label>Kind</label><select name="kind"><option>photo</option><option>logo</option><option>service</option><option>review</option><option>color</option><option>social</option></select></div>
            <div class="field"><label>Label / text</label><input name="label" type="text" maxlength="200" placeholder="Crew photo, spring 2026"></div>
          </div>
          <div class="field"><label>URL (for photos/logos/socials)</label><input name="url" type="url" maxlength="400" placeholder="https://…"></div>
          <button class="btn sm" type="submit">Add to my website</button>
        </form>
      </div>
    </div>
    ${mediaEnginePanel({ project, profile: profile || {}, csrf })}
    ${logoCandidateBar(assets, project, csrf)}
    ${foundBar}
    ${sections || `<div class="empty" style="margin-top:1.5rem"><h3>We have not found any details yet.</h3><p>Try the automatic lookup, add your Google page, or upload what you already have.</p></div>`}
    ${assets.length ? `<div class="btn-row" style="margin-top:1.8rem"><a class="btn ember" href="/p/${project.id}/build">Continue to my website →</a><span class="muted" style="font-size:.87rem">Turn off anything you do not want included. It will remain saved for later.</span></div>` : ""}`,
  });
}

function assetCard(a) {
  const body =
    a.kind === "photo" || a.kind === "logo" ? `<img src="${esc(a.url)}" alt="${esc(a.label || a.kind)}" loading="lazy">` :
    a.kind === "color" ? `<div class="swatch" style="background:${esc((a.meta?.value?.hex || a.meta?.value || a.label || "#ccc"))}"></div>` : "";
  const quality = a.meta?.quality_status ? `<span class="hint">${esc(a.meta.quality_status)}${a.meta?.fallback_to_ambiance ? " - ambiance fallback until replaced" : a.meta?.treatment ? ` - ${esc(a.meta.treatment)}` : ""}</span>` : "";
  return `<div class="asset ${a.approved ? "" : "off"}">
    <span class="kind">${esc(a.kind)} ${sourceChip(a.origin === "upload" ? "upload" : a.origin === "ai-candidate" ? "ai" : a.source)}</span>
    ${body}
    <span>${esc(a.label || a.url || "")}</span>
    ${quality}
    <label style="display:flex;gap:.4rem;align-items:center;text-transform:none;letter-spacing:0;font-size:.82rem;margin:0">
      <input type="checkbox" data-asset-toggle="${a.id}" ${a.approved ? "checked" : ""} style="accent-color:var(--ember)"> use this
    </label>
  </div>`;
}

export function projectBuild({ user, project, gens, csrf, jobId = null, gate }) {
  const heroOpts = [`<option value="">Choose the best style for me</option>`]
    .concat(HERO_FAMILIES.map((f) => `<option value="${f.key}" ${project.hero_family === f.key ? "selected" : ""}>${f.name}</option>`)).join("");
  const sectionBoxes = SECTION_TOGGLES.map((s) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="sections_off" value="${s.key}" style="accent-color:var(--ember);margin-right:.35rem">skip ${s.label}</label>`).join(" ");
  const last = gens[0];
  return projectShell({
    user, project, tab: "build",
    inner: `
    ${jobId ? `<div class="panel" style="margin-bottom:1.4rem"><h3>Making your website now</h3>
      <ul id="forge-timeline" class="timeline" data-job="${jobId}" data-redirect="/p/${project.id}/preview"></ul>
      <div id="forge-result" style="margin-top:.8rem"><span class="spinner"></span> <span class="muted">You can watch each step as it happens.</span></div></div>` : ""}
    <div class="grid-2" style="align-items:start">
      <div class="panel">
        <h3>What should your website say and feel like?</h3>
        <form method="post" action="/api/projects/${project.id}/generate">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <div class="field"><textarea name="prompt" rows="4" maxlength="4000" placeholder="Family-run since 2008. We want storm-repair front and center, warm but no-nonsense tone, and the crew photo in the hero.">${esc(last?.prompt || "")}</textarea>
          <p class="hint">Use your own words. We will only include facts you provide or that we can confirm.</p></div>
          <div class="grid-2">
            <div class="field"><label>Website size</label><select name="build_type">
              <option value="single_page_cinematic" ${last?.build_type !== "premier_multi_page" ? "selected" : ""}>One-page website</option>
              <option value="premier_multi_page" ${last?.build_type === "premier_multi_page" ? "selected" : ""}>Full multi-page website</option>
            </select></div>
            <div class="field"><label>Top-of-page style</label><select name="hero_family">${heroOpts}</select></div>
          </div>
          <div class="field"><label>Anything you do not need?</label><div class="btn-row" style="gap:.45rem">${sectionBoxes}</div></div>
          <div class="field"><label style="display:inline-flex;gap:.45rem;align-items:center"><input type="checkbox" name="video_prompt" value="1" style="accent-color:var(--ember)"> Plan a cinematic video opening</label></div>
          ${gate.ok
            ? `<button class="btn ember" type="submit" style="width:100%">Make my website (${gate.max - gate.used} versions left this month)</button>`
            : `<div class="notice warn">You have used all ${gate.max} website versions included this month on the ${esc(gate.ent.plan_name)} plan. <a href="/pricing">See plans with more versions</a>.</div>`}
        </form>
      </div>
      <div>
        <div class="panel"><h3>Change just one part</h3>
          ${last && last.status === "done" ? `
          <p style="font-size:.9rem">Keep everything else and remake only the part you choose. Your current version stays safe.</p>
          <div class="btn-row">
            ${["hero", "copy", "gallery", "map"].map((t) => `
            <form method="post" action="/api/projects/${project.id}/regenerate" style="display:inline">
              <input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="target" value="${t}">
              <button class="btn ghost sm" type="submit">↻ ${t[0].toUpperCase() + t.slice(1)}</button></form>`).join("")}
          </div>` : `<p class="muted" style="font-size:.9rem">Make your first website version before changing individual parts.</p>`}
        </div>
        <div class="panel" style="margin-top:1.2rem"><h3>What WSS Launch checks for you</h3>
          <ul class="qc-list" style="font-size:.85rem">
            <li class="pass"><span class="mark">✓</span><span class="detail">A polished opening that does not look like a reused template</span></li>
            <li class="pass"><span class="mark">✓</span><span class="detail">Clear, natural writing without empty marketing phrases</span></li>
            <li class="pass"><span class="mark">✓</span><span class="detail">The search information Google and AI assistants need</span></li>
            <li class="pass"><span class="mark">✓</span><span class="detail">Phones, accessibility, motion preferences, links, and forms</span></li>
          </ul>
        </div>
      </div>
    </div>`,
  });
}

export function projectPreview({ user, project, gen, qc, csrf, version, scorecard = null, seo = null, reportUrl = "" }) {
  if (!gen) {
    return projectShell({ user, project, tab: "preview", inner: `<div class="empty"><h3>Your preview is not ready yet.</h3><p>Make the first website version. It usually takes about a minute.</p><a class="btn ember" href="/p/${project.id}/build">Make my website</a></div>` });
  }
  const results = qc?.results || [];
  const qcRows = results.map((r) => `<li class="${r.deferred ? "defer" : r.pass ? "pass" : "fail"}"><span class="mark">${r.deferred ? "◔" : r.pass ? "✓" : "✗"}</span><span class="name">${esc(r.name)}</span><span class="detail">${esc(r.detail || "")}</span></li>`).join("");
  return projectShell({
    user, project, tab: "preview",
    inner: `
    <div class="grid-2" style="grid-template-columns: 2.2fr 1fr; align-items:start">
      <div>
        <div class="device-bar"><span class="dots"><i></i><i></i><i></i></span>
          <span style="flex:1;font-family:var(--font-mono);font-size:.78rem">${esc(project.slug)} · v${gen.version}</span>
          <button class="btn sm ghost" data-device="desktop" type="button">Desktop</button>
          <button class="btn sm" data-device="mobile" type="button">Mobile</button>
          <a class="btn sm ghost" href="/preview/${project.id}/${gen.version}/" target="_blank" rel="noopener">Open ↗</a>
          ${reportUrl ? `<a class="btn sm ghost" href="${esc(reportUrl)}" target="_blank" rel="noopener">Share report</a>` : ""}
        </div>
        <div class="preview-frame-wrap"><iframe src="/preview/${project.id}/${gen.version}/" title="Site preview" loading="lazy"></iframe></div>
      </div>
      <div>
        <div class="panel" style="text-align:center">
          ${gradeBadge(gen.qc_grade)}
          <h3 style="margin:.6rem 0 .2rem">Quality ${qc?.score ?? "–"}/100</h3>
          <p class="muted" style="font-size:.85rem;margin:0">${gen.qc_grade === "A" ? "All important checks passed. Ready to publish." : qc?.degraded ? "A few visual checks still need to finish before publishing." : "Review the items below or make a new version."}</p>
        </div>
        ${scorecardPanel(scorecard, seo)}
        <div class="panel" style="margin-top:1rem"><h3>What we checked</h3><ul class="qc-list">${qcRows || '<li class="muted">The quality report is not available yet.</li>'}</ul></div>
        <div class="panel" style="margin-top:1rem"><h3>Not right yet?</h3>
          <div class="btn-row">
            ${["hero", "copy"].map((t) => `<form method="post" action="/api/projects/${project.id}/regenerate"><input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="target" value="${t}"><button class="btn ghost sm" type="submit">↻ ${t}</button></form>`).join("")}
            <a class="btn sm ember" href="/p/${project.id}/publish">Publish →</a>
          </div>
          <form method="post" action="/api/projects/${project.id}/prompt-edit" style="margin-top:1rem">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <div class="field"><textarea name="message" rows="3" required maxlength="2000" placeholder="Add service-area emphasis, tighten the hero CTA, and make the gallery feel more premium."></textarea></div>
            <button class="btn sm" type="submit">Make and check this change</button>
          </form>
        </div>
      </div>
    </div>`,
  });
}

export function projectPublish({ user, project, gen, ent, deployments, csrf, baseUrl }) {
  const canPublish = ent.can_publish;
  const gradeOk = gen?.qc_grade === "A" || (gen?.qc_grade === "B" && gen?.degraded !== false);
  const deployRows = deployments.map((d) => `<tr><td>${fmtDate(d.created_at)}</td><td>${esc(d.target === "custom-domain" ? "Your web address" : "WSS Launch address")}</td><td>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a>` : "—"}</td><td><span class="chip ${d.status === "live" ? "ok" : "warn"}">${esc(d.status === "live" ? "Live" : "Being connected")}</span></td></tr>`).join("");
  const custom = deployments.find((d) => d.target === "custom-domain");
  const dns = custom?.meta?.dns || [];
  const verification = custom?.meta?.verification || [];
  return projectShell({
    user, project, tab: "publish",
    inner: `
    ${!gen ? `<div class="empty"><h3>Make your website first.</h3><a class="btn ember" href="/p/${project.id}/build">Make my website</a></div>` : `
    <div class="grid-2" style="align-items:start">
      <div class="panel">
        <h3>Make version ${gen.version} public</h3>
        <ul class="qc-list">
          <li class="${gradeOk ? "pass" : "fail"}"><span class="mark">${gradeOk ? "✓" : "✗"}</span><span class="detail">${gradeOk ? "All important quality checks passed" : "This version needs a few fixes before it can go public"}</span></li>
          <li class="${canPublish ? "pass" : "fail"}"><span class="mark">${canPublish ? "✓" : "✗"}</span><span class="detail">${canPublish ? `Publishing is included in your ${esc(ent.plan_name)} plan` : "Choose a paid plan when you are ready to publish"}</span></li>
        </ul>
        ${canPublish && gradeOk ? `
        <form method="post" action="/api/projects/${project.id}/publish">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button class="btn ember" style="width:100%" type="submit">Publish my website</button>
          <p class="hint" style="margin-top:.5rem">Your WSS Launch web address will work immediately. You can connect your own address below.</p>
        </form>` : !canPublish ? `
        <div class="price-grid" style="grid-template-columns:1fr">${priceCard(CATALOG.plans.find((p) => p.key === "starter"))}</div>` : `
        <a class="btn" href="/p/${project.id}/build">Make a corrected version</a>`}
      </div>
      <div>
        <div class="panel"><h3>Use your own web address</h3>
          ${ent.can_custom_domain ? `
          <ol style="font-size:.92rem;color:var(--ink-2);padding-left:1.2rem;line-height:1.8">
            <li>Enter the web address you own, such as <code>summitroofingtx.com</code>.</li>
            <li>WSS Launch will tell you exactly which settings need to be changed.</li>
            <li>Share those instructions with your domain company, or ask us for help.</li>
            <li>Once connected, your website will automatically use a secure connection.</li>
          </ol>
          <form method="post" action="/api/projects/${project.id}/domain">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <div class="field"><input name="domain" type="text" maxlength="120" placeholder="summitroofingtx.com" pattern="[a-z0-9.-]+\\.[a-z]{2,}"></div>
            <button class="btn sm" type="submit">Connect my web address</button>
          </form>
          ${custom ? `<div class="panel" style="margin-top:1rem"><h4>Connection status</h4><p><span class="chip ${custom.status === "live" ? "ok" : "warn"}">${esc(custom.status === "live" ? "Connected" : "Waiting for domain settings")}</span></p>${dns.length ? `<p class="hint">Send these settings to your domain company:</p><ul>${dns.map((row) => `<li><code>${esc(row.type)} ${esc(row.name)} → ${esc(row.value)}</code></li>`).join("")}</ul>` : ""}${verification.length ? `<ul>${verification.map((row) => `<li><code>${esc(row.type)} ${esc(row.domain)} → ${esc(row.value)}</code></li>`).join("")}</ul>` : ""}<form method="post" action="/api/projects/${project.id}/domain-verify"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn sm ghost" type="submit">Check the connection</button></form></div>` : ""}` : `<p class="muted" style="font-size:.9rem">Using your own web address is included with every paid plan.</p>`}
        </div>
        <div class="panel" style="margin-top:1.2rem"><h3>Published versions</h3>
          ${deployRows ? `<table class="data"><thead><tr><th>When</th><th>Web address</th><th>Link</th><th>Status</th></tr></thead><tbody>${deployRows}</tbody></table>` : `<p class="muted" style="font-size:.9rem">Your website has not been published yet.</p>`}
        </div>
      </div>
    </div>`}`,
  });
}

export function accountPage({ user, ent, sub, csrf }) {
  return page({
    title: "Account", desc: "Billing and account.", path: "/account", user, noindex: true,
    body: `<section class="section" style="padding-top:2rem"><div class="wrap" style="max-width:820px">
      <p class="eyebrow">Account</p><h1 style="font-size:2.2rem">Billing & plan</h1>
      <div class="grid-2" style="align-items:start">
        <div class="panel"><h3>Current plan</h3>
          <div class="price" style="font-size:1.8rem">${esc(ent.plan_name)}</div>
          ${sub ? `<p class="muted" style="font-size:.88rem">${esc(sub.status === "active" ? "Active" : sub.status)} · next renewal ${fmtDate(sub.current_period_end)}</p>` : `<p class="muted" style="font-size:.88rem">Free plan. Make and review your website without paying.</p>`}
          <ul class="qc-list" style="font-size:.9rem">
            <li class="pass"><span class="mark">→</span><span class="detail">${ent.limits.projects} website${ent.limits.projects > 1 ? "s" : ""} · ${ent.limits.generations_per_month} new versions each month</span></li>
            <li class="${ent.can_publish ? "pass" : "fail"}"><span class="mark">${ent.can_publish ? "✓" : "✗"}</span><span class="detail">Publishing</span></li>
            <li class="${ent.can_custom_domain ? "pass" : "fail"}"><span class="mark">${ent.can_custom_domain ? "✓" : "✗"}</span><span class="detail">Use your own web address</span></li>
            <li class="${ent.can_edit_requests ? "pass" : "fail"}"><span class="mark">${ent.can_edit_requests ? "✓" : "✗"}</span><span class="detail">Changes handled by our team</span></li>
          </ul>
          <div class="btn-row">
            <a class="btn sm" href="/pricing">Change plan</a>
            ${sub && sub.plan_key !== "free" ? `<a class="btn ghost sm" href="/billing/portal">Manage billing</a>` : ""}
          </div>
        </div>
        <div class="panel"><h3>Add-ons</h3>
          ${ent.addons.length ? `<div class="btn-row">${ent.addons.map((a) => `<span class="chip ok">${esc(a)}</span>`).join("")}</div>` : `<p class="muted" style="font-size:.9rem">No add-ons yet.</p>`}
          <p style="font-size:.9rem;margin-top:.8rem">Add help answering calls, showing up in local search, or chatting with website visitors. <a href="/pricing#upgrades">See optional extras</a>.</p>
          <hr class="rule" style="margin:1.1rem 0">
          <h3>Profile</h3>
          <p style="font-size:.9rem" class="muted">${esc(user.email)} · signed in with ${esc(user.auth_provider)}</p>
        </div>
      </div>
    </div></section>`,
  });
}

export function mockCheckoutPage({ item, refId, t, csrf }) {
  return page({
    title: "Checkout (test)", desc: "WSS Launch mock checkout.", noindex: true,
    body: `<section class="section"><div class="wrap" style="max-width:520px">
      <p class="eyebrow">Checkout · test mode</p>
      <h1 style="font-size:2rem">${esc(item.name)}</h1>
      <div class="notice warn"><b>No real payment happens here.</b> Stripe isn't configured, so this is WSS Launch's built-in mock checkout. With <code>STRIPE_SECRET_KEY</code> (test) set, this page is replaced by real Stripe test checkout.</div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;font-size:1.1rem"><span>${esc(item.name)}</span><b>${fmtMoney(item.price_cents)}${item.interval ? `/${item.interval}` : ""}</b></div>
        <hr class="rule" style="margin:1rem 0">
        <form method="post" action="/billing/mock-confirm">
          <input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="ref" value="${esc(refId)}"><input type="hidden" name="t" value="${esc(t)}">
          <div class="field"><label>Card number</label><input type="text" value="4242 4242 4242 4242" readonly style="font-family:var(--font-mono)"></div>
          <button class="btn ember" style="width:100%" type="submit">Complete test purchase</button>
        </form>
      </div>
    </div></section>`,
  });
}

export function billingSuccessPage({ user, granted }) {
  return page({
    title: "You're in", desc: "Purchase complete.", user, noindex: true,
    body: `<section class="section"><div class="wrap" style="max-width:560px;text-align:center">
      <p class="eyebrow" style="justify-content:center">Receipt sent</p>
      <h1 style="font-size:2.4rem">Your purchase is ready.</h1>
      <p>${granted ? "Your new plan or service is active now." : "We received your payment. Your new plan or service should be ready within a minute."} A receipt is in your inbox.</p>
      <div class="btn-row" style="justify-content:center"><a class="btn ember" href="/dashboard">Back to dashboard</a></div>
    </div></section>`,
  });
}
