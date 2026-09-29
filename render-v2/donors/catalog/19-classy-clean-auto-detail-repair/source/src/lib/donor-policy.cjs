'use strict';

// CSD v2 drops category. Be conservative about names until that field is available.
// This is a compatibility gate, not a replacement for upstream certification.
function assertAutomotiveServices(services) {
  const automotive = /\b((?:auto(?:motive)?|car|vehicle)\s+(?:repair|maintenance|wash|cleaning|diagnostics)|detailing|undercoat(?:ing)?|mechanic(?:al)?|paint correction|ceramic coating)\b/i;
  const related = /\b(diagnostic(?:s)?|scratch removal|paint touch.up|rust proofing|rustproofing|interior cleaning|upholstery cleaning|engine cleaning|brakes?|oil change|tire(?:s)?|wheel(?:s)?|transmission|dent removal|headlight restoration)\b/i;
  const unrelated = /\b(house|housekeeping|janitorial|lawn|landscap\w*|plumb\w*|roof\w*|hvac|pool|boat|marine|pet|insurance|marketing|window washing|pressure washing|office cleaning)\b/i;
  if (!Array.isArray(services) || !services.length ||
      !services.some(s => typeof s?.name === 'string' && automotive.test(s.name)) ||
      services.some(s => typeof s?.name !== 'string' || unrelated.test(s.name) || !(automotive.test(s.name) || related.test(s.name)))) {
    throw new Error('donor_trade_mismatch');
  }
}

module.exports = Object.freeze({ assertAutomotiveServices });
