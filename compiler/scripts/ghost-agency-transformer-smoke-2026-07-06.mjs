import fs from "node:fs/promises";
import path from "node:path";

const API = "https://ghost-agency-backend.vercel.app";

const fakeProspect = {
  businessName: "Smoke Test Landscape Company",
  industry: "Landscaping",
  city: "Los Angeles",
  state: "CA",
  services: ["landscape design", "yard cleanup", "hardscape install"],
  ownerEmail: "owner@example.com",
  phone: "+15555550123",
  consentToCall: false,
  consentToText: false,
};

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 800);
  }
}

async function getCheck(name, url, expect = [200]) {
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: "follow" });
    const body = await response.text();
    return {
      name,
      method: "GET",
      url,
      ok: expect.includes(response.status),
      status: response.status,
      responseMs: Date.now() - started,
      title: body.match(/<title>(.*?)<\/title>/i)?.[1] || "",
      hasHtml: /<html/i.test(body),
    };
  } catch (error) {
    return { name, method: "GET", url, ok: false, error: error.message };
  }
}

async function postCheck(name, url, body, expect = [200]) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await readBody(response);
    return {
      name,
      method: "POST",
      url,
      ok: expect.includes(response.status),
      expectedStatus: expect,
      status: response.status,
      responseMs: Date.now() - started,
      body: json,
    };
  } catch (error) {
    return { name, method: "POST", url, ok: false, error: error.message };
  }
}

function summarizeBody(item) {
  const body = item.body;
  if (!body || typeof body !== "object") return undefined;
  return {
    ok: body.ok,
    mode: body.mode || body.adapter?.mode || body.call?.mode || body.message?.mode,
    code: body.code || body.error?.code,
    jobId: body.jobId || body.job?.id,
    providerModes: body.providers
      ? Object.fromEntries(Object.entries(body.providers).map(([key, value]) => [key, value.mode]))
      : undefined,
  };
}

const livePages = [
  ["LeadMiner app", "https://leadminer.wss-ai.com/"],
  ["CallPrep sales", "https://callprep.wss-ai.com/sales-intelligence"],
  [
    "CallPrep sample report",
    "https://callprep.wss-ai.com/report/audit/ab81146f-d365-4979-829a-4af8bad46621",
  ],
  ["Rocket SERPs health", "https://rocket-serps.vercel.app/api/health"],
  ["Woodward Labs storefront", "https://rocketsites.wss-ai.com/"],
  ["Mission Control", "https://missioncontrol.wss-ai.com/"],
  ["Ghost Agency deck", "https://woodward-ghost-agency-vercel.vercel.app/"],
  ["Ghost backend health", `${API}/api/health`],
  ["Ghost backend products", `${API}/api/products`],
  ["AJP preview", "https://wss-ca-landscape-ajp-landscape-inc.vercel.app/"],
];

const checks = [];
for (const [name, url] of livePages) checks.push(await getCheck(name, url));

checks.push(await postCheck("LeadMiner adapter packet", `${API}/api/adapters/leadminer`, fakeProspect));
checks.push(
  await postCheck("CallPrep report adapter packet", `${API}/api/adapters/callprep-report`, fakeProspect),
);
checks.push(await postCheck("Ghost job create persistence", `${API}/api/ghost-agency/jobs`, fakeProspect));
checks.push(
  await postCheck("VAPI call consent brake", `${API}/api/outreach/vapi-call`, fakeProspect, [403]),
);
checks.push(
  await postCheck("Twilio SMS consent brake", `${API}/api/outreach/twilio-message`, fakeProspect, [403]),
);

const summary = {
  generatedAt: new Date().toISOString(),
  policy: "No Stripe checkout creation, no paid scraping, no calls, no texts, no production build dispatch.",
  ok: checks.every((item) => item.ok),
  totals: {
    checks: checks.length,
    passed: checks.filter((item) => item.ok).length,
    failed: checks.filter((item) => !item.ok).length,
  },
  checks: checks.map((item) => ({
    name: item.name,
    method: item.method,
    url: item.url,
    ok: item.ok,
    status: item.status,
    expectedStatus: item.expectedStatus,
    responseMs: item.responseMs,
    title: item.title,
    hasHtml: item.hasHtml,
    bodySummary: summarizeBody(item),
    error: item.error,
  })),
};

const outDir = path.join(process.cwd(), "perplexity-product-audit-2026-06-30", "transformer-smoke");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(
  path.join(outDir, "GHOST_AGENCY_TRANSFORMER_SMOKE_2026-07-06.json"),
  JSON.stringify(summary, null, 2),
);
await fs.writeFile(
  path.join(outDir, "GHOST_AGENCY_TRANSFORMER_SMOKE_2026-07-06.md"),
  [
    "# Ghost Agency Transformer Smoke",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Policy: ${summary.policy}`,
    "",
    `Overall: ${summary.ok ? "PASS" : "FAIL"} (${summary.totals.passed}/${summary.totals.checks})`,
    "",
    ...summary.checks.map((item) => {
      const body = item.bodySummary
        ? ` body=${JSON.stringify(item.bodySummary).replace(/\|/g, "\\|")}`
        : "";
      return `- ${item.ok ? "PASS" : "FAIL"} ${item.method} ${item.name}: ${item.status || "ERR"} ${item.url}${body}`;
    }),
    "",
  ].join("\n"),
);

console.log(JSON.stringify(summary, null, 2));
