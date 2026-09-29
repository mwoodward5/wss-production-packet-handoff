// Template gallery and try-on pages backed by app/lib/template-library.mjs.
import { esc, kebab } from "../lib/util.mjs";
import { page } from "./layout.mjs";
import { industryOptions, stateOptions, tplPoster } from "./pages-public.mjs";
import { categories, filterTemplates, findTemplate } from "../lib/template-library.mjs";

function sourceNotice(library) {
  if (!library?.source_status) return "";
  const cls = library.source === "siteforge-seed" ? "warn" : "ok";
  const archive = library.inventory_total > library.total ? ` Selected from ${esc(library.inventory_total)} archived Lovable projects; only examples with verified media and a working public site are shown.` : "";
  return `<div class="template-source ${cls}"><span></span><p><b>${esc(library.total)} finished examples ready to explore.</b>${archive}</p></div>`;
}

function categoryNav(library, active = "") {
  const cats = categories(library);
  if (!cats.length) return "";
  const all = `<a class="chip ${!active ? "ok" : ""}" href="/templates">All</a>`;
  return `<div class="template-filters">${all}${cats.map((c) => `<a class="chip ${active === c || active === kebab(c) ? "ok" : ""}" href="/templates/${kebab(c)}">${esc(c)}</a>`).join("")}</div>`;
}

function templateCard(t, i) {
  const poster = t.screenshot_url || tplPoster(t.hero_family, i);
  return `<article class="template-card" id="${esc(t.slug)}">
    <a href="/templates/${esc(t.slug)}" aria-label="Open ${esc(t.name)}">
      <img class="tpl-poster" src="${esc(poster)}" alt="${esc(t.name)} finished website preview" loading="lazy" width="1200" height="750">
      <span class="template-open">Explore this direction <i aria-hidden="true">↗</i></span>
    </a>
    <div class="tpl-body">
      <div class="template-meta"><span>${esc(t.category)}</span><span>Verified live example</span></div>
      <h3>${esc(t.name)}</h3>
      <p>${esc(t.description)}</p>
      ${t.tags?.length ? `<div class="template-tags">${t.tags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
      <div class="template-actions">${t.source_url ? `<a href="${esc(t.source_url)}" target="_blank" rel="noopener">Visit finished site ↗</a>` : ""}<a href="/templates/${esc(t.slug)}">Make it mine →</a></div>
    </div>
  </article>`;
}

export function templatesPage({ user, library, filters = {} }) {
  const active = filters.category || "";
  const shown = filterTemplates(library, filters);
  const heading = active ? `${active.replace(/-/g, " ")} website styles` : "Find a look you love";
  const searchValue = filters.q || "";
  return page({
    title: "Website styles",
    desc: "Browse different website looks, choose one you love, and see it remade around your own business for free.",
    path: active ? `/templates/${active}` : "/templates",
    user,
    body: `<section class="template-hero"><div class="wrap">
      <div class="template-heading"><div><p class="eyebrow">Real sites, not wireframes</p><h1>${esc(heading)}</h1></div><p>Explore finished websites we have already built. Pick a direction, then WSS Launch rebuilds it around your own business, photos, services, and personality.</p></div>
      ${sourceNotice(library)}
      <div class="template-tools"><form class="template-search" method="get" action="/templates"><input name="q" value="${esc(searchValue)}" maxlength="80" placeholder="Search cinematic, editorial, owner-led..."><button type="submit" aria-label="Search styles">Search</button></form>${categoryNav(library, active)}</div>
      <div class="template-gallery">
        ${shown.length ? shown.map(templateCard).join("") : `<div class="empty"><h3>We could not find that style.</h3><p>Try a simpler search, or view all website styles.</p></div>`}
      </div>
    </div></section>`,
  });
}

export function templateTryPage({ user, library, slug }) {
  const t = findTemplate(library, slug);
  if (!t) return null;
  const poster = t.screenshot_url || tplPoster(t.hero_family, 0);
  return page({
    title: `Try the ${t.name} website style`,
    desc: `See the ${t.name} look remade around your business in a free private preview.`,
    path: `/templates/${t.slug}`,
    user,
    body: `<section class="section"><div class="wrap template-detail">
      <div>
        <p class="eyebrow">Try this look</p>
        <h1 style="font-size:clamp(2rem,4vw,3.2rem)">${esc(t.name)}</h1>
        <p>${esc(t.description)}</p>
        <div class="template-meta" style="margin-bottom:1rem"><span class="chip">${esc(t.category)}</span><span class="chip warn">Personalized for you</span></div>
        <img class="tpl-poster template-detail-poster" src="${esc(poster)}" alt="${esc(t.name)} preview" width="720" height="420">
        <div class="notice ok" style="margin-top:1rem">This style is only a starting point. Your finished website will use your own words, photos, colors, and business details.</div>
      </div>
      <div class="panel">
        <h3>See it with my business</h3>
        <p style="font-size:.92rem">Add three simple details. WSS Launch will make a private preview with your business name, location, and type of work.</p>
        <form data-template-try data-endpoint="/api/forge-from-template">
          <input type="hidden" name="template_id" value="${esc(t.id)}">
          <input type="hidden" name="family" value="${esc(t.hero_family)}">
          <div class="field"><label>Business name</label><input name="name" required maxlength="60" type="text" placeholder="Woodward Pool Builders"></div>
          <div class="grid-2">
            <div class="field"><label>City</label><input name="city" required maxlength="40" type="text" placeholder="Mission Viejo"></div>
            <div class="field"><label>State</label><select name="state">${stateOptions("CA")}</select></div>
          </div>
          <div class="field"><label>Industry</label><select name="category">${industryOptions(t.category)}</select></div>
          <button class="btn ember" type="submit" style="width:100%">Make my free preview</button>
          <p class="hint" style="margin-top:.6rem">Your preview is private and stays available for 24 hours. Nothing goes public until you approve it.</p>
        </form>
        <div data-try-result style="margin-top:.9rem"></div>
      </div>
    </div></section>`,
  });
}
