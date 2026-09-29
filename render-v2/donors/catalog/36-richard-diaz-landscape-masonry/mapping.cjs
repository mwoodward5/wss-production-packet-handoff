"use strict";
// Input is the certified visitor-copy surface, not discovery prose.
const trade =
  /\b(landscap\w*|masonry|hardscap\w*|lawn|garden\w*|pavers?|patios?|concrete|pool\w*|water features?|retaining|block walls?|outdoor kitchens?|bbqs?|fireplaces?|fire pits?|foundations?|pergolas?|irrigation|trees?|fenc\w*|sod|mulch\w*|drainage|outdoor lighting)\b/i;
function paragraph(md) {
  return typeof md === "string"
    ? md
        .replace(/\r\n/g, "\n")
        .trim()
        .split("\n")
        .slice(1)
        .join("\n")
        .trim()
        .split(/\n\n+/)[0]
    : "";
}
function mapDonor({ facts, services, files, manifest }) {
  if (
    !facts ||
    !["name", "city", "state", "phone", "website", "category"].every(
      (k) => typeof facts[k] === "string" && facts[k].trim(),
    )
  )
    throw Error("donor_identity_required");
  if (
    !trade.test(facts.category) ||
    (manifest?.category && manifest.category !== "landscaping")
  )
    throw Error("donor_wrong_trade");
  if (
    facts.services_source !== "source_bound" ||
    !Array.isArray(services) ||
    !services.length ||
    services.length > 12
  )
    throw Error("donor_services_required_or_capacity");
  for (const s of services) {
    if (!trade.test(s.name) || !facts.services?.includes(s.name))
      throw Error("donor_wrong_trade_or_service");
    const body = files?.[s.file];
    if (
      typeof body !== "string" ||
      body
        .split(/\r?\n/)[0]
        .replace(/^#+\s*/, "")
        .trim().toLowerCase() !== s.name.trim().toLowerCase() ||
      paragraph(body) !== s.description
    )
      throw Error("donor_service_copy_unbound");
  }
  const home = paragraph(files?.["content/home.md"]);
  const about = paragraph((files?.["content/about.md"] || files?.["content/home.md"]));
  const intro = paragraph(files?.["content/services.md"]);
  if (home.length < 20 || about.length < 20 || intro.length < 10)
    throw Error("donor_distinct_copy_required");
  return Object.freeze({
    heroText: {
      line1: facts.name,
      emphasis: services[0].name,
      line3: facts.city,
      eyebrow: facts.city + ", " + facts.state,
      support: home,
    },
    serviceIntro: intro,
    about,
    whyHeadline: "",
    values: [],
    seasonalNote: "",
    ctaHeadline: "",
    ctaBody: paragraph(files?.["content/contact.md"]),
    serviceShortLabels: Object.fromEntries(
      services.map((s) => [s.name, s.name]),
    ),
  });
}
module.exports = Object.freeze({ mapDonor });
