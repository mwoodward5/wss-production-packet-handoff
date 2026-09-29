"use strict";

const PUBLIC_BANNED_TERMS = [
  "Ghost Agency",
  "LeadMiner",
  "scrape",
  "scraper",
  "crawl",
  "Firecrawl",
  "proof",
  "kitchen",
  "PageHub",
  "Ricardo",
  "migration",
  "pipeline",
];

function findPublicCopyTerms(text = "") {
  const lower = String(text).toLowerCase();
  return PUBLIC_BANNED_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

module.exports = {
  PUBLIC_BANNED_TERMS,
  findPublicCopyTerms,
};
