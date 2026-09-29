"use strict";

const brand = require("../../../packages/wss-brand-system");
const { providerStatus, publicConfig } = require("./registry");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function envSet(name) {
  return Boolean(process.env[name]?.trim());
}

/**
 * Env NAME groups per provider. Each inner array is a set of alternatives:
 * the requirement is satisfied when any one of the names is set.
 * Names only - values are never read into the page.
 */
const PROVIDER_ENV = {
  supabase: [["SUPABASE_URL"], ["SUPABASE_SERVICE_ROLE_KEY"]],
  stripe: [
    ["STRIPE_SECRET_KEY"],
    ["STRIPE_LOCAL_GROWTH_PRICE_ID", "STRIPE_WEBSITE_GROWTH_PRICE_ID", "STRIPE_GHOST_AGENCY_PRICE_ID"],
    ["STRIPE_WEBHOOK_SECRET"],
  ],
  resend: [
    ["RESEND_API_KEY"],
    ["GHOST_AGENCY_OUTREACH_FROM", "GHOST_AGENCY_RESEND_FROM", "RESEND_FROM_EMAIL", "RESEND_FROM"],
    ["GHOST_AGENCY_RESEND_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET"],
    ["EMAIL_UNSUB_SECRET"],
  ],
  twilio: [
    ["TWILIO_ACCOUNT_SID"],
    ["TWILIO_AUTH_TOKEN"],
    ["TWILIO_MESSAGING_SERVICE_SID", "TWILIO_FROM_NUMBER"],
  ],
  vapi: [
    ["VAPI_API_KEY"],
    ["VAPI_LOCAL_GROWTH_ASSISTANT_ID", "VAPI_ASSISTANT_ID"],
    ["VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID", "VAPI_PHONE_NUMBER_ID"],
    ["VAPI_WEBHOOK_SECRET"],
  ],
  woodwardLabsBuildTicket: [
    ["WOODWARD_LABS_BUILD_TICKET_URL"],
    ["WOODWARD_LABS_BUILD_TICKET_TOKEN"],
  ],
  zapier: [["ZAPIER_GHOST_AGENCY_HOOK_URL"]],
  lovable: [["LOVABLE_API_KEY"]],
};

const PROVIDER_ORDER = ["supabase", "stripe", "resend", "twilio", "vapi", "lovable"];

function missingEnvNames(providerName) {
  const groups = PROVIDER_ENV[providerName] || [];
  return groups
    .filter((group) => !group.some(envSet))
    .map((group) => group.join(" or "));
}

/** Chip state per provider: go = configured, hold = partially wired, stop = blocked. */
function providerState(name, provider) {
  if (!provider) return { state: "hold", label: "unknown" };
  if (name === "woodwardLabsBuildTicket") {
    return provider.configured
      ? { state: "go", label: "configured" }
      : { state: "hold", label: "handoff packet" };
  }
  if (name === "zapier") {
    return provider.configured
      ? { state: "go", label: "configured" }
      : { state: "hold", label: "optional" };
  }
  if (provider.configured && provider.webhookConfigured === false) {
    return { state: "hold", label: "webhook pending" };
  }
  if (provider.configured) return { state: "go", label: "configured" };
  const groups = PROVIDER_ENV[name] || [];
  const partial = groups.some((group) => group.some(envSet));
  return partial ? { state: "hold", label: "pending" } : { state: "stop", label: "blocked" };
}

/** Same computation as api/admin/readiness.js - keep the two in lockstep. */
function computeHardStops(providers) {
  const hardStops = [];
  if (!providers.resend.webhookConfigured) hardStops.push("GHOST_AGENCY_RESEND_WEBHOOK_SECRET missing");
  if (!providers.resend.unsubscribeConfigured) hardStops.push("EMAIL_UNSUB_SECRET missing");
  if (providers.resend.postalAddressConfigured && !providers.resend.unsubscribeConfigured) {
    hardStops.push("GHOST_AGENCY_POSTAL_ADDRESS is set but unsubscribe is NOT configured; acquisition email blocked");
  }
  if (!providers.vapi.cleanLaneConfigured) {
    hardStops.push("VAPI_LOCAL_GROWTH_ASSISTANT_ID and VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID missing");
  }
  return hardStops;
}

function chip(state, label) {
  return `<span class="chip ${escapeHtml(state)}"><i></i>${escapeHtml(label)}</span>`;
}

function fmtWhen(value) {
  if (!value) return "";
  return String(value).replace("T", " ").slice(0, 16);
}

function emptyState(title, note) {
  return `<div class="empty"><b>${escapeHtml(title)}</b>${escapeHtml(note)}</div>`;
}

function eventLine(row) {
  const type = row.type || "event";
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const detail = payload.status || payload.actor || payload.outcome || "";
  return `<li class="ev"><time>${escapeHtml(fmtWhen(row.created_at || row.ts))}</time><span class="dot"></span><span class="body"><b>${escapeHtml(type)}</b>${detail ? ` <span class="dim">${escapeHtml(detail)}</span>` : ""}</span></li>`;
}

function eventList(rows, limit, whenEmpty) {
  const items = rows.slice(0, limit).map(eventLine).join("");
  return items ? `<ul class="stream">${items}</ul>` : whenEmpty;
}

function flagRow(label, state, word, note) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><span class="kv-right">${chip(state, word)}${note ? `<small>${escapeHtml(note)}</small>` : ""}</span></div>`;
}

function renderProviderCards(providers) {
  const names = [
    ...PROVIDER_ORDER.filter((name) => providers[name]),
    ...Object.keys(providers).filter((name) => !PROVIDER_ORDER.includes(name)),
  ];
  return names
    .map((name) => {
      const provider = providers[name];
      const { state, label } = providerState(name, provider);
      const missing = missingEnvNames(name);
      const missingHtml = missing.length
        ? `<div class="miss"><span>missing env</span>${missing.map((group) => `<code>${escapeHtml(group)}</code>`).join("")}</div>`
        : `<div class="miss ok"><span>env complete</span></div>`;
      return `<article class="pcard ${escapeHtml(state)}">
        <header><span class="pname">${escapeHtml(name)}</span>${chip(state, label)}</header>
        <div class="pmode">${escapeHtml(provider.mode || "n/a")}</div>
        ${missingHtml}
      </article>`;
    })
    .join("");
}

function renderHardStops(hardStops) {
  if (!hardStops.length) {
    return `<div class="empty"><b>No hard stops.</b>Every launch gate is clear. Acquisition lanes may fire when you say so.</div>`;
  }
  return `<ul class="stops">${hardStops
    .map((stop) => `<li>${chip("stop", "hard stop")}<span>${escapeHtml(stop)}</span></li>`)
    .join("")}</ul>`;
}

function renderCalls(calls, ledgerLive) {
  if (!calls.length) {
    return emptyState(
      "No completed calls in the ledger.",
      ledgerLive
        ? "When a consent-gated call completes, the debrief - outcome, summary, next action - lands here."
        : "Supabase is not configured, so the call ledger cannot be read.",
    );
  }
  const rows = calls
    .slice(0, 8)
    .map((row) => {
      const title = row.outcome || row.status || "call completed";
      const detail = row.summary || row.business_name || row.lead_id || "";
      return `<li class="ev"><time>${escapeHtml(fmtWhen(row.created_at))}</time><span class="dot"></span><span class="body"><b>${escapeHtml(title)}</b>${detail ? ` <span class="dim">${escapeHtml(String(detail).slice(0, 120))}</span>` : ""}</span></li>`;
    })
    .join("");
  return `<ul class="stream">${rows}</ul>`;
}

function renderTickets(tickets, ledgerLive) {
  if (!tickets.length) {
    return emptyState(
      "No support tickets on file.",
      ledgerLive
        ? "New tickets from customers or the studio queue will appear here, freshest first."
        : "Supabase is not configured, so the ticket table cannot be read.",
    );
  }
  const rows = tickets
    .slice(0, 12)
    .map((row) => {
      const subject = row.subject || row.title || row.topic || row.type || `ticket ${row.id || ""}`;
      const status = row.status || "open";
      const who = row.customer_email || row.email || row.site || row.site_id || "";
      return `<tr>
        <td>${escapeHtml(String(subject).slice(0, 80))}${who ? `<small>${escapeHtml(String(who).slice(0, 60))}</small>` : ""}</td>
        <td><span class="pill">${escapeHtml(status)}</span></td>
        <td class="mono">${escapeHtml(fmtWhen(row.updated_at || row.created_at))}</td>
      </tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Ticket</th><th>Status</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderOperatorDashboard({ events = [], calls = [], tickets = [], products = [] } = {}) {
  const providers = providerStatus();
  const config = publicConfig();
  const hardStops = computeHardStops(providers);
  const ready = hardStops.length === 0;
  const ledgerLive = providers.supabase.configured;
  const renderedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  const eventTypeStartsWith = (row, ...prefixes) =>
    prefixes.some((prefix) => String(row.type || "").startsWith(prefix));

  const stripeEvents = events.filter((row) => eventTypeStartsWith(row, "proof.stripe", "stripe"));
  const outreachEvents = events.filter((row) => eventTypeStartsWith(row, "outreach."));
  const studioEvents = events.filter((row) => eventTypeStartsWith(row, "site.", "support.edit"));

  const stripeState = providerState("stripe", providers.stripe);
  const resend = providers.resend;

  const systemRows = products
    .slice(0, 8)
    .map((item) => `<li class="sys"><b>${escapeHtml(item.name || item.key || "system")}</b><span>${escapeHtml(item.role || item.status || "")}</span></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="45" />
  <meta name="robots" content="noindex" />
  <title>Woodward Operator Deck</title>
  ${brand.fontLinks()}
  <style>
    :root{
      color-scheme:dark;
      --bg:#08080B; --ink:#F2F2F5; --muted:#9B9AA4; --faint:#6F6E79;
      --line:rgba(255,255,255,.07); --line2:rgba(255,255,255,.14);
      --cyan:#4A6CF7; --volt:#DFFF5A; --violet:#8B5CF6;
      --go:#34D399; --hold:#E0A44A; --stop:#F26D6D;
      --panel:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.028));
      --display:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;
      --body:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;
      --mono:'IBM Plex Mono',ui-monospace,monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      min-height:100vh;color:var(--ink);font:15px/1.55 var(--body);
      background:
        radial-gradient(60rem 28rem at 85% -8%,rgba(124,108,246,.20),transparent 62%),
        radial-gradient(50rem 30rem at -12% 108%,rgba(74,108,247,.10),transparent 58%),
        var(--bg);
    }
    ::selection{background:rgba(124,108,246,.3)}
    a{color:var(--cyan)}
    main{width:min(1220px,calc(100% - 36px));margin:0 auto;padding:40px 0 90px}
    .brandshelf{height:3px;border-radius:3px;background:linear-gradient(90deg,#4A6CF7 0%,#7C6CF6 55%,#34D399 100%);margin-bottom:26px}
    .deckfoot{width:min(1220px,calc(100% - 36px));margin:0 auto;padding:0 0 34px;color:var(--faint);font:12px var(--mono);display:flex;align-items:center;gap:10px}
    .deckfoot .wmark{width:20px;height:20px;border-radius:6px;flex:0 0 auto;display:block}
    .deckfoot b{color:var(--muted);font-weight:600}
    .topline{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:26px}
    .eyeline{display:flex;align-items:center;gap:9px;color:var(--cyan);font:700 11px/1 var(--mono);letter-spacing:.2em;text-transform:uppercase}
    .eyeline .wmark{width:20px;height:20px;border-radius:6px;flex:0 0 auto;display:block}
    h1{font-family:var(--display);font-size:clamp(34px,5vw,58px);line-height:.95;letter-spacing:-.03em;margin-top:10px}
    .subline{color:var(--muted);font-size:13.5px;margin-top:10px;max-width:620px}
    .stamp{text-align:right;font:12px var(--mono);color:var(--faint);display:grid;gap:8px;justify-items:end}
    .stamp a{color:var(--muted);text-decoration:none;border-bottom:1px dotted var(--line2)}
    .chip{display:inline-flex;align-items:center;gap:7px;font:600 10.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:5px 11px;border-radius:999px;border:1px solid;white-space:nowrap}
    .chip i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
    .chip.go{color:var(--go);border-color:rgba(95,230,174,.42);background:rgba(95,230,174,.08)}
    .chip.hold{color:var(--hold);border-color:rgba(255,197,85,.42);background:rgba(255,197,85,.08)}
    .chip.stop{color:var(--stop);border-color:rgba(255,138,118,.42);background:rgba(255,138,118,.08)}
    .chip.live i{animation:pulse 2.4s ease-in-out infinite}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
    h2{font-family:var(--display);font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:34px 0 12px;display:flex;align-items:center;gap:10px}
    h2::after{content:"";flex:1;height:1px;background:var(--line)}
    .grid{display:grid;gap:14px}
    .grid.p3{grid-template-columns:repeat(3,1fr)}
    .grid.p2{grid-template-columns:1fr 1fr}
    .panel,.pcard{border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 22px 70px rgba(0,0,0,.35);backdrop-filter:blur(16px)}
    .panel{padding:20px 22px}
    .panel>header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .panel h3{font-family:var(--display);font-size:16px;font-weight:500;letter-spacing:.01em}
    .pcard{padding:16px 18px 14px}
    .pcard header{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .pname{font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:-.01em}
    .pmode{font:12px var(--mono);color:var(--muted);margin-top:9px}
    .pcard.go{border-color:rgba(95,230,174,.22)}
    .pcard.stop{border-color:rgba(255,138,118,.28)}
    .miss{margin-top:11px;padding-top:10px;border-top:1px dashed var(--line);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .miss span{font:600 9.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
    .miss.ok span{color:rgba(95,230,174,.75)}
    .miss code{font:11px var(--mono);color:var(--stop);background:rgba(255,138,118,.08);border:1px solid rgba(255,138,118,.22);border-radius:6px;padding:2px 7px}
    .stops{list-style:none;display:grid;gap:9px}
    .stops li{display:flex;align-items:flex-start;gap:12px;padding:11px 12px;border:1px solid rgba(255,138,118,.2);border-radius:12px;background:rgba(255,138,118,.05);font-size:13px}
    .stream{list-style:none;display:grid;gap:2px;max-height:320px;overflow:auto;font:12px var(--mono)}
    .ev{display:grid;grid-template-columns:112px 10px 1fr;gap:10px;align-items:baseline;padding:6px 8px;border-radius:8px}
    .ev:hover{background:rgba(255,255,255,.04)}
    .ev time{color:var(--faint);font-size:11px}
    .ev .dot{width:7px;height:7px;border-radius:50%;background:var(--cyan);opacity:.7;position:relative;top:-1px}
    .ev .body{color:var(--muted);word-break:break-word}
    .ev .body b{color:var(--ink);font-weight:500}
    .ev .dim{color:var(--faint)}
    .empty{padding:22px 8px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}
    .empty b{display:block;font-family:var(--display);font-weight:500;color:var(--ink);font-size:14.5px;margin-bottom:5px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{font:600 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);text-align:left;padding:6px 10px;border-bottom:1px solid var(--line2)}
    td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
    tr:last-child td{border:0}
    td small{display:block;color:var(--faint);font-size:11.5px;margin-top:2px}
    td.mono{font:11.5px var(--mono);color:var(--muted);white-space:nowrap}
    .pill{font:600 10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--volt);border:1px solid rgba(223,255,90,.3);background:rgba(223,255,90,.06);border-radius:999px;padding:3px 9px}
    .kv{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:13.5px}
    .kv:last-of-type{border-bottom:0}
    .kv-right{display:flex;align-items:center;gap:10px}
    .kv-right small{color:var(--faint);font-size:11.5px;max-width:200px;text-align:right}
    .hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin-top:12px;padding-top:11px;border-top:1px dashed var(--line)}
    .hint code{font:11.5px var(--mono);color:var(--volt);background:rgba(223,255,90,.06);border:1px solid rgba(223,255,90,.2);border-radius:6px;padding:1px 6px}
    .sysline{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
    .sys{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.025)}
    .sys b{display:block;font-family:var(--display);font-size:12.5px;font-weight:500}
    .sys span{color:var(--faint);font-size:11px;line-height:1.4;display:block;margin-top:2px}
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
    @media (max-width:960px){.grid.p3,.grid.p2,.sysline{grid-template-columns:1fr}.stamp{text-align:left;justify-items:start}.ev{grid-template-columns:88px 10px 1fr}}
  </style>
</head>
<body>
  <main>
    <div class="brandshelf" role="presentation" aria-hidden="true"></div>
    <div class="topline">
      <div>
        <p class="eyeline"><svg class="wmark" viewBox="0 0 64 64" role="img" aria-label="WSS Labs"><defs><linearGradient id="wssDeckG" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><rect width="64" height="64" rx="15" fill="#131318"></rect><rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.09"></rect><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#wssDeckG)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="7" fill="#34D399" opacity="0.22"></circle><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg>WSS Labs &middot; Operator Deck</p>
        <h1>Mission control.</h1>
        <p class="subline">Every number on this deck is computed from live provider state and the ledger &mdash; never asserted. Empty means empty; blocked means blocked.</p>
      </div>
      <div class="stamp">
        ${ready ? chip("go live", "launch gates clear") : chip("stop live", `${hardStops.length} hard stop${hardStops.length === 1 ? "" : "s"}`)}
        <span>rendered ${escapeHtml(renderedAt)} UTC</span>
        <a href="${escapeHtml(config.publicAppUrl)}">${escapeHtml(config.publicAppUrl)}</a>
      </div>
    </div>

    <h2>Readiness</h2>
    <section class="grid p3">${renderProviderCards(providers)}</section>
    <section class="panel" style="margin-top:14px">
      <header><h3>Hard stops &mdash; computed like <span style="font-family:var(--mono);font-size:12px">/api/admin/readiness</span></h3>${ready ? chip("go", "ready") : chip("stop", "not ready")}</header>
      ${renderHardStops(hardStops)}
    </section>

    <h2>Operations</h2>
    <section class="grid p2">
      <article class="panel">
        <header><h3>Calls &mdash; completed debriefs</h3>${calls.length ? chip("go", `${calls.length} on ledger`) : chip("hold", "quiet")}</header>
        ${renderCalls(calls, ledgerLive)}
      </article>
      <article class="panel">
        <header><h3>Support tickets</h3>${tickets.length ? chip("go", `${tickets.length} recent`) : chip("hold", "none")}</header>
        ${renderTickets(tickets, ledgerLive)}
      </article>
    </section>

    <h2>Money &amp; comms</h2>
    <section class="grid p2">
      <article class="panel">
        <header><h3>Money &mdash; Stripe</h3>${chip("hold", "test mode only")}</header>
        ${flagRow("provider mode", stripeState.state, stripeState.label, providers.stripe.mode || "")}
        ${flagRow("webhook", providers.stripe.webhookConfigured ? "go" : "stop", providers.stripe.webhookConfigured ? "configured" : "blocked", providers.stripe.webhookConfigured ? "" : "STRIPE_WEBHOOK_SECRET missing")}
        <div style="margin-top:14px">${eventList(stripeEvents, 8, emptyState("No Stripe proof events.", ledgerLive ? "Checkout and webhook proof events (proof.stripe.*) will land here." : "Supabase is not configured, so the ledger cannot be read."))}</div>
        <div class="hint">Money stays in Stripe test mode until you flip the keys. Nothing on this panel charges a real card.</div>
      </article>
      <article class="panel">
        <header><h3>Email readiness &mdash; Resend</h3>${resend.configured ? chip("go", "delivery live") : chip("stop", "dry run")}</header>
        ${flagRow("delivery", resend.configured ? "go" : "stop", resend.configured ? "configured" : "blocked", resend.configured ? resend.mode : "RESEND_API_KEY / from address")}
        ${flagRow("bounce webhook", resend.webhookConfigured ? "go" : "stop", resend.webhookConfigured ? "configured" : "blocked", resend.webhookConfigured ? "auto-pause armed" : "GHOST_AGENCY_RESEND_WEBHOOK_SECRET missing")}
        ${flagRow("unsubscribe", resend.unsubscribeConfigured ? "go" : "stop", resend.unsubscribeConfigured ? "configured" : "blocked", resend.unsubscribeConfigured ? "" : "EMAIL_UNSUB_SECRET missing")}
        ${flagRow("postal address", resend.postalAddressConfigured ? "go" : "hold", resend.postalAddressConfigured ? "configured" : "held by design", resend.postalAddressConfigured ? "GHOST_AGENCY_POSTAL_ADDRESS is set" : "GHOST_AGENCY_POSTAL_ADDRESS intentionally unset")}
        <div style="margin-top:14px">${eventList(outreachEvents, 8, emptyState("No outreach events yet.", ledgerLive ? "outreach.* ledger entries (sends, unsubscribes, call outcomes) will appear here." : "Supabase is not configured, so the ledger cannot be read."))}</div>
        <div class="hint">Acquisition email stays parked until unsubscribe and postal address are both proven &mdash; the postal hold is a choice, not a failure.</div>
      </article>
    </section>

    <h2>Site Studio</h2>
    <section class="panel">
      <header><h3>Studio activity &mdash; site edits &amp; support edits</h3>${studioEvents.length ? chip("go", `${studioEvents.length} recent`) : chip("hold", "idle")}</header>
      ${eventList(studioEvents, 10, emptyState("No studio activity on the ledger.", ledgerLive ? "site.* and support.edit events will stream in as builds and edits run." : "Supabase is not configured, so the ledger cannot be read."))}
      <div class="hint">Studio actions are driven by <code>POST /api/studio/*</code> with the admin token &mdash; there is no button here on purpose; the deck observes, it does not mutate.</div>
      ${systemRows ? `<ul class="sysline">${systemRows}</ul>` : ""}
    </section>
  </main>
  <footer class="deckfoot"><svg class="wmark" viewBox="0 0 64 64" role="img" aria-label="WSS Labs" style="background:#131318"><defs><linearGradient id="wssDeckFootG" x1="12" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6CF7"></stop><stop offset="1" stop-color="#8B5CF6"></stop></linearGradient></defs><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="url(#wssDeckFootG)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="50" cy="20" r="4" fill="#34D399"></circle></svg><span><b>WSS Labs</b> &mdash; American AI web studio &#127482;&#127480;</span></footer>
</body>
</html>`;
}

function renderTokenGate() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Woodward Operator Gate</title>
  <style>
    :root{color-scheme:dark;--body:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
    body{margin:0;min-height:100vh;display:grid;place-items:center;color:#F2F2F5;font:16px/1.55 var(--body);background:radial-gradient(46rem 24rem at 80% -10%,rgba(124,108,246,.22),transparent 60%),#08080B}
    .card{width:min(520px,calc(100% - 32px));border:1px solid rgba(255,255,255,.14);border-radius:26px;background:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.03));padding:34px;box-shadow:0 28px 90px rgba(0,0,0,.45);backdrop-filter:blur(16px)}
    .eyeline{color:#4A6CF7;font:700 11px/1 var(--mono);letter-spacing:.2em;text-transform:uppercase;margin:0 0 12px}
    h1{margin:0 0 10px;font-size:34px;letter-spacing:-.02em;line-height:1.05}
    .muted{color:#9ca8bb;margin:0}
    code{color:#dfff5a;background:rgba(223,255,90,.07);border:1px solid rgba(223,255,90,.2);border-radius:6px;padding:1px 6px;font-size:13px}
  </style>
</head>
<body>
  <main class="card">
    <p class="eyeline">WSS Labs</p>
    <h1>Operator access required.</h1>
    <p class="muted">Send a valid <code>x-admin-token</code> header or bearer token to open the operator deck. No token, no deck.</p>
  </main>
</body>
</html>`;
}

module.exports = {
  renderOperatorDashboard,
  renderTokenGate,
};
