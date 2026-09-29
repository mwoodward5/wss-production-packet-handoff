// Pipeline stage 5 — build: render a static preview site directory.
import { emit } from "../lib/emit.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { blobToPath, seedFrom } from "../lib/hero-seed.mjs";

export async function build(packet, { outDir }) {
  emit("build", "start", { slug: packet.slug });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, "media"), { recursive: true });
  mkdirSync(path.join(outDir, "screenshots", "desktop"), { recursive: true });
  mkdirSync(path.join(outDir, "screenshots", "mobile"), { recursive: true });

  const html = renderSite(packet);
  writeFileSync(path.join(outDir, "index.html"), html);
  writeFileSync(path.join(outDir, "packet.json"), JSON.stringify(packet, null, 2));
  writeFileSync(path.join(outDir, "veo_prompt.json"), JSON.stringify(packet.veo_prompt ?? {}, null, 2));

  emit("build", "render-hero", { family: packet.hero_family });
  for (const section of packet.section_plan ?? []) {
    emit("build", "render-section", { section });
  }

  const screenshots = await captureScreenshots(outDir);

  emit("build", "done", {
    screenshots,
    packet_path: path.join(outDir, "packet.json"),
  });
  return packet;
}

function renderSite(packet) {
  const business = packet.business ?? {};
  const name = escapeHtml(business.name ?? "Local Business");
  const category = escapeHtml(business.category ?? "service");
  const city = escapeHtml(business.city ?? "your city");
  const state = escapeHtml(business.state ?? "");
  const family = escapeHtml(packet.hero_family ?? "cinematic-video-parallax");
  const motif = escapeHtml(packet.motif ?? "material-mesh");
  const seed = seedFrom(packet.slug ?? name, category);
  const blob = blobToPath(seed.blobPoints);
  const logo = logoDataUrl(name, packet.logo_source);
  const palette = paletteFromPacket(packet);
  const photos = photoUrlsFromPacket(packet);
  const heroImage = cssUrl(photos[0] ?? "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1800&q=86");
  const widgetImage = cssUrl(photos[1] ?? photos[0] ?? "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1400&q=86");
  const anatomy = heroAnatomy(packet.slug ?? name);
  const signatureNodes = heroSignatureNodes(packet.slug ?? name, anatomy);
  const type = typeSystem(anatomy);
  const title = heroHeadline(packet, anatomy);
  const intro = heroIntro(packet, anatomy);
  const sourceAreas = packet.enrichment_sources?.service_areas?.value ?? [city];
  const areas = Array.isArray(sourceAreas) ? sourceAreas.map(escapeHtml).join(", ") : city;
  const services = [
    "Landscape refreshes",
    "Outdoor living details",
    "Planting and cleanup",
    "Hardscape repair",
  ];
  const jsonLd = makeJsonLd(packet, services);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${name} | ${city} ${category}</title>
  <meta name="description" content="A polished local website for ${name}, built around clear services, local trust, and a cleaner estimate path." />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=Inter+Tight:wght@500;700;800;900&family=Manrope:wght@400;600;700;800&family=Playfair+Display:wght@700;800&family=Space+Grotesk:wght@500;700&display=swap');
    :root {
      color-scheme: dark;
      --ink: #fff7ea;
      --muted: rgba(255,247,234,.74);
      --line: rgba(255,247,234,.16);
      --accent: ${palette.accent};
      --accent-2: ${palette.accent2};
      --deep: ${palette.deep};
      --shadow: #120d09;
      --panel: rgba(28,21,15,.76);
      --glass: rgba(255,255,255,.09);
      --font-display: ${type.display};
      --font-body: ${type.body};
    }
    * { box-sizing: border-box; }
    html, body { max-width: 100%; }
    img, svg, video { max-width: 100%; }
    body {
      margin: 0;
      font-family: var(--font-body);
      background: radial-gradient(circle at 18% 6%, rgba(255,139,74,.22), transparent 32%),
        radial-gradient(circle at 82% 12%, rgba(113,224,181,.16), transparent 28%),
        #130f0b;
      color: var(--ink);
      overflow-x: hidden;
    }
    a { color: inherit; }
    .shell { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; }
    header.site-head {
      min-height: 96px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      position: relative;
      z-index: 20;
    }
    .brand { display: flex; align-items: center; gap: 16px; text-decoration: none; }
    .brand img { width: 76px; height: 76px; object-fit: contain; border-radius: 22px; box-shadow: 0 18px 40px rgba(0,0,0,.28); }
    .brand strong { display: block; font-family: var(--font-display); font-size: clamp(1.2rem, 2vw, 1.65rem); line-height: 1; }
    .brand span { color: var(--accent); font-weight: 800; font-size: .86rem; }
    nav { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    nav a, .btn {
      border: 1px solid var(--line);
      background: rgba(255,255,255,.06);
      border-radius: 999px;
      padding: 13px 18px;
      text-decoration: none;
      font-weight: 800;
      letter-spacing: 0;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
    }
    .btn.primary { background: linear-gradient(135deg, var(--accent), #ffc667); color: #140c07; border: 0; }
    .hero {
      position: relative;
      min-height: 760px;
      display: grid;
      align-items: center;
      padding: 70px 0 96px;
      isolation: isolate;
      overflow: hidden;
    }
    .hero.hero-diagonal { align-items: start; padding-top: 118px; }
    .hero.hero-centerpiece { text-align: center; }
    .hero.hero-side-rail { padding-left: max(0px, calc((100vw - 1180px) / 2)); }
    .hero.hero-photo-stack { min-height: 820px; }
    .hero video, .hero .still {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: .32;
      filter: saturate(.9) contrast(1.08);
      z-index: -6;
    }
    .hero .still {
      background:
        linear-gradient(125deg, rgba(255,139,74,.22), transparent 44%),
        linear-gradient(24deg, rgba(113,224,181,.16), transparent 52%),
        url("${heroImage}") center/cover;
    }
    .veil { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(19,15,11,.95), rgba(19,15,11,.58) 46%, rgba(19,15,11,.2)); z-index: -5; }
    .grain { position: absolute; inset: 0; opacity: .2; z-index: -4; background-image: radial-gradient(rgba(255,255,255,.24) 1px, transparent 1px); background-size: 4px 4px; mix-blend-mode: soft-light; }
    .motif { position: absolute; inset: 7% 2% auto auto; width: min(46vw, 560px); height: 560px; z-index: -3; opacity: .34; }
    .motif svg { width: 100%; height: 100%; filter: drop-shadow(0 24px 50px rgba(0,0,0,.32)); }
    .overlay { position: absolute; inset: auto 0 0; height: 42%; z-index: -2; background: linear-gradient(0deg, #130f0b, transparent); }
    .signature-node { position: absolute; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; opacity: .28; z-index: -1; pointer-events: none; }
    .signature-node b { display: block; width: 100%; height: 100%; border-radius: inherit; background: linear-gradient(135deg, rgba(255,255,255,.08), transparent); }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, .9fr) minmax(360px, .72fr);
      gap: clamp(28px, 5vw, 72px);
      align-items: center;
    }
    .hero-diagonal .hero-grid { grid-template-columns: minmax(0,.74fr) minmax(420px,.92fr); align-items: start; }
    .hero-centerpiece .hero-grid { grid-template-columns: 1fr; max-width: 960px; text-align: center; }
    .hero-centerpiece .eyebrow, .hero-centerpiece .actions { justify-content: center; }
    .hero-centerpiece h1, .hero-centerpiece .lede { margin-left: auto; margin-right: auto; }
    .hero-side-rail .hero-grid { grid-template-columns: minmax(280px,.48fr) minmax(520px,1fr); }
    .hero-side-rail .hero-grid > div:first-child { padding-left: 36px; border-left: 1px solid rgba(255,255,255,.18); }
    .hero-photo-stack .hero-grid { grid-template-columns: minmax(0,.78fr) minmax(460px,.9fr); }
    .eyebrow { color: var(--accent); font-weight: 900; letter-spacing: .16em; text-transform: uppercase; font-size: .78rem; display: flex; gap: 10px; align-items: center; }
    .eyebrow::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--accent-2); box-shadow: 0 0 22px var(--accent-2); }
    h1 { font-family: var(--font-display); font-size: clamp(3.25rem, 6.1vw, 6.8rem); line-height: .92; max-width: 760px; margin: 24px 0 22px; letter-spacing: 0; overflow-wrap: normal; text-wrap: balance; }
    h1 span { color: var(--accent); }
    .lede { color: var(--muted); max-width: 640px; font-size: clamp(1.1rem, 1.8vw, 1.45rem); line-height: 1.45; }
    .actions { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 34px; }
    .widget {
      position: relative;
      min-height: 560px;
      border-radius: 44px;
      padding: 24px;
      background: linear-gradient(145deg, rgba(255,255,255,.14), rgba(255,255,255,.045));
      border: 1px solid rgba(255,255,255,.18);
      box-shadow: 0 34px 90px rgba(0,0,0,.36);
      overflow: hidden;
      transform: rotate(${family.includes("atlas") ? "-1.6deg" : "1.2deg"});
    }
    .hero-diagonal .widget { border-radius: 24px 64px 24px 64px; clip-path: polygon(9% 0, 100% 0, 91% 100%, 0 100%); transform: rotate(-2.3deg) translateY(18px); }
    .hero-centerpiece .widget { width: min(780px, 100%); min-height: 380px; margin: 28px auto 0; border-radius: 999px 999px 44px 44px; transform: none; }
    .hero-side-rail .widget { border-radius: 18px 120px 18px 46px; transform: rotate(.6deg); }
    .hero-photo-stack .widget { border-radius: 42px 42px 120px 24px; transform: rotate(2.4deg); }
    .widget::before {
      content: "";
      position: absolute;
      inset: 24px;
      border-radius: 36px;
      background: linear-gradient(180deg, rgba(255,255,255,.13), transparent), url("${widgetImage}") center/cover;
      clip-path: path("${blob}");
      filter: hue-rotate(${seed.hueRotate}deg) saturate(1.04);
    }
    .hero-diagonal .widget::before { inset: 18px 34px; border-radius: 20px 52px 20px 52px; clip-path: polygon(4% 0, 100% 0, 93% 100%, 0 100%); }
    .hero-centerpiece .widget::before { inset: 18px; border-radius: 999px 999px 38px 38px; clip-path: ellipse(47% 46% at 50% 50%); }
    .hero-side-rail .widget::before { inset: 20px; border-radius: 14px 96px 14px 38px; clip-path: polygon(0 0, 86% 0, 100% 18%, 92% 100%, 0 100%); }
    .hero-photo-stack .widget::before { inset: 18px; border-radius: 34px 34px 96px 20px; clip-path: polygon(0 5%, 74% 0, 100% 20%, 96% 100%, 10% 92%); }
    .widget-card {
      position: absolute;
      left: 34px;
      right: 34px;
      bottom: 34px;
      padding: 22px;
      border-radius: 26px;
      background: rgba(18,13,9,.76);
      border: 1px solid rgba(255,255,255,.15);
      backdrop-filter: blur(16px);
    }
    .countups { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
    .countups b { font-family: var(--font-display); font-size: 1.9rem; color: var(--accent-2); }
    .marquee { border-block: 1px solid var(--line); color: rgba(255,247,234,.58); padding: 16px 0; overflow: hidden; white-space: nowrap; }
    .marquee span { display: inline-block; padding-right: 44px; }
    section.content { padding: 92px 0; border-top: 1px solid var(--line); }
    .section-grid { display: grid; grid-template-columns: .7fr 1fr; gap: 48px; align-items: start; }
    h2 { font-family: var(--font-display); font-size: clamp(2.2rem, 4vw, 4.8rem); line-height: .94; margin: 0; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 18px; }
    .card { border: 1px solid var(--line); background: var(--glass); border-radius: 28px; padding: 24px; min-height: 160px; }
    .card b { color: var(--accent-2); }
    footer { padding: 46px 0; color: rgba(255,247,234,.55); border-top: 1px solid var(--line); }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } .widget { transform: none; } }
    @media (max-width: 820px) {
      header.site-head { align-items: flex-start; flex-direction: column; }
      .brand img { width: 72px; height: 72px; }
      .hero { min-height: auto; padding-top: 34px; }
      .hero-grid, .hero-diagonal .hero-grid, .hero-centerpiece .hero-grid, .hero-side-rail .hero-grid, .hero-photo-stack .hero-grid, .section-grid, .cards { grid-template-columns: 1fr; }
      .hero-side-rail .hero-grid > div:first-child { padding-left: 0; border-left: 0; }
      .widget { min-height: 430px; border-radius: 30px; transform: none; }
      .widget, .widget-card { max-width: 100%; }
      .widget-card { left: 18px; right: 18px; bottom: 18px; }
      h1 { font-size: clamp(3rem, 14vw, 4.9rem); overflow-wrap: anywhere; }
      nav a { padding: 10px 13px; font-size: .92rem; }
    }
  </style>
</head>
<body>
  <header class="site-head shell">
    <a class="brand" href="#top" aria-label="${name} home">
      <img data-role="logo" alt="${name} logo" src="${logo}" width="76" height="76" />
      <span><strong>${name}</strong><span>${city} ${category}</span></span>
    </a>
    <nav aria-label="Primary"><a href="#services">Services</a><a href="#work">Work</a><a href="#quote">Estimate</a></nav>
  </header>
  <main id="top">
    <section class="hero ${anatomy.className}" data-hero-anatomy="${anatomy.id}" data-layout-signature="${anatomy.signature}">
      <div class="still" aria-hidden="true"></div>
      <div class="veil" aria-hidden="true"></div>
      <div class="grain" aria-hidden="true"></div>
      <div class="motif" aria-hidden="true"><svg viewBox="0 0 1000 1000"><path d="${blob}" fill="none" stroke="rgba(113,224,181,.75)" stroke-width="3"/><path d="${blob}" fill="rgba(255,139,74,.12)"/></svg></div>
      <div class="overlay" aria-hidden="true"></div>
      ${signatureNodes}
      <div class="hero-grid shell">
        <div>
          <div class="eyebrow">${city} ${motif}</div>
          <h1>${title}</h1>
          <p class="lede">${intro}</p>
          <div class="actions"><a class="btn primary" href="#quote">Request an estimate</a><a class="btn" href="#work">See the work</a></div>
        </div>
        <aside class="widget" aria-label="Preview widget">
          <div class="widget-card">
            <b>${areas}</b>
            <p>Clear service areas, visible proof, and a faster estimate path for homeowners who want the outdoor work handled cleanly.</p>
            <div class="countups"><span><b>4</b><br/>service paths</span><span><b>24h</b><br/>reply goal</span><span><b>CA</b><br/>local proof</span></div>
          </div>
        </aside>
      </div>
    </section>
    <div class="marquee"><span>${services.join(" · ")}</span><span>${services.join(" · ")}</span><span>${services.join(" · ")}</span></div>
    <section id="services" class="content shell">
      <div class="section-grid">
        <h2>Built around the work homeowners actually call for.</h2>
        <div class="cards">${services.map((service, i) => `<article class="card"><b>0${i + 1}</b><h3>${escapeHtml(service)}</h3><p>Plain-language service pages, sharp visuals, and quote-ready calls to action make it easier for local visitors to choose the next step.</p></article>`).join("")}</div>
      </div>
    </section>
    <section id="work" class="content shell">
      <div class="section-grid">
        <h2>Real work, framed with more polish.</h2>
        <p class="lede">Photos, service details, and local trust signals are staged so the business feels established before the visitor ever reaches the quote form.</p>
      </div>
    </section>
    <section id="quote" class="content shell">
      <div class="section-grid">
        <h2>Ready when the project is.</h2>
        <div class="card"><p>Send the job type, neighborhood, timeline, and a few photos. The estimate path stays short, direct, and easy to finish.</p><a class="btn primary" href="tel:">Start quote path</a></div>
      </div>
    </section>
  </main>
  <footer class="shell">A cleaner local estimate experience for homeowners ready to start the next outdoor project.</footer>
</body>
</html>`;
}

async function captureScreenshots(outDir) {
  const browser = await chromium.launch();
  const shots = [];
  try {
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1000 },
      mobile: { width: 390, height: 844 },
    })) {
      const page = await browser.newPage({ viewport });
      await page.goto(pathToFileURL(path.resolve(outDir, "index.html")).href);
      for (const [fold, y] of Object.entries({ hero: 0, mid: 820, footer: 1600 })) {
        await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
        const rel = `screenshots/${name}/${fold}.png`;
        await page.screenshot({ path: path.join(outDir, rel), fullPage: false });
        shots.push(rel);
      }
      await page.screenshot({ path: path.join(outDir, "screenshots", name, "full.png"), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return shots;
}

function makeJsonLd(packet, services) {
  const business = packet.business ?? {};
  const siteUrl = `https://example.com/${packet.slug ?? ""}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: business.name,
      address: { "@type": "PostalAddress", addressLocality: business.city, addressRegion: business.state },
      areaServed: packet.enrichment_sources?.service_areas?.value ?? [business.city],
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${business.category} services`,
      provider: { "@type": "LocalBusiness", name: business.name },
      serviceType: services,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "How does the preview choose content?", acceptedAnswer: { "@type": "Answer", text: "It uses source-backed business data first and documented fallbacks when a field is missing." } },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      ],
    },
  ];
}

function logoDataUrl(name, logoSource) {
  if (logoSource?.remastered_path) return logoSource.remastered_path;
  if (logoSource?.url) return logoSource.url;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "WS";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="152" height="152" viewBox="0 0 152 152"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#ff8b4a"/><stop offset="1" stop-color="#71e0b5"/></linearGradient></defs><rect width="152" height="152" rx="38" fill="url(#g)"/><path d="M38 104V48h76v56H38Zm10-10h56V58H48v36Z" fill="#160f0a" opacity=".92"/><text x="76" y="86" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="900" fill="#160f0a">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function paletteFromPacket(packet) {
  const colors = packet.enrichment_sources?.colors?.value
    ?? packet.enrichment_sources?.branding?.value?.colors
    ?? packet.source?.brandColors
    ?? {};
  const list = Array.isArray(colors)
    ? colors
    : [colors.primary, colors.secondary, colors.accent].filter(Boolean);
  const normalized = list.filter((color) => /^#[0-9a-f]{3,8}$/i.test(String(color)));
  return {
    accent: normalized[0] ?? "#ff8b4a",
    accent2: normalized[1] ?? normalized[2] ?? "#71e0b5",
    deep: normalized[3] ?? "#130f0b",
  };
}

function photoUrlsFromPacket(packet) {
  const photos = packet.enrichment_sources?.photos?.value
    ?? packet.media?.catalog
    ?? packet.source?.imageCandidates
    ?? packet.source?.selectedImages
    ?? [];
  const urls = photos.map((item) => typeof item === "string" ? item : item?.url).filter(Boolean);
  return [...new Set(urls)].filter((url) => /^https?:\/\//i.test(url));
}

function cssUrl(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function heroAnatomy(slug) {
  const hash = Math.abs(stableHash(slug));
  const variants = [
    { id: "split-cinematic", className: "hero-split", signature: "split:copy-left:blob-right:orbitals" },
    { id: "diagonal-builder", className: "hero-diagonal", signature: "diagonal:slab-right:clipped-media:offset-copy" },
    { id: "centerpiece-editorial", className: "hero-centerpiece", signature: "centerpiece:center-copy:oval-media:wide-stage" },
    { id: "side-rail-proof", className: "hero-side-rail", signature: "side-rail:left-rule:wide-media:rail-copy" },
    { id: "photo-stack-field", className: "hero-photo-stack", signature: "photo-stack:tilted-media:corner-plaque:deep-stage" },
  ];
  return variants[hash % variants.length];
}

function typeSystem(anatomy) {
  const systems = {
    "split-cinematic": {
      display: '"Inter Tight", "Manrope", system-ui, sans-serif',
      body: '"Manrope", "DM Sans", system-ui, sans-serif',
    },
    "diagonal-builder": {
      display: '"Playfair Display", Georgia, serif',
      body: '"Manrope", "DM Sans", system-ui, sans-serif',
    },
    "centerpiece-editorial": {
      display: '"Space Grotesk", "Inter Tight", system-ui, sans-serif',
      body: '"DM Sans", "Manrope", system-ui, sans-serif',
    },
    "side-rail-proof": {
      display: '"Inter Tight", "Space Grotesk", system-ui, sans-serif',
      body: '"Manrope", "DM Sans", system-ui, sans-serif',
    },
    "photo-stack-field": {
      display: '"DM Sans", "Inter Tight", system-ui, sans-serif',
      body: '"Manrope", "DM Sans", system-ui, sans-serif',
    },
  };
  return systems[anatomy.id] ?? systems["split-cinematic"];
}

function heroHeadline(packet, anatomy) {
  const business = packet.business ?? {};
  const city = escapeHtml(business.city ?? "your city");
  const options = {
    "split-cinematic": `Outdoor spaces tuned for <span>${city}</span>.`,
    "diagonal-builder": `Sharper yards for <span>${city}</span>.`,
    "centerpiece-editorial": `A calmer landscape path for <span>${city}</span>.`,
    "side-rail-proof": `Trust-ready outdoor work in <span>${city}</span>.`,
    "photo-stack-field": `Stone, shade, and structure for <span>${city}</span>.`,
  };
  return options[anatomy.id] ?? options["split-cinematic"];
}

function heroIntro(packet, anatomy) {
  const business = packet.business ?? {};
  const city = escapeHtml(business.city ?? "your city");
  const name = escapeHtml(business.name ?? "this local crew");
  const intros = {
    "split-cinematic": `${name} presents planting, cleanup, and outdoor living work with a polished first impression built for ${city} homeowners.`,
    "diagonal-builder": `Fast-scanning service blocks, local proof, and quote-first direction make ${name} easier to trust from the first visit.`,
    "centerpiece-editorial": `A softer, clearer site experience for homeowners comparing landscape help, service areas, and the next estimate step.`,
    "side-rail-proof": `${name} gets a more direct presentation: what they do, where they work, and how to start a real project conversation.`,
    "photo-stack-field": `Layered visuals, stronger service framing, and a cleaner estimate path turn outdoor work into something visitors can picture.`,
  };
  return intros[anatomy.id] ?? intros["split-cinematic"];
}

function heroSignatureNodes(slug, anatomy = heroAnatomy(slug)) {
  const hash = Math.abs(stableHash(`${slug}:${anatomy.id}`));
  const count = 4 + (hash % 9);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const width = 72 + ((hash + i * 37) % 180);
    const height = 20 + ((hash + i * 19) % 90);
    const top = 10 + ((hash + i * 13) % 72);
    const left = 4 + ((hash + i * 23) % 88);
    const rotate = -18 + ((hash + i * 11) % 36);
    const nested = i % 4 === 0
      ? "<b><b><b></b></b></b>"
      : i % 3 === 0
        ? "<b><b></b></b>"
        : i % 2 === 0
          ? "<b></b>"
          : "";
    nodes.push(`<i class="signature-node ${anatomy.id}-node-${i}" aria-hidden="true" data-node="${anatomy.id}-${i}" style="width:${width}px;height:${height}px;top:${top}%;left:${left}%;transform:rotate(${rotate}deg)">${nested}</i>`);
  }
  return nodes.join("");
}

function stableHash(value) {
  let hash = 0;
  for (const char of String(value)) {
    hash = (hash * 33 + char.charCodeAt(0)) | 0;
  }
  return hash;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
