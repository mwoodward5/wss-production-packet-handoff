// Pure aggregation helpers for the Growth Hub. These functions intentionally
// accept plain records so routes can supply database, API, or test fixtures.

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const first = (record, keys, fallback = "") => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value) !== "") return value;
  }
  return fallback;
};

export function recordsForUser(records, userId) {
  const rows = list(records);
  if (userId === undefined || userId === null || userId === "") return rows;
  return rows.filter((row) => [row.user_id, row.owner_id, row.account_id].some((value) => String(value ?? "") === String(userId)));
}

export function recordsForProject(records, projectId) {
  const rows = list(records);
  if (projectId === undefined || projectId === null || projectId === "") return rows;
  return rows.filter((row) => [row.project_id, row.site_id].some((value) => String(value ?? "") === String(projectId)));
}

export function summarizeGrowth({ user, projects, leads, reviews, ranks } = {}) {
  const userId = first(user, ["id", "user_id"]);
  const ownedProjects = recordsForUser(projects, userId);
  const projectIds = new Set(ownedProjects.map((project) => String(first(project, ["id", "project_id"]))).filter(Boolean));
  const owned = (rows) => recordsForUser(rows, userId).filter((row) => {
    const projectId = first(row, ["project_id", "site_id"]);
    return !projectIds.size || !projectId || projectIds.has(String(projectId));
  });
  const ownedLeads = owned(leads);
  const ownedReviews = owned(reviews);
  const ownedRanks = owned(ranks);
  const byProject = Object.fromEntries(ownedProjects.map((project) => {
    const projectId = String(first(project, ["id", "project_id"], "unassigned"));
    return [projectId, {
      project,
      leads: recordsForProject(ownedLeads, projectId),
      reviews: recordsForProject(ownedReviews, projectId),
      ranks: recordsForProject(ownedRanks, projectId),
    }];
  }));
  return {
    projects: ownedProjects,
    leads: ownedLeads,
    reviews: ownedReviews,
    ranks: ownedRanks,
    counts: { projects: ownedProjects.length, leads: ownedLeads.length, reviews: ownedReviews.length, ranks: ownedRanks.length },
    byProject,
    leadStatuses: countBy(ownedLeads, ["status", "state"], "unassigned"),
    reviewRating: averageRating(ownedReviews),
    rankMovements: ownedRanks.reduce((sum, row) => sum + (Number(row.change ?? row.delta ?? 0) || 0), 0),
  };
}

export function summarizeRecords({ projects, leads, reviews, ranks, user } = {}) {
  return summarizeGrowth({ projects, leads, reviews, ranks, user });
}

export function connectorReadiness(env = process.env) {
  const configured = (names) => names.some((name) => {
    const raw = env?.[name];
    return raw !== undefined && raw !== null && !["", "0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
  });
  return {
    googleBusiness: configured(["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_BUSINESS_PROFILE_TOKEN"]),
    missedCallTextback: configured(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]),
    email: configured(["RESEND_API_KEY", "SENDGRID_API_KEY"]),
    payments: configured(["STRIPE_SECRET_KEY", "STRIPE_API_KEY"]),
    hosting: configured(["VERCEL_TOKEN"]),
    crawling: configured(["FIRECRAWL_API_KEY"]),
  };
}

export function countBy(records, keys, fallback = "unknown") {
  return list(records).reduce((out, row) => {
    const value = String(first(row, keys, fallback));
    out[value] = (out[value] || 0) + 1;
    return out;
  }, {});
}

export function averageRating(records) {
  const values = list(records).map((row) => Number(first(row, ["rating", "stars", "score"], NaN))).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function displayName(record, fallback = "Unnamed") {
  return String(first(record, ["name", "business_name", "title", "email"], fallback));
}
