const API = "https://api.vercel.com";

const token = () => process.env.SITEFORGE_VERCEL_TOKEN || process.env.VERCEL_TOKEN || "";
const teamId = () => process.env.SITEFORGE_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID || "";

export function domainProvisioningReady() {
  return Boolean(token() && teamId());
}

export function customerProjectName(project) {
  return `siteforge-${project.slug}`.slice(0, 52);
}

async function request(pathname, options = {}) {
  if (!domainProvisioningReady()) {
    const error = new Error("Vercel domain provisioning is not configured.");
    error.status = 503;
    throw error;
  }
  const joiner = pathname.includes("?") ? "&" : "?";
  const response = await fetch(`${API}${pathname}${joiner}teamId=${encodeURIComponent(teamId())}`, {
    ...options,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export async function getProjectDomain(project, domain) {
  const name = customerProjectName(project);
  const { response, data } = await request(`/v9/projects/${encodeURIComponent(name)}/domains/${encodeURIComponent(domain)}`);
  if (!response.ok) {
    const error = new Error(data.error?.message || `Vercel domain lookup returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return normalizeDomain(data);
}

export async function attachProjectDomain(project, domain) {
  const name = customerProjectName(project);
  const { response, data } = await request(`/v10/projects/${encodeURIComponent(name)}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!response.ok) {
    if (response.status === 400 && /already|exists/i.test(data.error?.message || "")) return getProjectDomain(project, domain);
    const error = new Error(data.error?.message || `Vercel could not attach this domain (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return normalizeDomain(data);
}

export async function verifyProjectDomain(project, domain) {
  const name = customerProjectName(project);
  const { response, data } = await request(`/v9/projects/${encodeURIComponent(name)}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST", body: "{}" });
  if (!response.ok) {
    const error = new Error(data.error?.message || `Vercel could not verify this domain (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return normalizeDomain(data);
}

function normalizeDomain(data = {}) {
  const verification = Array.isArray(data.verification) ? data.verification.map((row) => ({
    type: String(row.type || "TXT").toUpperCase(),
    domain: String(row.domain || ""),
    value: String(row.value || ""),
    reason: String(row.reason || ""),
  })) : [];
  return {
    name: String(data.name || ""),
    apex_name: String(data.apexName || ""),
    verified: data.verified === true || data.verified === "true",
    verification,
    dns: [
      { type: "A", name: "@", value: "76.76.21.21" },
      { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
    ],
  };
}
