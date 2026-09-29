"use strict";

/**
 * lib/mirror-engine/service-names.js — is this string a thing the business
 * SELLS, or an article they wrote about it?
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-11 two live plumbing mirrors published these to real companies, in
 * schema.org `Service` nodes, as the list of what the business does:
 *
 *   holt-plumbing-company-nashville
 *     "Why Discolored Water Could Mean You Need Water Heater Repair"
 *     "9 Benefits of Prompt Water Heater Repairs"
 *     "The Importance of Managing Water Heating Usage at Home"
 *     "Plumber-Approved Tips to Curb Water Waste"
 *     "3 Ways Plumbers Help Prevent Residential Floods"
 *     "How to Prevent Your Home's Pipes From Freezing This Winter"
 *     "and surrounding areas"
 *
 *   cooper-perry-plumbing-tulsa
 *     "5 Tips for Finding a Reliable Emergency Plumbing Company"
 *     "When Should You Call a Professional for Plumbing Repair?"
 *     "What Should I Look for in Plumbing Services?"
 *     "and surrounding areas"
 *
 * Every one is the client's own blog, harvested from their own navigation. The
 * existing refusals could not see them: NON_SERVICE_PATH blocks `/blog/…`, and
 * both sites publish their posts at the ROOT — holtplumbing.com/why-discolored-
 * water-… — so there is no `blog` segment to match on. A path blocklist can
 * only refuse a URL somebody thought to name.
 *
 * WHAT THIS MODULE IS FOR
 * ---------------------------------------------------------------------------
 * The CLASS, judged where the class lives: in the LABEL. A service name is a
 * noun phrase a customer could ask for by name — "Water Heater Repair", "Hydro
 * Jetting", "24/7 Emergency Plumbing". An article title is a SENTENCE: it asks a
 * question, counts something, gives advice, or addresses the reader. Nobody
 * calls a plumber and asks for "9 Benefits of Prompt Water Heater Repairs".
 *
 * Asked in two places, exactly like place-names.js: where services are
 * harvested (verified-facts.js, so the list never holds one) and at the publish
 * door (content-inject.js withUsableServices, so no surface can print one even
 * if a future source supplies it).
 *
 * THE BAR IS DELIBERATELY LOW, AND IT IS ASYMMETRIC.
 * ---------------------------------------------------------------------------
 * Dropping a real service costs one card on a page that has eleven others.
 * Publishing "What Should I Look for in Plumbing Services?" as a service costs
 * the owner their belief that anybody read the page. So every rule below
 * refuses only what is UNARGUABLE, and each was checked against the real
 * service lists on the live fleet:
 *
 *   Water Heater Repair · Drain Cleaning · Sewer Line Replacement · Hydro
 *   Jetting · Slab Leak Detection · Gas Line Services · Repiping · Sump Pumps ·
 *   Backflow Testing · Tankless Water Heaters · Commercial Plumbing ·
 *   24/7 Emergency Service · AC Installation · Furnace Repair · Duct Cleaning ·
 *   St. Louis Drain Cleaning · 1 Day Bath Remodel
 *
 * Not one of them is touched by anything here. The last two are in the list on
 * purpose: a leading integer and an embedded full stop are both NORMAL in real
 * service names, which is why neither is a rule on its own.
 */

const trim = (v) => String(v == null ? "" : v).trim();

/**
 * DECORATIVE GLYPHS COME OFF BEFORE ANY RULE LOOKS AT THE LABEL.
 *
 * wss-test-larson-air-conditioning-scottsdale published the schema.org Service
 * `"Free Consultation →"`. The arrow is a CSS-less button affordance that the
 * anchor-text scrape swallowed whole, and it defeated every whole-label rule in
 * this file by one character. Arrows, chevrons, bullets and pipes are never part
 * of the name of something a business sells, so they are stripped from both ends
 * once, here, and every rule below reasons about the words a reader would read.
 */
const EDGE_GLYPHS = /^(?:[\s•·‣▸⁃|/\\>»›—–…-]+|\.{2,})+|(?:[\s•·‣▸⁃|/\\<«‹→➔➡➜⟶⇒>»›—–…]+|\.{2,})+$/g;
const fold = (v) => trim(v).replace(/\s+/g, " ").replace(EDGE_GLYPHS, "").trim();

/**
 * The listicle. "5 Tips for…", "9 Benefits of…", "3 Ways…", "7 Signs…".
 *
 * A LEADING INTEGER ALONE IS NOT ENOUGH — "24/7 Emergency Service" and "1 Day
 * Bath Remodel" are real services and both start with a number. The
 * discriminator is the COUNTED NOUN: a closed list of the things a headline
 * counts. No business sells "tips", "ways" or "reasons".
 */
const LISTICLE_NOUN = new RegExp(
  "^\\d{1,3}\\s+(?:best|top|common|easy|quick|simple|surprising|essential|important|helpful|smart|proven|warning|red)?\\s*"
  + "(?:tips?|ways?|reasons?|benefits?|signs?|things?|steps?|mistakes?|myths?|questions?|facts?|ideas?"
  + "|secrets?|flags?|considerations?|factors?|causes?|problems?|issues?|tricks?|hacks?|rules?|lessons?"
  + "|takeaways?|misconceptions?)\\b",
  "i",
);

/**
 * THE COUNTED HEADLINE THAT COUNTS SOMETHING REAL.
 *
 * "6 Smart Fence Services For Better Security" — cornerstone-fence, live on
 * 2026-08-11, the only article headline the closed-list rule above could not
 * see. It counts "services", which is exactly the word a fencing company would
 * use for the real thing, so no list of counted nouns can separate it.
 *
 * LENGTH does. The longest genuine service name on the fleet that opens with a
 * digit is "1 Day Bath Remodel" (4 words); "24/7 Emergency Service" is 3. A
 * label that opens with a number and then runs SIX words or longer is a
 * headline in every case anyone has been able to produce. The floor sits two
 * words clear of the longest real one, so nothing measured is at risk.
 */
const LISTICLE_LENGTH_FLOOR = 6;
const OPENS_WITH_COUNT = /^\d{1,3}\b/;

/**
 * The question. A service is never punctuated with "?" — "When Should You Call
 * a Professional for Plumbing Repair?", "What Should I Look for in Plumbing
 * Services?". The single most reliable rule in the file, with no false positive
 * anybody has been able to name.
 */
const ENDS_IN_QUESTION = /\?\s*$/;

/**
 * The advice headline, recognised by how it OPENS. Every stem below promises to
 * EXPLAIN something rather than name it.
 *
 * Anchored to the start and each requiring further words, so a service that
 * merely CONTAINS one of these is untouched: "Whole Home Repiping" keeps
 * "Home", "Water Heater Installation" keeps "Water".
 */
const ADVICE_OPENER = new RegExp(
  "^(?:"
  + "how\\s+(?:to|do|does|can|much|often|long)"          // How to Prevent Your Home's Pipes…
  + "|why\\s+\\w+"                                        // Why Discolored Water Could Mean…
  + "|when\\s+(?:should|to|is|it|do|does|your|you)"       // When Should You Call a Professional…
  + "|what\\s+(?:is|are|to|should|you|your|every|makes|happens|causes)"
  + "|where\\s+(?:to|do|does|can)"
  + "|which\\s+\\w+"
  + "|should\\s+(?:you|i|we)"
  + "|can\\s+(?:you|i|we)"
  + "|do\\s+(?:you|i|we)"
  + "|does\\s+(?:your|my|a|the)"
  + "|is\\s+(?:your|it|my|a|the)"
  + "|are\\s+(?:you|your|my|the)"
  + "|everything\\s+you"
  + "|the\\s+(?:importance|benefits?|dangers?|truth|difference|signs?|pros)\\b"
  + "|understanding\\s+\\w+"
  + "|introducing\\s+\\w+"
  + "|tips?\\s+(?:for|to|on)\\b"
  + "|signs?\\s+(?:you|your|that|it)\\b"
  + "|ways?\\s+to\\b"
  + "|reasons?\\s+(?:to|why)\\b"
  + "|benefits?\\s+of\\b"
  // END OF STRING COUNTS AS A BOUNDARY. This was `)\\s`, which required a word
  // AFTER the stem — so "Why Discolored Water Could Mean…" was refused and
  // "Why Larson" was not, and wss-test-larson-air-conditioning-scottsdale
  // published "Why Larson" as its only schema.org Service on the rebuilt fleet.
  + ")(?:\\s|$)",
  "i",
);

/**
 * EDITORIAL VOCABULARY — words that name a piece of WRITING, not a job.
 *
 * "Plumber-Approved Tips to Curb Water Waste" opens with neither a number nor a
 * question nor a sentence stem, and it is still unmistakably a blog post. The
 * word "Tips" is what makes it one, wherever it sits in the string.
 *
 * Deliberately short. Every entry is a word that cannot appear in the name of
 * something a home-services business invoices for.
 */
const EDITORIAL_WORD = /\b(?:tips|myths?|misconceptions?|takeaways?|blog|infographic|newsletter|case\s+stud(?:y|ies))\b/i;

/**
 * "The Ultimate Guide to Water Heaters", "A Homeowner's Guide to Repiping".
 * Bare "guide" is NOT enough on its own — it names real products elsewhere —
 * so the possessive/superlative frame is required.
 */
const GUIDE_FRAME = /\b(?:ultimate|complete|essential|beginner'?s?|homeowner'?s?|buyer'?s?|quick)\s+guide\b|\bguide\s+to\b/i;

/**
 * A NAVIGATION LABEL. Somewhere to click, not something to buy.
 *
 * Found on the REBUILT fleet, 2026-08-11: wss-test-sears-heating-and-cooling-
 * columbus publishes schema.org Services reading
 * ["Contact Us", "Furnace Repair", "Furnace Replacement", "AC Repair"] — three
 * real services and a menu item.
 *
 * verified-facts.js already refuses these by PATH (`/contact-us`) and carries
 * its own label blocklist, but that list never held the two most common words
 * on any site's nav, and neither list is asked at the publish door. Whole-label
 * matches only, so "Emergency Service" and "Contact-Free Estimates" are
 * untouched.
 */
/**
 * A label made only of a measurement — "100%", "24/7", "5,000+", "$99", "1st",
 * "4.9". These come off stat blocks and badge rows, which sit in exactly the
 * heading tags the services harvester reads.
 *
 * THE DISCRIMINATOR IS "NO LETTERS THAT FORM A WORD". Anything carrying an
 * actual word survives, because that word is what makes it askable-for:
 * "24/7 Emergency Service", "5 Star Drain Cleaning" and "Trenchless 2.0" all
 * pass. Unit suffixes glued to the number (100%, 5k, 30min, 2nd) are part of
 * the measurement, not a word.
 */
const MEASUREMENT_ONLY = new RegExp(
  "^[$€£]?\\d[\\d,.]*\\s*"
  + "(?:%|\\+|k|m|x|st|nd|rd|th|hr|hrs|min|mins|yr|yrs|\\/\\s*\\d+)?"
  + "(?:\\s*[-–/]\\s*[$€£]?\\d[\\d,.]*\\s*(?:%|\\+|k|m|x|hr|hrs|min|mins|yr|yrs)?)?$",
  "i",
);

const NAVIGATION_LABEL = new RegExp(
  "^(?:home|contact(?:\\s+us)?|about(?:\\s+us)?|get\\s+in\\s+touch|"
  + "request\\s+(?:a\\s+)?(?:quote|service|estimate|appointment)|"
  + "book(?:\\s+now|\\s+online|\\s+(?:a|an)\\s+\\w+)?|schedule(?:\\s+service|\\s+now)?|"
  + "call\\s+(?:us|now|today)|menu|search|reviews?|testimonials?|gallery|portfolio|"
  + "our\\s+work|photos?|projects?|blog|news|careers?|team|our\\s+team|"
  + "locations?|service\\s+areas?|areas\\s+we\\s+serve|financing|specials?|coupons?|"
  + "faqs?|privacy(?:\\s+policy)?|terms(?:\\s+of\\s+(?:use|service))?|sitemap|"
  // ---- ADDED 2026-08-11, EVERY ONE MEASURED IN A LIVE schema.org Service NODE.
  // The rendered fleet audit found 18 of 100 live mirrors publishing at least
  // one of these AS A SERVICE, and — because seoDescription() leads with
  // services[0] — shipping it as the first words of their Google snippet:
  //   "Photo Gallery in Portland, OR. Rated 4.9 from 608 Google reviews."
  //   "Support in Indianapolis, IN. Rated 4.9 from 1210 Google reviews."
  // A prospect reading that has been told their new website sells a photo
  // gallery. Whole-label only, so "Gallery Wall Installation", "Product
  // Sourcing" and "Warranty Repairs" are untouched.
  + "(?:photo|image|video|project|our)\\s+gallery|galleries|videos?|"
  + "products?|our\\s+products?|brands?|our\\s+brands?|parts?|supplies|manuals?|"
  + "support|customer\\s+support|help|help\\s+center|resources?|"
  + "warrant(?:y|ies)|guarantees?|"
  // A LINK TO THE SERVICE INDEX IS NOT A SERVICE. "All services" and "All
  // Services" were both live, on two different mirrors, as card 01.
  + "(?:all|our|full|more|view\\s+all|browse|see\\s+all)?\\s*services?|"
  // ---- ADDED 2026-08-11, MEASURED ON THE REBUILT FLEET.
  // `specials?` and `rebates?` were already here, and both were WHOLE-LABEL,
  // so the two spellings Rose City's own menu actually uses walked straight
  // through: "Web Specials" and "Rebates & Incentives" shipped as schema.org
  // Service nodes on the live mirror. A qualifier in front of a promo noun
  // does not turn a promotion into a thing the business sells.
  + "(?:web|online|current|seasonal|monthly|new|this\\s+month'?s?)\\s+specials?|"
  + "rebates?(?:\\s*(?:&|and)\\s*incentives?)?|incentives?|"
  + "special\\s+offers?|offers?|promotions?|deals?|"
  // The CTA that lost its verb to a <span>: "Schedule An" and "Appointment"
  // shipped as two SEPARATE service cards on wss-test-…-las-vegas.
  + "appointments?|(?:free\\s+|service\\s+)?estimates?|(?:free\\s+)?consultations?|quotes?|pricing|"
  + "our\\s+(?:story|mission|process|values|company|history|difference|guarantee|promise)|"
  + "meet\\s+the\\s+team|why\\s+choose\\s+us|employment|apply\\s+now|"
  // Whole headings/CTAs observed in the restored donor fleet, never substrings.
  + "hiring|services?\\s+categories|scheduling\\s+(?:a\\s+)?consultation|"
  + "let['’]s\\s+build\\s+something\\s+together|built\\s+for\\s+new\\s+mexico['’]s\\s+climate|"
  + "covid(?:[-\\s]?19)?(?:\\s+(?:protocols?|update|response|safety|info|information))?|"
  // ---- ADDED 2026-08-20, EVERY ONE MEASURED ON A LIVE SANDBOX BUILD.
  // Footer-column headings and empty-state strings harvested as services on
  // 4 of 5 audited sites: "Socials", "Our Address", "Union Office",
  // "Member Resources", "Nothing Found", "Company", "Business Hours",
  // "Stay Connected". All are places to CLICK or labels over a link list —
  // nothing a customer could phone up and ask to have done. Whole-label only,
  // as ever: "Office Cleaning", "Home Address Numbering" and any real service
  // that merely CONTAINS one of these words is untouched.
  + "socials?|social\\s+media|stay\\s+connected|connect(?:\\s+with\\s+us)?|follow\\s+us|"
  // Resource/navigation headings are not customer-purchasable work.  Keep
  // this whole-label only: a real service may legitimately contain “links” or
  // “community”, but “Useful Links for Your Community” is a resource column.
  + "(?:(?:useful|helpful|community)\\s+)*(?:links?|resources?)(?:\\s+for\\s+(?:your\\s+)?community)?|"
  + "community\\s+(?:links?|resources?)(?:\\s*(?:&|and)\\s*(?:links?|resources?))?|"
  + "(?:links?|resources?)\\s*(?:&|and)\\s*(?:community\\s+)?(?:links?|resources?)|"
  + "(?:our\\s+)?address(?:es)?|"
  + "(?:business|office|store|opening|working)\\s+hours|hours|"
  + "(?:union|main|head|corporate|branch|our|the)\\s+offices?|offices?|"
  + "(?:member|customer|client|homeowner|owner|patient|community)\\s+resources?|"
  + "nothing\\s+found|no\\s+results?(?:\\s+found)?|page\\s+not\\s+found|not\\s+found|404(?:\\s+error)?|"
  + "(?:our\\s+|the\\s+)?company"
  + ")$",
  "i",
);

/**
 * SECTION TITLES THAT DESCRIBE SITE CONTENT, NOT CUSTOMER WORK.
 *
 * The exact-label list above catches terse menu text. Source pages also wrap
 * the same destinations in decorative headings ("Latest Blog Posts", "About
 * Our Company", "Customer Reviews"). Keep this rule whole-label and require a
 * section noun/frame, so real services that merely contain words such as
 * "community", "contact", or "financing" remain publishable.
 */
const NON_SERVICE_SECTION_HEADING = new RegExp(
  "^(?:"
  + "(?:useful|helpful|local|community|customer|client|homeowner|patient|member|additional|online)?\\s*"
  + "(?:links?|resources?)(?:\\s+(?:for|in)\\s+(?:our|your|the)?\\s*community)?"
  + "|(?:about|meet)\\s+(?:us|our\\s+(?:company|team|business)|the\\s+(?:company|team))"
  + "|(?:customer|client|patient|homeowner|google|our)\\s+(?:reviews?|testimonials?)"
  + "|(?:frequently\\s+asked\\s+questions|common\\s+questions|questions\\s+(?:and|&)\\s+answers)"
  + "|(?:our|the|local)?\\s*service\\s+areas?(?:\\s+(?:and|&)\\s+locations?)?"
  + "|(?:contact|get\\s+in\\s+touch)\\s+(?:information|details|our\\s+team|the\\s+team)"
  + "|(?:available|easy|flexible|our)?\\s*financing\\s+(?:options?|information|details|programs?)"
  + "|(?:latest|recent|featured|our)?\\s*(?:blog|news)\\s+(?:posts?|articles?|updates?|stories?)"
  + "|(?:community|local)\\s+(?:resource|information|link)\\s+cent(?:er|re)"
  + ")$",
  "i",
);

/**
 * A COUPON OR PRICE FRAGMENT IS NOT A SERVICE. Measured live on the sandbox
 * fleet, 2026-08-20, in schema.org Service nodes and the quote-form dropdown:
 *
 *   "$99 (New Customers Only)"          — a price with its terms
 *   "15%OFF"                            — a discount sticker
 *   "1/2 Priced With A/C Purchase"      — a bundle deal
 *
 * Three shapes, each anchored to what makes it a DEAL rather than a job:
 * a label that OPENS with a currency amount, a percent-off anywhere, and a
 * leading number/fraction followed by "priced". "1 Day Bath Remodel" and
 * "24/7 Emergency Service" open with a number and none of these, and keep
 * every word — the discriminator is the money grammar, never the digit.
 */
const PRICE_OPENER = /^[$€£]\s*\d/;
const PERCENT_OFF = /\d\s*%\s*off\b/i;
const FRACTION_PRICED = /^\d+(?:\/\d+)?\s+priced?\b/i;
const COUPON_TERMS = /\bnew\s+customers?\s+only\b/i;

/**
 * A RAW URL IS NOT A SERVICE. "https://abetterfencecompany.com/lewisville-
 * fence-companies/" shipped as a service card, into the quote-form dropdown
 * and into a generated page route, on a live sandbox build (2026-08-20). The
 * packet path's serviceName() already refused embedded URLs; this predicate is
 * asked at EVERY door (harvest, packet, contract, publish), so now they all
 * do. Any scheme, protocol-relative, or a bare www. host counts.
 */
const BARE_URL = /(?:^|\s)(?:https?:\/\/|\/\/|www\.[a-z0-9-]+\.)/i;

/**
 * CONTACT DETAILS ARE NOT WORK THE BUSINESS SELLS.
 *
 * These expressions only convict a whole email address or a whole North
 * American phone label, optionally introduced by the contact verb/field name.
 * Digits in a genuine service name remain ordinary words: "24/7 Emergency
 * Plumbing", "5 Star Plumbing" and "24000 BTU Installation" cannot match.
 */
const CONTACT_EMAIL = /(?:^|[^a-z0-9.!#$%&'*+/=?^_`{|}~-])[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:$|[^a-z0-9-])/i;
const PHONE_NUMBER = "(?:(?:\\+?1[\\s.\\-]*)?(?:\\(\\s*\\d{3}\\s*\\)|\\d{3})[\\s.\\-]*\\d{3}[\\s.\\-]*\\d{4}|\\d{3}[\\s.\\-]+\\d{4})(?:\\s*(?:x|ext\\.?|extension)\\s*\\d{1,6})?";
const CONTACT_PHONE = new RegExp(
  "^(?:(?:call(?:\\s+us)?(?:\\s+(?:now|today))?|phone(?:\\s+number)?|tel(?:ephone)?|text(?:\\s+us)?)(?:\\s+at)?\\s*[:\\-]?\\s*)?"
  + PHONE_NUMBER
  + "$",
  "i",
);
const MARKDOWN_CONTACT_LINK = /^\[[^\]]+\]\(\s*(tel|mailto):[^)]+\)$/i;

/**
 * A BUTTON, NOT A PRODUCT. Recognised by its VERB.
 *
 * "Free Consultation →", "Schedule consultation", "Schedule a Free
 * Consultation", "Schedule An" — four live mirrors, four spellings of the same
 * button, and a whole-label blocklist can only ever refuse the spellings
 * somebody thought to write down. What they share is grammar: a call to action
 * is an IMPERATIVE addressed to the visitor, and a service name is a noun
 * phrase. Every service on the fleet's real lists is a noun phrase.
 *
 * Anchored to the opening word and checked against all eleven verticals this
 * engine builds — plumbing, HVAC, roofing, concrete, fencing, landscaping,
 * medspa, salon, tattoo, electrical, remodeling. Not one real service name in
 * any of them opens with one of these verbs ("Water Heater Repair", "Hydro
 * Jetting", "Laser Hair Removal", "Balayage", "Stamped Concrete", "Heat Pumps").
 */
/**
 * A PROMISE ABOUT THE BUSINESS IS NOT A THING THE BUSINESS SELLS.
 *
 * Measured live 2026-08-12, five of ten fresh mirrors were blocked by the
 * independent scanner for publishing one of these in the services grid:
 *
 *   "Fast Response"                 Universal Plumbing, Augusta GA
 *   "Affordable Price"              Cook Plumbing, West Des Moines IA
 *
 * Both are real copy from the client's own page, harvested honestly — and both
 * are a BADGE, not a tile. A services grid answers "what do you do", and
 * "Affordable Price" is not an answer to it. The underlying work is normally
 * present in the same list under its own name ("Emergency Repair", "Water
 * Heater Installation"), so refusing these shortens the grid without costing
 * the client a capability.
 *
 * ONE SHAPE IS REFUSED HERE:
 *   QUALITY_CLAIM      — a bare adjective+noun quality boast with no trade
 *                        noun in it at all. The word floor keeps this narrow:
 *                        "Affordable Drain Cleaning" is a real service name
 *                        and survives, because it carries the work.
 *
 * AVAILABILITY_CLAIM_NOT_APPLIED — AN UNRESOLVED DISAGREEMENT BETWEEN TWO
 * GATES, LEFT VISIBLE RATHER THAN SETTLED IN CODE.
 *
 * The same 2026-08-12 scan blocked three more hosts for a fourth shape:
 *
 *   "24/7 Emergency Service"                    Buddy the Plumber, TN
 *   "24/7 Emergency Residential/Commercial HVAC"  Anchor Heating & Air, GA
 *   "24/7 Emergency HVAC Repair"                Indoor Comfort Team, MO
 *
 * scripts/mailable-scan.js calls these "marketing slogan, not a service" and
 * BLOCKS. This file's own test suite asserts the opposite in as many words:
 * test/services-are-services.test.js, "not one real service name is refused",
 * lists "24/7 Emergency Service" as a REAL service name that must survive.
 *
 * A rule was written here to refuse the shape and was REVERTED, because it made
 * the engine contradict its own tests, and because "Emergency Plumbing Repair"
 * — plainly a thing people buy — died with it. The scanner is deliberately
 * independent and is not weakened from this side either. So the two gates
 * disagree, three hosts stay blocked, and the choice belongs to an operator:
 * either the scanner narrows to bare availability badges (leaving names that
 * carry real work), or these labels stop being published. Do not "fix" this by
 * quietly widening one side.
 */

/** Quality boasts: "Fast Response", "Affordable Price", "Quality Workmanship". */
const QUALITY_WORD = /^(?:fast|quick|rapid|prompt|speedy|affordable|cheap|low|best|top|great|quality|superior|premium|honest|reliable|dependable|trusted|professional|expert|friendly|licensed|insured|certified|guaranteed|satisfaction|competitive|fair|upfront|transparent)$/i;
const QUALITY_NOUN = /^(?:response|price|pricing|prices|rates?|cost|costs|service|services|work|workmanship|quality|value|results?|care|support|team|staff|technicians?|estimates?|guarantee|guaranteed|satisfaction|experience|craftsmanship)$/i;
/** Above this many words it is prose, and the other rules already judge it. */
const QUALITY_CLAIM_MAX_WORDS = 3;
const TRAINING_LABEL = /^(?:ongoing|continued|continuing)\s+training$/i;
const AUDIENCE_PROMISE = /\b(?:customers?|homeowners?|residents?)!$/i;
const MARKETING_HEADING = /^expert\s+care\s+from\s+local\s+.+\s+pros$/i;
/**
 * MARKETING PUNCTUATION, GENERALIZED FROM THE MEASURED SHAPE. AUDIENCE_PROMISE
 * convicts exactly "…Customers!"; the 2026-09-01 Comet audit measured that one
 * live ("Las Vegas Plumbing Customers!", Precision, riding in the quote-form
 * dropdown). But punctuation is the louder half of that signal — no label a
 * customer could ask for by name shouts. An exclamation mark anywhere in a
 * label is a banner, a badge or a heading, never a service.
 */
const EXCLAMATION = /!/;
/**
 * A WORD LEFT OVER FROM A TOKENIZED HEADING. Rumsey's quote-form dropdown
 * (Comet audit, 2026-09-01) offered the heading "Our Commercial General
 * Contracting" one word at a time — "Our Commercial" (refused above),
 * "General", "Contracting…". The ellipsis now folds off (EDGE_GLYPHS) and the
 * first fragment dies at the leading-"Our" rule; these are the leftover
 * middle pieces. WHOLE-LABEL ONLY, like every fragment rule: "General
 * Contracting", "New Construction" and "Contracting Services" are real
 * services and keep every word. Alone, the word is a piece of a heading, and
 * no customer phones a contractor and asks for "general".
 */
const SEGMENT_HEADING_WORD = /^(?:general|contracting)$/i;

const CALL_TO_ACTION = new RegExp(
  "^(?:schedule|book|request|reserve|claim|start|begin|join|apply|sign\\s*up|subscribe|"
  + "shop|browse|view|see|read|watch|explore|discover|learn|find|download|meet|visit|try|"
  + "contact|call|email|text|chat|talk|speak|ask|click|tap|refer|get|order|save\\s+on|let\\s+us"
  + ")(?:\\s|$)",
  "i",
);

/**
 * WHO IT IS FOR, NOT WHAT IT IS. Six mirrors published a bare "Commercial" and
 * five a bare "Residential" — the two halves of a nav dropdown that segments the
 * SAME services by customer type.
 *
 * Whole-label only, and that restriction is the whole rule: "Commercial
 * Plumbing", "Residential Roofing" and "Industrial Duct Cleaning" name a real
 * service and keep every word. Alone, the word names an audience.
 */
const AUDIENCE_SEGMENT = new RegExp(
  "^(?:commercial|residential|industrial|domestic|business(?:es)?|homeowners?|home\\s?owners?|multi-?family)"
  + "(?:\\s*(?:&|and|/)\\s*(?:commercial|residential|industrial))?$",
  "i",
);

/**
 * A MEMBERSHIP PROGRAM. "Comfort Club", "Filter Club", "Columbus's Best HVAC
 * Service Club" — all live, all in schema.org Service nodes.
 *
 * The owner named "Comfort Club" himself as a thing that is not a service. A
 * club is a billing relationship the business sells memberships TO; nobody calls
 * an HVAC company and asks them to come out and do a Comfort Club.
 *
 * A MAINTENANCE PLAN IS DELIBERATELY NOT REFUSED. "Family Maintenance Plan" and
 * "Chill Maintenance Plan" were on the same audit list and they stay, because a
 * customer really does phone up and ask for the maintenance plan by name. The
 * bar in this file is what is UNARGUABLE, and that one is arguable.
 */
const MEMBERSHIP_PROGRAM = /\bclubs?\b/i;

/**
 * A POLICY PAGE. "Link Policy" and "COVID-19 PROTOCOL" both shipped as services,
 * and the second one led a live meta description:
 *   "COVID-19 PROTOCOL in Doraville, GA. Rated 4.9 from 162 Google reviews."
 *
 * Anchored to the END of the label, where the page-type noun sits. A service
 * called "Policy Review" or "Protocol Design" keeps its words.
 */
const POLICY_LABEL = /\b(?:polic(?:y|ies)|protocols?|statements?|disclosures?|guidelines?|compliance|notices?)$/i;

/**
 * A PHRASE CUT OFF MID-SENTENCE. The mirror-image of DANGLING_OPENER: markup
 * split "Schedule An Appointment" across two elements and the scrape took the
 * first half, so "Schedule An" reached a schema.org Service node.
 *
 * Requires a SPACE before the dangling word, which is what keeps "Add-On",
 * "Tune-Up" and "Walk-In" — real service names that end in a short particle
 * after a hyphen — completely untouched.
 */
const TRUNCATED_TAIL = /\s(?:a|an|the|your|our|my|and|or|for|with|to|of|in|on|at|by|from)$/i;

/**
 * A SENTENCE FRAGMENT that lost the sentence it belonged to. "and surrounding
 * areas" is the tail of "Serving Nashville and surrounding areas" — a coverage
 * line whose anchor text was harvested as a service on TWO live mirrors.
 *
 * Anchored, and only the conjunctions and prepositions that cannot begin the
 * name of something sold. Nothing a business offers starts with "and".
 */
const DANGLING_OPENER = /^(?:and|or|but|also|plus|including|includes|serving|near|around|throughout|across|within|from|to|for|with|of)\b\s+/i;

/**
 * A SUBTITLE. "Water Heaters: What Every Homeowner Should Know" — the colon is
 * how a headline joins its promise to its topic. Required to run long as well,
 * because a short "Plumbing: Repairs & Installs" is a plausible nav label.
 */
const SUBTITLE_COLON = /:\s+\S/;
const SUBTITLE_WORD_FLOOR = 5;

/**
 * A HEADLINE IS LONG. Measured against the fleet's real service lists, the
 * longest genuine name is "Tankless Water Heater Installation and Repair"
 * (7 words) and the shortest defective headline is "9 Benefits of Prompt Water
 * Heater Repairs" (7). Word count therefore CANNOT separate them and is not
 * used as a rule on its own — it convicts only past the point where no service
 * name survives. Twelve words is a sentence in anybody's language.
 */
const MAX_SERVICE_WORDS = 12;

/**
 * Second-person address — copy written TO the reader. "How to Prevent Your
 * Home's Pipes From Freezing This Winter".
 *
 * Only convicts when the label ALSO runs long, because "Your Home Comfort Plan"
 * is a real product name and short enough to be one.
 */
const READER_ADDRESS = /\b(?:you|your|yours|i|my|we|our)\b/i;
const READER_ADDRESS_WORD_FLOOR = 6;

/**
 * The reason a label is not a service name, or "" when it is one.
 *
 * Returning the REASON, not a boolean, for the same purpose as
 * place-names.implausibleReason: a dropped card must be explainable from the
 * build report instead of being re-derived from a silent absence.
 */
function articleHeadlineReason(value, { businessName = "" } = {}) {
  const raw = fold(value);
  if (!raw) return "empty";

  // Legacy harvests kept Markdown contact anchors as service labels. `fold`
  // has already removed their list bullet; convict the explicit tel:/mailto:
  // destination before whole-label text checks run.
  const contactLink = raw.match(MARKDOWN_CONTACT_LINK);
  if (contactLink) return contactLink[1].toLowerCase() === "tel" ? "contact_phone" : "contact_email";

  const words = raw.split(/\s+/).filter(Boolean);

  // THE BUSINESS'S OWN NAME IS NOT ONE OF ITS SERVICES. Buddy the Plumber
  // (Chattanooga TN) shipped a services grid whose first tile read "Buddy the
  // Plumber, LLC" — harvested from their own services-section heading, which
  // is the company name because that is how their page is written. Measured
  // live 2026-08-12; the independent scanner blocked the host for it.
  //
  // Compared on letters and digits only, so "Buddy the Plumber, LLC" matches
  // "Buddy the Plumber" and a trailing entity suffix cannot smuggle it back in.
  if (businessName) {
    const bare = (s) => String(s).toLowerCase().replace(/\b(?:llc|l\.l\.c|inc|incorporated|co|corp|corporation|ltd|company)\b/g, " ").replace(/[^a-z0-9]+/g, "");
    const a = bare(raw);
    const b = bare(businessName);
    if (a && b && (a === b || (b.length >= 8 && a === b))) return "is_the_business_name";
  }

  // Quality promises — see QUALITY_WORD above. There is deliberately NO
  // availability rule here; see the note on AVAILABILITY_CLAIM_NOT_APPLIED.
  if (words.length <= QUALITY_CLAIM_MAX_WORDS
    && QUALITY_WORD.test(words[0] || "")
    && words.slice(1).some((w) => QUALITY_NOUN.test(w))) return "quality_claim";
  if (TRAINING_LABEL.test(raw)) return "quality_claim";
  if (AUDIENCE_PROMISE.test(raw)) return "quality_claim";
  if (MARKETING_HEADING.test(raw)) return "quality_claim";
  if (EXCLAMATION.test(raw)) return "quality_claim";

  // A NUMBER IS NOT A SERVICE. Noble Plumbing (Modesto, CA) shipped a
// schema.org Service node reading "100%" — the figure off their own
  // "100% Satisfaction Guaranteed" stat block, harvested as a heading. Measured
  // live 2026-08-11; the independent scanner blocked the host for it.
  //
  // Counting words could not catch this and neither could any rule above: it is
  // one token, it is not a question, not a listicle, not navigation. What it is
  // is a MEASUREMENT — digits, optionally a percent, currency, a "+" or an
  // ordinal, and nothing a customer could ask for by name. Anything with a real
  // word in it survives, so "24/7 Emergency Service", "5 Star Plumbing" and
  // "Trenchless 2.0" are untouched.
  if (CONTACT_EMAIL.test(raw)) return "contact_email";
  if (CONTACT_PHONE.test(raw)) return "contact_phone";
  if (MEASUREMENT_ONLY.test(raw)) return "numeric_label";
  if (BARE_URL.test(raw)) return "bare_url";
  if (PRICE_OPENER.test(raw)) return "price_fragment";
  if (PERCENT_OFF.test(raw) || FRACTION_PRICED.test(raw) || COUPON_TERMS.test(raw)) return "coupon_fragment";
  if (NAVIGATION_LABEL.test(raw)) return "navigation_label";
  if (NON_SERVICE_SECTION_HEADING.test(raw)) return "navigation_label";
  if (AUDIENCE_SEGMENT.test(raw)) return "audience_segment";
  if (MEMBERSHIP_PROGRAM.test(raw)) return "membership_program";
  if (POLICY_LABEL.test(raw)) return "policy_page";
  if (CALL_TO_ACTION.test(raw)) return "call_to_action";
  if (TRUNCATED_TAIL.test(raw)) return "truncated_label";
  if (ENDS_IN_QUESTION.test(raw)) return "question_headline";
  if (LISTICLE_NOUN.test(raw)) return "listicle_headline";
  if (OPENS_WITH_COUNT.test(raw) && words.length >= LISTICLE_LENGTH_FLOOR) return "listicle_headline";
  if (DANGLING_OPENER.test(raw) || /^our\s+(?:commercial|general|contracting)\b/i.test(raw)) return "sentence_fragment";
  if (SEGMENT_HEADING_WORD.test(raw)) return "sentence_fragment";
  if (ADVICE_OPENER.test(raw)) return "advice_headline";
  if (EDITORIAL_WORD.test(raw)) return "editorial_vocabulary";
  if (GUIDE_FRAME.test(raw)) return "guide_headline";
  if (words.length >= SUBTITLE_WORD_FLOOR && SUBTITLE_COLON.test(raw)) return "subtitle_headline";
  if (words.length > MAX_SERVICE_WORDS) return "too_long_for_a_service_name";
  if (words.length >= READER_ADDRESS_WORD_FLOOR && READER_ADDRESS.test(raw)) return "addresses_the_reader";

  return "";
}

/** Could a customer ask for this by name? */
function isSellableServiceName(value, opts) {
  return articleHeadlineReason(value, opts) === "";
}

/**
 * Filter a service list — strings or `{name|title, …}` records — down to the
 * ones that may be published, and say what was dropped.
 *
 * Returns `{ kept, dropped }` where dropped carries `{ value, reason }`, so a
 * caller can log the refusal rather than silently shorten a list.
 */
function filterServiceNames(list, opts) {
  const kept = [];
  const dropped = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const value = entry && typeof entry === "object" ? (entry.name || entry.title) : entry;
    const reason = articleHeadlineReason(value, opts);
    if (reason) dropped.push({ value: fold(value), reason });
    else kept.push(entry);
  }
  return { kept, dropped };
}

module.exports = {
  articleHeadlineReason,
  isSellableServiceName,
  filterServiceNames,
  MAX_SERVICE_WORDS,
};
