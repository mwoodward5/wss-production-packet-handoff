"use strict";

/**
 * Market tokens for query-shape diversity (owner directive 2026-09-01).
 *
 * The nationwide quota ladder historically had ONE shape — "trade in Metro ST"
 * — so every refill attempt re-read a SERP of the same grammatical form and
 * the same directory-heavy winners. Two more ladders rotate through different
 * SERP shapes: REGION tokens ("plumbing in West Texas") and ZIP tokens
 * ("plumbing in 79401"). Every token carries exactly ONE state, because the
 * miner's metro fence checks the queried market at the state line; a region
 * that spans two states could not be fenced honestly.
 *
 * The ZIP ladder is a hand-frozen starter set of REAL postal codes: every
 * major metro in the console rotation plus deliberately secondary markets
 * (West Texas, the High Plains, mountain towns) where first-page SERPs are
 * thinner and a wide search actually finds the businesses. An AdClimber-style
 * nationwide ZIP database was hunted for locally and none existed, so this
 * ladder is the seed; append real zips only with a city and state.
 */

// Directional regions, each entirely inside one state.
const REGION_TOKENS = Object.freeze([
  Object.freeze({ token: "West Texas", state: "TX" }),
  Object.freeze({ token: "North Texas", state: "TX" }),
  Object.freeze({ token: "East Texas", state: "TX" }),
  Object.freeze({ token: "Central Texas", state: "TX" }),
  Object.freeze({ token: "South Texas", state: "TX" }),
  Object.freeze({ token: "East Tennessee", state: "TN" }),
  Object.freeze({ token: "Middle Tennessee", state: "TN" }),
  Object.freeze({ token: "West Tennessee", state: "TN" }),
  Object.freeze({ token: "North Florida", state: "FL" }),
  Object.freeze({ token: "Central Florida", state: "FL" }),
  Object.freeze({ token: "South Florida", state: "FL" }),
  Object.freeze({ token: "Southwest Florida", state: "FL" }),
  Object.freeze({ token: "North Georgia", state: "GA" }),
  Object.freeze({ token: "South Georgia", state: "GA" }),
  Object.freeze({ token: "North Alabama", state: "AL" }),
  Object.freeze({ token: "South Alabama", state: "AL" }),
  Object.freeze({ token: "North Mississippi", state: "MS" }),
  Object.freeze({ token: "South Mississippi", state: "MS" }),
  Object.freeze({ token: "Eastern North Carolina", state: "NC" }),
  Object.freeze({ token: "Western North Carolina", state: "NC" }),
  Object.freeze({ token: "Northern Virginia", state: "VA" }),
  Object.freeze({ token: "Southwest Ohio", state: "OH" }),
  Object.freeze({ token: "Northeast Ohio", state: "OH" }),
  Object.freeze({ token: "West Michigan", state: "MI" }),
  Object.freeze({ token: "Upstate New York", state: "NY" }),
]);

// Real postal codes: major metros plus secondary markets, spanning states.
const ZIP_MARKETS = Object.freeze([
  // Texas majors and the West Texas / secondary directive set.
  Object.freeze({ zip: "79401", city: "Lubbock", state: "TX" }),
  Object.freeze({ zip: "79109", city: "Amarillo", state: "TX" }),
  Object.freeze({ zip: "79901", city: "El Paso", state: "TX" }),
  Object.freeze({ zip: "76903", city: "San Angelo", state: "TX" }),
  Object.freeze({ zip: "79720", city: "Big Spring", state: "TX" }),
  Object.freeze({ zip: "79501", city: "Abilene", state: "TX" }),
  Object.freeze({ zip: "76301", city: "Wichita Falls", state: "TX" }),
  Object.freeze({ zip: "77550", city: "Galveston", state: "TX" }),
  Object.freeze({ zip: "77301", city: "Conroe", state: "TX" }),
  Object.freeze({ zip: "78501", city: "McAllen", state: "TX" }),
  Object.freeze({ zip: "78401", city: "Corpus Christi", state: "TX" }),
  Object.freeze({ zip: "76011", city: "Arlington", state: "TX" }),
  Object.freeze({ zip: "77002", city: "Houston", state: "TX" }),
  Object.freeze({ zip: "75201", city: "Dallas", state: "TX" }),
  Object.freeze({ zip: "76102", city: "Fort Worth", state: "TX" }),
  Object.freeze({ zip: "78205", city: "San Antonio", state: "TX" }),
  Object.freeze({ zip: "78701", city: "Austin", state: "TX" }),
  // Plains.
  Object.freeze({ zip: "73102", city: "Oklahoma City", state: "OK" }),
  Object.freeze({ zip: "74103", city: "Tulsa", state: "OK" }),
  Object.freeze({ zip: "67202", city: "Wichita", state: "KS" }),
  Object.freeze({ zip: "66603", city: "Topeka", state: "KS" }),
  Object.freeze({ zip: "66101", city: "Kansas City", state: "KS" }),
  Object.freeze({ zip: "64106", city: "Kansas City", state: "MO" }),
  Object.freeze({ zip: "63103", city: "St Louis", state: "MO" }),
  Object.freeze({ zip: "65101", city: "Jefferson City", state: "MO" }),
  Object.freeze({ zip: "50309", city: "Des Moines", state: "IA" }),
  Object.freeze({ zip: "68102", city: "Omaha", state: "NE" }),
  Object.freeze({ zip: "68801", city: "Grand Island", state: "NE" }),
  Object.freeze({ zip: "58501", city: "Bismarck", state: "ND" }),
  // South central.
  Object.freeze({ zip: "72201", city: "Little Rock", state: "AR" }),
  Object.freeze({ zip: "72701", city: "Fayetteville", state: "AR" }),
  Object.freeze({ zip: "71901", city: "Hot Springs", state: "AR" }),
  Object.freeze({ zip: "70119", city: "New Orleans", state: "LA" }),
  Object.freeze({ zip: "70508", city: "Lafayette", state: "LA" }),
  Object.freeze({ zip: "71101", city: "Shreveport", state: "LA" }),
  Object.freeze({ zip: "39501", city: "Gulfport", state: "MS" }),
  Object.freeze({ zip: "35203", city: "Birmingham", state: "AL" }),
  Object.freeze({ zip: "36830", city: "Auburn", state: "AL" }),
  Object.freeze({ zip: "38103", city: "Memphis", state: "TN" }),
  Object.freeze({ zip: "37203", city: "Nashville", state: "TN" }),
  Object.freeze({ zip: "37919", city: "Knoxville", state: "TN" }),
  Object.freeze({ zip: "37601", city: "Johnson City", state: "TN" }),
  Object.freeze({ zip: "40202", city: "Louisville", state: "KY" }),
  Object.freeze({ zip: "40507", city: "Lexington", state: "KY" }),
  Object.freeze({ zip: "42301", city: "Owensboro", state: "KY" }),
  // Southeast.
  Object.freeze({ zip: "30301", city: "Atlanta", state: "GA" }),
  Object.freeze({ zip: "30601", city: "Athens", state: "GA" }),
  Object.freeze({ zip: "31201", city: "Macon", state: "GA" }),
  Object.freeze({ zip: "32202", city: "Jacksonville", state: "FL" }),
  Object.freeze({ zip: "32084", city: "St Augustine", state: "FL" }),
  Object.freeze({ zip: "34471", city: "Ocala", state: "FL" }),
  Object.freeze({ zip: "33602", city: "Tampa", state: "FL" }),
  Object.freeze({ zip: "32801", city: "Orlando", state: "FL" }),
  Object.freeze({ zip: "33401", city: "West Palm Beach", state: "FL" }),
  Object.freeze({ zip: "33139", city: "Miami Beach", state: "FL" }),
  Object.freeze({ zip: "28202", city: "Charlotte", state: "NC" }),
  Object.freeze({ zip: "27601", city: "Raleigh", state: "NC" }),
  Object.freeze({ zip: "27401", city: "Greensboro", state: "NC" }),
  Object.freeze({ zip: "28801", city: "Asheville", state: "NC" }),
  Object.freeze({ zip: "29201", city: "Columbia", state: "SC" }),
  Object.freeze({ zip: "29401", city: "Charleston", state: "SC" }),
  Object.freeze({ zip: "29501", city: "Florence", state: "SC" }),
  // Mid-Atlantic and Northeast.
  Object.freeze({ zip: "22201", city: "Arlington", state: "VA" }),
  Object.freeze({ zip: "22030", city: "Fairfax", state: "VA" }),
  Object.freeze({ zip: "23219", city: "Richmond", state: "VA" }),
  Object.freeze({ zip: "24401", city: "Staunton", state: "VA" }),
  Object.freeze({ zip: "21201", city: "Baltimore", state: "MD" }),
  Object.freeze({ zip: "21701", city: "Frederick", state: "MD" }),
  Object.freeze({ zip: "19801", city: "Wilmington", state: "DE" }),
  Object.freeze({ zip: "08540", city: "Princeton", state: "NJ" }),
  Object.freeze({ zip: "07102", city: "Newark", state: "NJ" }),
  Object.freeze({ zip: "10001", city: "New York", state: "NY" }),
  Object.freeze({ zip: "11201", city: "Brooklyn", state: "NY" }),
  Object.freeze({ zip: "13202", city: "Syracuse", state: "NY" }),
  Object.freeze({ zip: "14604", city: "Rochester", state: "NY" }),
  Object.freeze({ zip: "14202", city: "Buffalo", state: "NY" }),
  Object.freeze({ zip: "13905", city: "Binghamton", state: "NY" }),
  Object.freeze({ zip: "19103", city: "Philadelphia", state: "PA" }),
  Object.freeze({ zip: "15222", city: "Pittsburgh", state: "PA" }),
  Object.freeze({ zip: "17101", city: "Harrisburg", state: "PA" }),
  Object.freeze({ zip: "02108", city: "Boston", state: "MA" }),
  Object.freeze({ zip: "06103", city: "Hartford", state: "CT" }),
  Object.freeze({ zip: "02903", city: "Providence", state: "RI" }),
  Object.freeze({ zip: "03301", city: "Concord", state: "NH" }),
  Object.freeze({ zip: "05401", city: "Burlington", state: "VT" }),
  Object.freeze({ zip: "04101", city: "Portland", state: "ME" }),
  // Midwest.
  Object.freeze({ zip: "60601", city: "Chicago", state: "IL" }),
  Object.freeze({ zip: "61101", city: "Rockford", state: "IL" }),
  Object.freeze({ zip: "62901", city: "Carbondale", state: "IL" }),
  Object.freeze({ zip: "46204", city: "Indianapolis", state: "IN" }),
  Object.freeze({ zip: "46802", city: "Fort Wayne", state: "IN" }),
  Object.freeze({ zip: "44113", city: "Cleveland", state: "OH" }),
  Object.freeze({ zip: "45202", city: "Cincinnati", state: "OH" }),
  Object.freeze({ zip: "43215", city: "Columbus", state: "OH" }),
  Object.freeze({ zip: "43604", city: "Toledo", state: "OH" }),
  Object.freeze({ zip: "48226", city: "Detroit", state: "MI" }),
  Object.freeze({ zip: "49503", city: "Grand Rapids", state: "MI" }),
  Object.freeze({ zip: "48933", city: "Lansing", state: "MI" }),
  Object.freeze({ zip: "49855", city: "Marquette", state: "MI" }),
  Object.freeze({ zip: "53202", city: "Milwaukee", state: "WI" }),
  Object.freeze({ zip: "54401", city: "Wausau", state: "WI" }),
  Object.freeze({ zip: "55401", city: "Minneapolis", state: "MN" }),
  Object.freeze({ zip: "55101", city: "Saint Paul", state: "MN" }),
  // Mountain and West.
  Object.freeze({ zip: "80202", city: "Denver", state: "CO" }),
  Object.freeze({ zip: "80901", city: "Colorado Springs", state: "CO" }),
  Object.freeze({ zip: "81501", city: "Grand Junction", state: "CO" }),
  Object.freeze({ zip: "85004", city: "Phoenix", state: "AZ" }),
  Object.freeze({ zip: "85701", city: "Tucson", state: "AZ" }),
  Object.freeze({ zip: "86001", city: "Flagstaff", state: "AZ" }),
  Object.freeze({ zip: "89101", city: "Las Vegas", state: "NV" }),
  Object.freeze({ zip: "89701", city: "Carson City", state: "NV" }),
  Object.freeze({ zip: "89801", city: "Elko", state: "NV" }),
  Object.freeze({ zip: "84101", city: "Salt Lake City", state: "UT" }),
  Object.freeze({ zip: "84321", city: "Logan", state: "UT" }),
  Object.freeze({ zip: "87102", city: "Albuquerque", state: "NM" }),
  Object.freeze({ zip: "87501", city: "Santa Fe", state: "NM" }),
  Object.freeze({ zip: "87401", city: "Farmington", state: "NM" }),
  Object.freeze({ zip: "59101", city: "Billings", state: "MT" }),
  Object.freeze({ zip: "59715", city: "Bozeman", state: "MT" }),
  Object.freeze({ zip: "83404", city: "Idaho Falls", state: "ID" }),
  Object.freeze({ zip: "83702", city: "Boise", state: "ID" }),
  Object.freeze({ zip: "97701", city: "Bend", state: "OR" }),
  Object.freeze({ zip: "97301", city: "Salem", state: "OR" }),
  Object.freeze({ zip: "97214", city: "Portland", state: "OR" }),
  Object.freeze({ zip: "98101", city: "Seattle", state: "WA" }),
  Object.freeze({ zip: "98201", city: "Everett", state: "WA" }),
  Object.freeze({ zip: "99201", city: "Spokane", state: "WA" }),
  Object.freeze({ zip: "98801", city: "Wenatchee", state: "WA" }),
  Object.freeze({ zip: "90012", city: "Los Angeles", state: "CA" }),
  Object.freeze({ zip: "92101", city: "San Diego", state: "CA" }),
  Object.freeze({ zip: "94102", city: "San Francisco", state: "CA" }),
  Object.freeze({ zip: "95814", city: "Sacramento", state: "CA" }),
  Object.freeze({ zip: "93701", city: "Fresno", state: "CA" }),
  Object.freeze({ zip: "95501", city: "Eureka", state: "CA" }),
  Object.freeze({ zip: "93940", city: "Monterey", state: "CA" }),
  Object.freeze({ zip: "93401", city: "San Luis Obispo", state: "CA" }),
]);

function canonicalMarketKey(value) {
  return String(value || "").normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

const REGION_BY_TOKEN = new Map(REGION_TOKENS.map((entry) => [canonicalMarketKey(entry.token), entry]));
const ZIP_BY_CODE = new Map(ZIP_MARKETS.map((entry) => [entry.zip, entry]));

/**
 * Resolve a mining-plan location that is a REGION or ZIP ladder token into its
 * fenceable { city, state }. Returns null for every ordinary location string;
 * the caller keeps its normal metro parsing in that case. The city is the
 * token itself so downstream deep-query shapes keep the exact SERP token
 * ("plumbing in 79401 TX", "plumbing in West Texas TX") rather than silently
 * collapsing a ZIP query back onto its metro name.
 */
function marketTokenLocation(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const region = REGION_BY_TOKEN.get(canonicalMarketKey(raw));
  if (region) return { city: region.token, state: region.state };
  if (/^\d{5}$/.test(raw)) {
    const zip = ZIP_BY_CODE.get(raw);
    if (zip) return { city: zip.zip, state: zip.state };
  }
  return null;
}

module.exports = {
  REGION_TOKENS,
  ZIP_MARKETS,
  marketTokenLocation,
};
