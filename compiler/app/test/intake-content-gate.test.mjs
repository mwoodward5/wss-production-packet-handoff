import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMinimumContent,
  classifyCrawlIndustry,
  sanitizeContactFacts,
  siteIndustryContradiction,
} from "../lib/intake-content-gate.mjs";
import { compileFromInput } from "../lib/intake-genie.mjs";

const identity = {
  name: "Practical Plumbing",
  city: "Bradenton",
  state: "FL",
  category: "plumbing",
};

test("blocks a contact-empty packet with no entity evidence", () => {
  const result = assessMinimumContent({ facts: identity });
  assert.equal(result.ok, false);
  assert.equal(result.code, "minimum_content_identity_unresolved");
});

test("placeholder platform email does not satisfy the contact gate", () => {
  const result = assessMinimumContent({
    facts: { ...identity, email: "filler@godaddy.com" },
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    discovery: {
      facts: { name: "Practical Plumbing", website: "https://practicalplumbing.example/" },
      found: { copy: "Area 1 Area 2 Area 3" },
      summary: { pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
});

test("an unproven contact fact cannot self-approve a sparse intake", () => {
  for (const contact of [
    { phone: "(941) 281-5001" },
    { email: "service@practicalplumbing.com" },
    { address: "123 Main St, Bradenton, FL 34205" },
  ]) {
    assert.equal(assessMinimumContent({ facts: { ...identity, ...contact } }).ok, false);
  }
});

test("stale donor contact from another source host remains blocked", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: { ...identity, phone: "(206) 246-7663" },
    discovery: {
      facts: {
        website: "https://teklineroofing.com/",
        phone: "(206) 246-7663",
      },
      found: {
        contact: { phone: "(206) 246-7663" },
        copy: "Residential service appointments are available.",
      },
      summary: { mode: "firecrawl-source-intake", pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.source_contact.phone, false);
});

test("contact observed on the exact official source host keeps sparse intake working", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://www.practicalplumbing.example/" } },
    facts: { ...identity, phone: "(941) 281-5001" },
    discovery: {
      facts: {
        website: "https://practicalplumbing.example/contact",
        phone: "+1 941-281-5001",
      },
      found: {
        contact: { phone: "(941) 281-5001" },
        copy: "Practical Plumbing serves Bradenton with residential plumbing repairs.",
      },
      summary: { mode: "firecrawl-source-intake", pages_read: 1 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "official_source_contact");
  assert.equal(result.source_contact.phone, true);
});

test("a caller-provided identity_verified flag cannot certify a GBP listing", () => {
  const result = assessMinimumContent({
    input: {
      sources: { gbp_url: "https://www.google.com/maps?cid=123456789" },
      prospect_hints: { identity_verified: true },
    },
    facts: identity,
  });
  assert.equal(result.ok, false);
});

test("a donor contact echoed into facts cannot self-certify without exact name and city evidence", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: { ...identity, phone: "(206) 246-7663" },
    discovery: {
      facts: {
        website: "https://practicalplumbing.example/",
        phone: "(206) 246-7663",
      },
      found: {
        contact: { phone: "(206) 246-7663" },
        copy: "Tekline Roofing serves Tukwila with residential roofing.",
      },
      summary: { mode: "firecrawl-source-intake", pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
});

test("name and city proof cannot publish caller contact hints that the source did not confirm", () => {
  const gate = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: {
      ...identity,
      phone: "(206) 246-7663",
      email: "donor@teklineroofing.com",
      address: "635 Industry Dr, Tukwila, WA 98188",
    },
    discovery: {
      facts: { website: "https://practicalplumbing.example/" },
      found: { copy: "Practical Plumbing serves Bradenton with residential plumbing repairs." },
      summary: { mode: "firecrawl-source-intake", pages_read: 1 },
    },
  });
  assert.equal(gate.ok, true);
  assert.deepEqual(sanitizeContactFacts({
    ...identity,
    phone: "(206) 246-7663",
    email: "donor@teklineroofing.com",
    address: "635 Industry Dr, Tukwila, WA 98188",
  }, gate.source_contact), {
    ...identity,
    phone: "",
    email: "",
    address: "",
  });
});

test("a bare GBP URL cannot self-certify an ambiguous business", () => {
  const result = assessMinimumContent({
    input: { sources: { gbp_url: "https://www.google.com/maps?cid=123456789" } },
    facts: identity,
  });
  assert.equal(result.ok, false);
});

test("official source name and city agreement disambiguates a contact-empty entity", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: identity,
    discovery: {
      facts: { name: "Practical Plumbing", website: "https://practicalplumbing.example/" },
      found: { copy: "Practical Plumbing provides water-heater service throughout Bradenton." },
      summary: { pages_read: 1 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "official_source_identity_match");
});

test("same-name source without a location match remains blocked", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: identity,
    discovery: {
      facts: { name: "Practical Plumbing", website: "https://practicalplumbing.example/" },
      found: { copy: "Practical Plumbing provides residential plumbing services." },
      summary: { pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
});

test("compiler-echoed name cannot replace name evidence in the source page", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://wrong-business.example/" } },
    facts: identity,
    discovery: {
      facts: { name: "Practical Plumbing", website: "https://wrong-business.example/" },
      found: { copy: "Serving Bradenton with residential repair appointments." },
      summary: { pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
});

test("same-name donor copy on another website host cannot prove identity", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: identity,
    discovery: {
      facts: {
        name: "Practical Plumbing",
        website: "https://donor-plumbing.example/",
      },
      found: { copy: "Practical Plumbing serves Bradenton with residential repairs." },
      summary: { mode: "firecrawl-source-intake", pages_read: 1 },
    },
  });
  assert.equal(result.ok, false);
});

test("compiler returns the block before starting a contact-empty preview", async () => {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  try {
    delete process.env.FIRECRAWL_API_KEY;
    const result = await compileFromInput({
      ...identity,
      build_preview: true,
      dry_run: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "minimum_content_identity_unresolved");
    assert.equal(result.preview, undefined);
  } finally {
    if (firecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = firecrawlKey;
  }
});

// ---- site industry vs requested vertical (2026-09-09 El Rio incident) ------

function elRioShapeDiscovery(overrides = {}) {
  return {
    facts: {
      name: "El Rio Health",
      website: "https://elrio.example/",
      phone: "(520) 670-3909",
    },
    found: {
      contact: { phone: "(520) 670-3909" },
      copy: "El Rio Health is a pediatric health center in Tucson. "
        + "Our pediatric care teams welcome new patients, and our patients "
        + "can reach the pharmacy and immunization clinic all in one visit.",
      services: ["Pediatrics", "Pharmacy", "Immunizations"],
      ...overrides,
    },
    summary: { mode: "firecrawl-source-intake", pages_read: 4 },
  };
}

function elRioShapeInput() {
  return {
    sources: { website_url: "https://elrio.example/" },
    prospect_hints: { category: "general contracting" },
  };
}

test("a pediatric healthcare site hard-contradicts a general-contractor intake", () => {
  // Name + city + official phone all agree, so this is exactly the shape that
  // certified and shipped as a general-contractor "before" on 2026-09-09. The
  // contradiction gate must be the refusing gate, ahead of identity success.
  const result = assessMinimumContent({
    input: elRioShapeInput(),
    facts: {
      name: "El Rio Health",
      city: "Tucson",
      state: "AZ",
      category: "general contracting",
      phone: "(520) 670-3909",
    },
    discovery: elRioShapeDiscovery(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "site_industry_contradicts_vertical");
  assert.equal(result.crawl_industry, "medical clinic");
  assert.equal(result.crawl_family, "medical");
  assert.equal(result.requested_family, "home_trade");
  assert.match(result.reason, /medical clinic/);
  assert.match(result.reason, /general contracting/);
});

test("the same crawl still refuses when the requested vertical is raw 'general contractor'", () => {
  const result = siteIndustryContradiction(
    { prospect_hints: { category: "general contractor" } },
    {},
    elRioShapeDiscovery(),
  );
  assert.equal(result.requested_family, "home_trade");
  assert.equal(result.crawl_family, "medical");
});

test("a plumbing site agrees with a plumbing intake and still certifies", () => {
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: { ...identity, phone: "(941) 281-5001" },
    discovery: {
      facts: {
        website: "https://practicalplumbing.example/",
        phone: "(941) 281-5001",
      },
      found: {
        contact: { phone: "(941) 281-5001" },
        copy: "Practical Plumbing serves Bradenton with residential plumbing "
          + "repairs, water heater installation, and drain cleaning.",
      },
      summary: { mode: "firecrawl-source-intake", pages_read: 2 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "official_source_contact");
});

test("a crawl with no clear industry signal abstains and certifies on identity", () => {
  // "Practical Plumbing" appears once (the name token alone is one hit, below
  // the two-hit floor) — the gate must abstain, not refuse.
  const result = assessMinimumContent({
    input: { sources: { website_url: "https://practicalplumbing.example/" } },
    facts: identity,
    discovery: {
      facts: { name: "Practical Plumbing", website: "https://practicalplumbing.example/" },
      found: { copy: "Practical Plumbing serves the greater Bradenton area. Call us today to schedule a visit." },
      summary: { pages_read: 1 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "official_source_identity_match");
});

test("one stray out-of-domain mention in a client list does not refuse a trade site", () => {
  // Commercial-trade sites list client verticals ("we serve restaurants,
  // dental offices, and retailers"). A single hit per other family stays
  // below the two-hit floor and must abstain.
  const contradiction = siteIndustryContradiction(
    { prospect_hints: { category: "plumbing" } },
    {},
    { found: { copy: "We serve restaurants and offices across Bradenton. Practical Plumbing is at your service day and night." } },
  );
  assert.equal(contradiction, null);
});

test("the contradiction is symmetric: a roofing crawl contradicts a dental intake", () => {
  const result = assessMinimumContent({
    input: {
      sources: { website_url: "https://smilestudio.example/" },
      prospect_hints: { category: "dental" },
    },
    facts: {
      name: "Bright Smile Studio",
      city: "Tukwila",
      state: "WA",
      category: "dental",
      phone: "(206) 555-0142",
    },
    discovery: {
      facts: { name: "Bright Smile Studio", website: "https://smilestudio.example/", phone: "(206) 555-0142" },
      found: {
        contact: { phone: "(206) 555-0142" },
        copy: "Bright Smile Studio is a Tukwila roofing contractor. Roofing repairs, shingle replacement, and new gutters for Tukwila homes.",
      },
      summary: { mode: "firecrawl-source-intake", pages_read: 3 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "site_industry_contradicts_vertical");
  assert.equal(result.crawl_industry, "home service trades");
});

// ---- sibling contradictions (lane02, 2026-09-09 El Rio class) ------------
// Each of these mirrors the exact El Rio shape: name, city, AND an
// official-host phone all agree, so every identity/contact path would certify.
// The refusal must come from the contradiction gate alone.

function siblingDiscovery({ name, website, phone, copy }) {
  return {
    facts: { name, website, phone },
    found: { contact: { phone }, copy },
    summary: { mode: "firecrawl-source-intake", pages_read: 3 },
  };
}

test("a hair salon crawl contradicts a roofing intake", () => {
  const result = assessMinimumContent({
    input: {
      sources: { website_url: "https://voguecuts.example/" },
      prospect_hints: { category: "roofing" },
    },
    facts: {
      name: "Vogue Cuts Salon",
      city: "Mesa",
      state: "AZ",
      category: "roofing",
      phone: "(480) 835-2147",
    },
    discovery: siblingDiscovery({
      name: "Vogue Cuts Salon",
      website: "https://voguecuts.example/",
      phone: "(480) 835-2147",
      copy: "Vogue Cuts Salon is a hair salon in Mesa. Our hairstylists "
        + "create balayage, blowouts, and hair extensions for every occasion.",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "site_industry_contradicts_vertical");
  assert.equal(result.crawl_industry, "salon");
  assert.equal(result.crawl_family, "beauty_wellness");
  assert.equal(result.requested_family, "home_trade");
  assert.equal(result.source_contact.phone, true);
  assert.match(result.reason, /salon/);
  assert.match(result.reason, /roofing/);
});

test("a dental crawl contradicts an HVAC intake", () => {
  const result = assessMinimumContent({
    input: {
      sources: { website_url: "https://brightsmiledental.example/" },
      prospect_hints: { category: "hvac" },
    },
    facts: {
      name: "Bright Smile Dental",
      city: "Chandler",
      state: "AZ",
      category: "hvac",
      phone: "(480) 719-3062",
    },
    discovery: siblingDiscovery({
      name: "Bright Smile Dental",
      website: "https://brightsmiledental.example/",
      phone: "(480) 719-3062",
      copy: "Bright Smile Dental is a family dentistry office in Chandler. "
        + "Our dentists provide teeth whitening, Invisalign aligners, and "
        + "gentle cleanings for every patient.",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "site_industry_contradicts_vertical");
  assert.equal(result.crawl_industry, "dental practice");
  assert.equal(result.crawl_family, "dental");
  assert.equal(result.requested_family, "home_trade");
  assert.equal(result.source_contact.phone, true);
});

test("a law office crawl contradicts a plumbing intake", () => {
  const result = assessMinimumContent({
    input: {
      sources: { website_url: "https://hartreedlaw.example/" },
      prospect_hints: { category: "plumbing" },
    },
    facts: {
      name: "Hart & Reed Law",
      city: "Scottsdale",
      state: "AZ",
      category: "plumbing",
      phone: "(480) 946-5518",
    },
    discovery: siblingDiscovery({
      name: "Hart & Reed Law",
      website: "https://hartreedlaw.example/",
      phone: "(480) 946-5518",
      copy: "The law office of Hart & Reed serves Scottsdale. Our attorneys "
        + "handle personal injury, family law, and criminal defense cases "
        + "across Arizona.",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "site_industry_contradicts_vertical");
  assert.equal(result.crawl_industry, "law firm");
  assert.equal(result.crawl_family, "legal");
  assert.equal(result.requested_family, "home_trade");
  assert.equal(result.source_contact.phone, true);
});

test("over-refusal control: a law crawl against an attorney intake still certifies", () => {
  // Same-family crawls must abstain; identity alone keeps a GOOD candidate
  // moving. This is the counterweight to the sibling refusals above.
  const result = assessMinimumContent({
    input: {
      sources: { website_url: "https://hartreedlaw.example/" },
      prospect_hints: { category: "attorney" },
    },
    facts: {
      name: "Hart & Reed Law",
      city: "Scottsdale",
      state: "AZ",
      category: "attorney",
    },
    discovery: siblingDiscovery({
      name: "Hart & Reed Law",
      website: "https://hartreedlaw.example/",
      phone: "",
      copy: "The law office of Hart & Reed serves Scottsdale. Our attorneys "
        + "handle personal injury, family law, and criminal defense cases "
        + "across Arizona.",
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "official_source_identity_match");
});

test("a product-selling salon is not misread as retail — platform idioms yield to industry nouns", () => {
  // Lane02 over-refusal finding, 2026-09-09: the retail group sat ABOVE the
  // salon group, so a salon shop section ("online store", "free shipping")
  // reached the two-hit retail floor first and refused a good candidate.
  const shopSalon = {
    found: {
      copy: "Our hair salon stylists offer balayage and blowouts. "
        + "Shop our online store with free shipping on professional hair care products.",
    },
  };
  assert.equal(classifyCrawlIndustry(shopSalon)?.family, "beauty_wellness");
  assert.equal(siteIndustryContradiction({ prospect_hints: { category: "hair salon" } }, {}, shopSalon), null);
});

test("a storefront-only site with no industry signals still reads as retail and refuses", () => {
  const storefront = {
    found: {
      copy: "Welcome to our online store. Add to cart, enjoy free shipping, and browse our product categories powered by Shopify.",
    },
  };
  assert.equal(classifyCrawlIndustry(storefront)?.family, "retail");
  assert.notEqual(siteIndustryContradiction({ prospect_hints: { category: "hair salon" } }, {}, storefront), null);
});

test("sanctioned hybrid families abstain instead of refusing", () => {
  // A bridal/makeup salon crawl (beauty_wellness) against a photographer
  // intake (events_media) is a sanctioned compatible pair.
  const result = siteIndustryContradiction(
    { prospect_hints: { category: "photographer" } },
    {},
    { found: { copy: "Our hair salon stylists offer bridal updos and wedding makeup, with manicures before your big day." } },
  );
  assert.equal(result, null);
});

test("no requested category abstains even when the crawl reads as another industry", () => {
  const result = siteIndustryContradiction(
    {},
    {},
    elRioShapeDiscovery(),
  );
  assert.equal(result, null);
});

test("an empty discovery abstains — the gate only ever sharpens, never blocks blind", () => {
  const result = assessMinimumContent({ facts: identity });
  assert.equal(result.ok, false);
  assert.equal(result.code, "minimum_content_identity_unresolved");
});

test("crawl industry classification picks the first family reaching two hits", () => {
  const medical = classifyCrawlIndustry(elRioShapeDiscovery());
  assert.equal(medical.family, "medical");
  assert.equal(classifyCrawlIndustry({ found: { copy: "" } }), null);
  assert.equal(classifyCrawlIndustry({}), null);
  assert.equal(classifyCrawlIndustry(), null);
});
