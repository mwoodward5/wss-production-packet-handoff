// SiteForge SaaS — shared page shell. Server-rendered, semantic, fast.
import { esc } from "../lib/util.mjs";

export const LOGO_SVG = `<img class="brand-monogram" src="/brand/monogram.svg" width="28" height="28" alt="">`;

export const MOTIF_SVG = `<svg class="hero-motif" viewBox="0 0 1200 640" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="#DDD3BE" stroke-width="1.1">
    ${Array.from({ length: 11 }, (_, i) => {
      const o = i * 34;
      return `<path d="M ${640 + o} -20 C ${760 + o} 120, ${700 + o} 260, ${840 + o} 380 S ${900 + o} 600, ${1080 + o} 680" opacity="${(0.9 - i * 0.07).toFixed(2)}"/>`;
    }).join("")}
  </g>
  <g fill="#C2571B" opacity=".55">
    <circle cx="905" cy="196" r="3.2"/><circle cx="1012" cy="358" r="2.5"/><circle cx="836" cy="472" r="2.8"/>
  </g>
</svg>`;

const NAV_PUBLIC = [
  ["/templates", "Website styles"],
  ["/#how", "How it works"],
  ["/pricing", "Pricing"],
  ["/#faq", "FAQ"],
];
const NAV_APP = [
  ["/dashboard", "My websites"],
  ["/new", "Start a website"],
  ["/templates", "Website styles"],
  ["/growth", "Results"],
  ["/studio", "Client websites"],
  ["/account", "Account"],
];

export function page({ title, desc, path = "/", user = null, body, head = "", noindex = false }) {
  const publicBase = (process.env.SITEFORGE_PUBLIC_URL || "https://siteforge-app-seven.vercel.app").replace(/\/$/, "");
  const canonical = `${publicBase}${path === "/" ? "/" : path}`;
  const nav = (user ? NAV_APP : NAV_PUBLIC)
    .map(([href, label]) => `<a href="${href}" ${path === href ? 'class="active"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — WSS Launch by Woodward Software Labs</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
<meta name="theme-color" content="#111714">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)} — WSS Launch">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(publicBase)}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/theme.css?v=20260710-5">
<link rel="stylesheet" href="/molten-theme.css?v=20260710-7">
${head}
</head>
<body class="${user ? "platform-app" : "platform-public"}">
<a class="skip-link" href="#main">Skip to content</a>
<nav class="nav" aria-label="Primary">
  <div class="wrap nav-inner">
    <a class="brand" href="${user ? "/dashboard" : "/"}">${LOGO_SVG} WSS Launch</a>
    <div class="nav-links">
      ${nav}
      ${user
        ? `<span class="chip" title="${esc(user.email)}">${esc(user.name || user.email)}</span>
           <form method="post" action="/auth/logout" style="display:inline"><button class="btn ghost sm" type="submit">Sign out</button></form>`
        : `<a href="/login">Sign in</a><a class="btn ember sm" href="/#forge">Make my website</a>`}
    </div>
  </div>
</nav>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">${LOGO_SVG} WSS Launch</a>
        <p class="footer-summary">Tell us about your business. WSS Launch gathers the details, makes your website, and checks everything before it goes live.</p>
        <p class="footer-byline"><img src="/brand/wsl-logo-horizontal.svg" alt="Woodward Software Labs" style="display:block;width:220px;max-width:100%;height:auto;margin:.6rem 0 .3rem">A Woodward Software Labs product.</p>
      </div>
      <div><h3>Product</h3><ul>
        <li><a href="/templates">Website styles</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/#how">How it works</a></li>
        <li><a href="/new">Start a website</a></li>
      </ul></div>
      <div><h3>Company</h3><ul>
        <li><a href="/support">Support</a></li>
        <li><a href="mailto:hello@woodwardsoftware.com">hello@woodwardsoftware.com</a></li>
        ${process.env.SITEFORGE_AGENT_PHONE ? `<li><a href="tel:${String(process.env.SITEFORGE_AGENT_PHONE).replace(/[^+\d]/g, "")}">Call our team ${process.env.SITEFORGE_AGENT_PHONE}</a></li>
        <li class="footer-byline">Real people. Questions and edit requests usually handled within minutes.</li>` : ""}
      </ul></div>
      <div><h3>Legal</h3><ul>
        <li><a href="/legal/privacy">Privacy</a></li>
        <li><a href="/legal/terms">Terms</a></li>
        <li><a href="/legal/accessibility">Accessibility</a></li>
      </ul></div>
    </div>
    <div class="legal">
      <span>© ${new Date().getFullYear()} Woodward Software Labs. All rights reserved.</span>
      <span>Checked carefully before it goes live.</span>
    </div>
  </div>
</footer>
<div id="consent" class="consent" hidden>
  <p>WSS Launch uses only essential cookies to keep you signed in. No ad trackers.</p>
  <button id="consent-ok" class="btn sm ember" type="button">Okay</button>
</div>
<script src="/app.js?v=20260710-5" defer></script>
</body>
</html>`;
}
export function errorPage(status, message, user = null) {
  return page({
    title: `${status}`, desc: "We could not open this page.", user, noindex: true,
    body: `<section class="section"><div class="wrap" style="text-align:center;max-width:640px">
      <p class="eyebrow" style="justify-content:center">Error ${status}</p>
      <h1 style="font-size:clamp(2.2rem,6vw,3.6rem)">${status === 404 ? "We cannot find that page." : "Something did not work."}</h1>
      <p style="margin:0 auto 1.6rem">${esc(message)}</p>
      <div class="btn-row" style="justify-content:center"><a class="btn" href="/">Go to the homepage</a><a class="btn ghost" href="/support">Get help</a></div>
    </div></section>`,
  });
}
