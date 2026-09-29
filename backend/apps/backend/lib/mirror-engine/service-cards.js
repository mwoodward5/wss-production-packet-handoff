"use strict";

/**
 * SERVICE CARD BINDING — one card, one service, its own words.
 *
 * THE 2026-09-02 FLEET AUDIT (Comet, owner-endorsed) measured the defect class
 * on live builds: the shared service-grid components kept a FIXED array of N
 * editorial card bodies (number, bullets, copy) and handed them out with
 * `pool[index % pool.length]`. An eleventh service therefore wore card № 01's
 * number AND its bullet list — "Electronic Leak Detection" printed the
 * drain-cleaning bullets, "Re-pipe Waterlines" printed the leak-detection
 * bullets, and "№ 01 SERVICE" appeared three times on one page. The donor that
 * shipped it (plumbing-clean's compiled `Wo[c%Wo.length]`) is fixed at the
 * template layer; THIS module is the engine half of the same law:
 *
 *   1. BIND, DON'T DEAL. Every card's bullet list binds 1:1 to its own
 *      service. Bespoke points ride through untouched. A service with none
 *      gets bullets GENERATED FROM THAT SERVICE's own name — never a sibling's
 *      block, never a cycled default.
 *   2. NUMBER WITHOUT RESETS. Card numbering is the index across the full set
 *      (the donor renders it from position), and the engine mirrors that
 *      contract in `card_no` so any consumer reads the same sequence.
 *   3. THE BUILD REPORTS WHAT ALMOST SHIPPED WRONG. `lintServiceCardBullets`
 *      compares every sibling card's final bullet block on a page; identical
 *      blocks are a report entry — a warning, never a failed build, because
 *      the honest list of a service-poor business is allowed to be thin, but
 *      it must be VISIBLE when two cards say the same three things.
 */

/** Generated bullets are a per-service sentence set; this is the ceiling. */
const GENERATED_POINTS_CAP = 3;
/** Bespoke (verified) points may run longer, but a card is not a menu. */
const BESPOKE_POINTS_CAP = 6;

const cleanName = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

/**
 * The generated block for one service, derived from ITS name alone so two
 * different services can never collide and the same service always reads the
 * same. Deliberately service-fulfillment sentences — no pricing, licensing or
 * availability claims the facts did not verify.
 */
function generatedPointsFor(name) {
  const clean = cleanName(name);
  if (!clean) return [];
  return [
    `${clean} assessed on site with a clear, upfront quote`,
    `Scheduling built around your timeline for ${clean}`,
    `A follow-up after every ${clean} visit`,
  ];
}

/**
 * One service's own bullet block. Bespoke wins; generation is the fallback —
 * and the fallback is per-service, which is the whole point of this module.
 */
function serviceCardPoints(service) {
  if (service && typeof service === "object") {
    const bespoke = Array.isArray(service.points) ? service.points : (Array.isArray(service.bullets) ? service.bullets : null);
    if (bespoke) {
      const seen = new Set();
      const points = [];
      for (const raw of bespoke) {
        const point = cleanName(raw);
        if (!point) continue;
        const key = point.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(point);
        if (points.length >= BESPOKE_POINTS_CAP) break;
      }
      if (points.length) return points;
    }
  }
  return generatedPointsFor(service && typeof service === "object" ? (service.name || service.title) : service);
}

const normalizeBlock = (points) => points.map((p) => p.toLowerCase()).join("\u241f");

/**
 * THE DUPLICATE-BULLET LINT. Compares the FINAL bullet block of every card on
 * one page (bespoke or generated — whatever will actually print) and reports
 * sibling cards that ended up with the same block. Returns a report shape:
 * never throws, never fails a build — a thin honest list is allowed, but two
 * cards saying byte-identical things is the exact defect this lane exists to
 * kill, so it must be visible in the build report.
 */
function lintServiceCardBullets(services) {
  const cards = (Array.isArray(services) ? services : []).map((service, index) => ({
    index,
    name: cleanName(service && typeof service === "object" ? (service.name || service.title) : service),
    points: serviceCardPoints(service),
  }));

  const byBlock = new Map();
  for (const card of cards) {
    if (!card.points.length) continue;
    const key = normalizeBlock(card.points);
    if (!byBlock.has(key)) byBlock.set(key, []);
    byBlock.get(key).push(card);
  }

  const duplicate_bullet_blocks = [];
  for (const group of byBlock.values()) {
    if (group.length < 2) continue;
    duplicate_bullet_blocks.push({
      services: group.map((c) => c.name || `card ${c.index + 1}`),
      shared_bullets: group[0].points.length,
      example: group[0].points[0] || "",
    });
  }

  return {
    cards: cards.length,
    bespoke_points: cards.filter((c) => {
      const svc = services[c.index];
      const bespoke = svc && typeof svc === "object" && (Array.isArray(svc.points) || Array.isArray(svc.bullets));
      return Boolean(bespoke) && serviceCardPoints(svc).length > 0;
    }).length,
    empty_bullet_cards: cards.filter((c) => !c.points.length).map((c) => c.name || `card ${c.index + 1}`),
    duplicate_bullet_blocks,
  };
}

/**
 * Bind a service list for the card grid: every service leaves with its OWN
 * `points` (bespoke or per-service generated) and the set-wide sequential
 * `card_no`. The returned report is the lint's verdict on the bound list —
 * merge it into the build report at the call site.
 */
function bindServiceCards(services) {
  const list = Array.isArray(services) ? services : [];
  const bound = list.map((service, index) => {
    const points = serviceCardPoints(service);
    if (service && typeof service === "object") {
      return { ...service, points, card_no: String(index + 1).padStart(2, "0") };
    }
    // Bare-string services stay strings downstream where that shape is
    // expected; their points still ride the report lint. Object normalizing
    // happens at the render door of each consumer.
    return service;
  });
  // Lint the ORIGINAL list: bespoke detection reads the services as they
  // arrived (a service that carried its own points is the fact that matters),
  // while every block comparison still sees the final, will-print bullets.
  return { services: bound, report: lintServiceCardBullets(list) };
}

module.exports = {
  serviceCardPoints,
  generatedPointsFor,
  lintServiceCardBullets,
  bindServiceCards,
  GENERATED_POINTS_CAP,
  BESPOKE_POINTS_CAP,
};
