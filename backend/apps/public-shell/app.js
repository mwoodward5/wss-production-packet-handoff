function $(id) {
  return document.getElementById(id);
}

const GHOST_API_URL = "https://ghost-agency-backend.vercel.app";

function setBusy(element, busy) {
  if (!element) return;
  element.disabled = Boolean(busy);
  element.setAttribute("aria-busy", busy ? "true" : "false");
}

async function postGhost(route, payload) {
  const response = await fetch(`${GHOST_API_URL}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(payload?.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    const error = new Error(json.message || json.error || `Request failed: ${response.status}`);
    error.payload = json;
    throw error;
  }
  return json;
}

async function getGhost(route) {
  const response = await fetch(`${GHOST_API_URL}${route}`, {
    headers: { Accept: "application/json" },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || json.error || `Request failed: ${response.status}`);
  }
  return json;
}

function buildTicket(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const slug = `${data.city || "local"}-${data.industry || "business"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return {
    schemaVersion: "woodward-hyperfactory-packet-v3",
    generatedAt: new Date().toISOString(),
    mode: "vercel-client-demo",
    brand: "Woodward Software",
    prospect: {
      businessName: data.businessName || "Sample Local Business",
      industry: data.industry || "Roofing",
      city: data.city || "Dallas",
      state: data.state || "TX",
      contactEmail: data.ownerEmail || "",
      ownerEmail: data.ownerEmail || "",
      phone: data.phone || "",
      currentWebsite: data.currentWebsite || "",
      services: data.services || data.industry || "",
      consentToCall: data.consentToCall === "on",
      consentToText: data.consentToText === "on",
      consentSource:
        data.consentToCall === "on" || data.consentToText === "on"
          ? "Woodward local website growth intake form"
          : "",
    },
    visualDirection: {
      quality: "premium editorial software",
      style: "Space Grotesk display, Inter interface, kinetic command windows, real media, tactile CTAs",
      components: ["buyer preview", "market brief", "paid launch workspace", "local business hero media"],
    },
    websitePlan: {
      slug,
      package: data.package || "Launch Site",
      pages: ["Home", "Services", "Trust", "Quote Request"],
      conversionGoal: "Turn a local visibility report into a paid website launch.",
      notes: data.notes || "",
    },
    fulfillmentBoundary: {
      paymentSubmitted: false,
      emailSent: false,
      smsSent: false,
      callPlaced: false,
      productionWrite: false,
    },
  };
}

function ghostPayloadFromTicket(ticket) {
  return {
    businessName: ticket.prospect.businessName,
    industry: ticket.prospect.industry,
    city: ticket.prospect.city,
    state: ticket.prospect.state,
    ownerEmail: ticket.prospect.ownerEmail,
    phone: ticket.prospect.phone,
    currentWebsite: ticket.prospect.currentWebsite,
    services: ticket.prospect.services,
    notes: ticket.websitePlan.notes,
    consentToCall: ticket.prospect.consentToCall,
    consentToText: ticket.prospect.consentToText,
    consentSource: ticket.prospect.consentSource,
    package: ticket.websitePlan.package,
    source: "woodward-local-growth-public-intake",
  };
}

function renderStatus(status, message, detail) {
  if (!status) return;
  status.hidden = false;
  status.classList.remove("is-success", "is-error", "is-working");
  if (detail) status.dataset.detail = detail;
  status.classList.add(detail || "is-success");
  status.textContent = message;
}

function wireIntake() {
  const form = $("intakeForm");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  if (["mission-control", "answercrew"].includes(params.get("product"))) {
    window.location.replace("/pricing#plans");
    return;
  }
  for (const [key, value] of params.entries()) {
    const field = form.elements.namedItem(key);
    if (field && !field.value) field.value = value;
  }

  const output = $("ticketOutput");
  const download = $("downloadTicket");
  const checkout = $("checkoutTicket");
  const status = $("ticketStatus");
  const submit = $("submitTicket");
  const idempotencyStorageKey = "woodwardWebsitePreviewIdempotencyKey";
  function requestFingerprint() {
    return new URLSearchParams(new FormData(form)).toString();
  }

  function requestKey() {
    const fingerprint = requestFingerprint();
    const storedRequest = JSON.parse(sessionStorage.getItem(idempotencyStorageKey) || "null");
    if (storedRequest?.fingerprint === fingerprint && storedRequest.key) return storedRequest.key;
    const key = crypto.randomUUID();
    sessionStorage.setItem(idempotencyStorageKey, JSON.stringify({ fingerprint, key }));
    return key;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(submit, true);
    renderStatus(
      status,
      "Creating the local website launch job and asking the live backend for the next checkout action...",
      "is-working",
    );

    const ticket = { ...buildTicket(form), idempotencyKey: requestKey() };
    const json = JSON.stringify(ticket, null, 2);
    localStorage.setItem("woodwardBespokeTicket", json);
    output.textContent = json;
    output.hidden = false;

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    download.href = url;
    download.download = `${ticket.websitePlan.slug || "woodward"}-ticket.json`;
    download.hidden = false;

    try {
      const result = await postGhost("/api/ghost-agency/orchestrate", ghostPayloadFromTicket(ticket));
      const checkoutUrl = result.actions?.checkout?.url;
      const mode = result.actions?.checkout?.mode || "unknown";
      localStorage.setItem("woodwardLocalGrowthLastJob", JSON.stringify(result, null, 2));

      if (checkoutUrl && checkout) {
        checkout.href = checkoutUrl;
        checkout.hidden = false;
        checkout.textContent = "Open Secure Checkout";
      } else if (checkout) {
        checkout.hidden = true;
      }

      output.textContent = JSON.stringify({ ticket, backend: result }, null, 2);
      renderStatus(
        status,
        checkoutUrl
          ? `Launch job ${result.job?.id || "created"} is ready. Stripe returned a secure checkout session. No charge happens until the buyer completes checkout.`
          : `Launch job ${result.job?.id || "created"} is ready. Checkout mode: ${mode}. Download the JSON or inspect the backend response below.`,
        "is-success",
      );
    } catch (error) {
      output.textContent = JSON.stringify({ ticket, backendError: error.payload || error.message }, null, 2);
      renderStatus(
        status,
        `Local launch request created, but the live backend call did not complete: ${error.message}`,
        "is-error",
      );
    } finally {
      setBusy(submit, false);
    }
  });
}

function providerBadge(name, provider) {
  const mode = provider?.mode || "unknown";
  const configured = provider?.configured || provider?.webhookConfigured;
  const className = configured ? "status-pill live" : "status-pill dry";
  return `<span class="${className}"><b>${name}</b>${mode}</span>`;
}

async function wireBackendHealth() {
  const target = $("backendHealth");
  if (!target) return;
  target.innerHTML = '<span class="status-pill dry"><b>Backend</b>checking...</span>';
  try {
    const health = await getGhost("/api/health");
    const p = health.providers || {};
    const voiceFollowup = p["va" + "pi"];
    const textFollowup = p["twi" + "lio"];
    target.innerHTML = [
      providerBadge("Payments", p.stripe),
      providerBadge("Call follow-up", voiceFollowup),
      providerBadge("Text follow-up", textFollowup),
      providerBadge("Client ledger", p.supabase),
      providerBadge("Build dispatch", p.woodwardLabsBuildTicket),
      providerBadge("Workflow bridge", p.zapier),
    ].join("");
  } catch (error) {
    target.innerHTML = `<span class="status-pill error"><b>Backend</b>${error.message}</span>`;
  }
}

function wireMotionCard() {
  const card = document.getElementById("demoMotionCard");
  if (!card) return;

  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--card-ry", `${x * 4.5}deg`);
    card.style.setProperty("--card-rx", `${y * -3.5}deg`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--card-ry", "0deg");
    card.style.setProperty("--card-rx", "0deg");
  });
}

wireIntake();
wireMotionCard();
wireBackendHealth();
