import { createHash } from "node:crypto";

export const PREMIER_COMPOSITION_SCHEMA = "siteforge-premier-composition-v1";
export const PREMIER_COMPOSITION_AXES = Object.freeze([
  "layoutGravity",
  "heroAnatomy",
  "typographyPair",
  "palette",
  "mediaFrame",
  "sectionCadence",
  "buttonGrammar",
  "motionEffect",
  "reviewTreatment",
]);

const layout = (id, anchor, grid, flow) => ({ id, anchor, grid, flow });
const hero = (id, arrangement, layers, trustPlacement) => ({ id, arrangement, layers, trustPlacement });
const type = (id, display, body, character) => ({
  id,
  display,
  body,
  character,
  recipe: `master-glue-kitchen/recipes/typography/pair-${id}`,
});
const colors = (id, mode, background, surface, ink, muted, accent, accentAlt) => ({
  id,
  mode,
  background,
  surface,
  ink,
  muted,
  accent,
  accentAlt,
});
const media = (id, geometry, aspect, treatment) => ({ id, geometry, aspect, treatment });
const cadence = (id, rhythm, sequence) => ({ id, rhythm, sequence });
const buttons = (id, geometry, labelStyle, secondaryStyle) => ({
  id,
  geometry,
  labelStyle,
  secondaryStyle,
  iconPlacement: "trailing for directional actions; leading for utilities",
});
const motion = (id, primary, ambient) => ({
  id,
  primary,
  ambient,
  reducedMotion: "remove transforms and autoplay; retain a short opacity reveal",
});
const reviews = (id, format, arrangement, attribution) => ({ id, format, arrangement, attribution });

const ARCHETYPES = {
  landscape: [
    {
      id: "cultivated-editorial",
      label: "Cultivated Editorial",
      visualMetaphor: "A field journal laid over a precise garden plan",
      surfaceFamily: "terraced-paper",
      layoutGravity: layout("cultivated-terrace", "left and low", "5/7 asymmetric editorial grid", "full-bleed landscape bands alternate with quiet inset chapters"),
      heroAnatomy: hero("garden-window", "copy rail beside a tall garden aperture", ["eyebrow index", "headline", "local proof", "portrait media", "seasonal detail strip"], "directly below the promise"),
      typographyPair: type("humanist-warm", "Fraunces", "Source Sans 3", "organic authority with an easy reading voice"),
      palette: colors("cultivated-signal", "light", "#F7F8F2", "#FFFFFF", "#13251B", "#5D6A62", "#236B4A", "#E15B3D"),
      mediaFrame: media("botanical-aperture", "tall clipped aperture plus uncropped detail strip", "4:5 + 16:9", "natural-light grade with visible material texture"),
      sectionCadence: cadence("cultivated-breath", "spacious story, compact proof, spacious story", ["hero", "seasonal-proof-strip", "services-index", "project-story", "process-path", "review-pullquote", "service-area", "contact"]),
      buttonGrammar: buttons("stem-and-underline", "10px corners with a compact height", "sentence case, medium weight", "underlined text action with arrow icon"),
      motionEffect: motion("garden-parallax", "parallax-slow on the hero aperture", "subtle contour reveal between chapters"),
      reviewTreatment: reviews("field-note-quote", "oversized pull quote with a handwritten proof mark", "one featured voice followed by a narrow source rail", "full name, locality, and source"),
    },
    {
      id: "terrain-atlas",
      label: "Terrain Atlas",
      visualMetaphor: "A survey atlas translated into an outdoor living story",
      surfaceFamily: "contour-map",
      layoutGravity: layout("atlas-eastward", "right and panoramic", "12-column atlas with a 4-column legend", "wide map-like sections punctuated by vertical project markers"),
      heroAnatomy: hero("atlas-coordinate", "panoramic media under a compact coordinate header", ["location key", "headline", "cinematic ribbon", "service legend", "proof coordinate"], "inside the legend rail"),
      typographyPair: type("magazine", "Playfair Display", "Source Sans 3", "editorial contrast with cartographic labels"),
      palette: colors("terrain-sun", "light", "#F4F1E8", "#DDE9E0", "#17231F", "#66706A", "#D95D39", "#2457A6"),
      mediaFrame: media("panorama-coordinate", "edge-to-edge ribbon with square detail coordinates", "21:9 + 1:1", "clear daylight grade with contour-line overlay outside the image"),
      sectionCadence: cadence("atlas-waypoints", "wide, narrow, wide, indexed", ["hero", "service-legend", "project-panorama", "method-waypoints", "materials-index", "review-coordinate", "faq", "estimate"]),
      buttonGrammar: buttons("coordinate-tab", "square-ended tab with a notched icon bay", "short sentence case", "map-key link with directional icon"),
      motionEffect: motion("atlas-wipe", "reveal-wipe across panoramic media", "route line draws only as sections enter"),
      reviewTreatment: reviews("map-coordinate-proof", "quote pinned to a project coordinate", "alternating left and right annotations", "reviewer, city, project type, and source"),
    },
  ],
  "built-environment": [
    {
      id: "material-ledger",
      label: "Material Ledger",
      visualMetaphor: "A fabrication bench organized like a premium material ledger",
      surfaceFamily: "material-swatch",
      layoutGravity: layout("bench-bottom-weight", "bottom and left", "8-column workbench with a 4-column specification rail", "dense capability runs open into macro material proof"),
      heroAnatomy: hero("macro-material-bench", "low headline over a macro material field", ["trade mark", "headline", "material macro", "capability rail", "estimate action"], "as a stamped line above the action"),
      typographyPair: type("industrial-mono", "Space Grotesk", "JetBrains Mono", "confident display type with exact specification labels"),
      palette: colors("oxide-caliper", "light", "#F4F1EA", "#FFFFFF", "#171A1C", "#676B6E", "#E6502E", "#247A78"),
      mediaFrame: media("cut-sample", "hard-edged macro crop with a narrow sample tray", "3:2 + 5:1", "high-detail texture, restrained shadow, no decorative mask"),
      sectionCadence: cadence("specimen-proof", "dense specification, open proof, dense method", ["hero", "capability-rail", "material-proof", "before-after", "method-section", "review-stamp", "faq", "estimate"]),
      buttonGrammar: buttons("shop-ticket", "6px corners with a separated icon bay", "uppercase utility label", "plain bordered ticket"),
      motionEffect: motion("material-scan", "slow macro push-in", "measurement ticks reveal without looping"),
      reviewTreatment: reviews("inspection-stamp", "short quote paired with an inspection-style result stamp", "stacked evidence rows rather than cards", "reviewer, scope, date, and source"),
    },
    {
      id: "survey-section",
      label: "Survey Section",
      visualMetaphor: "An architect's section drawing brought into the jobsite",
      surfaceFamily: "diagonal-plan",
      layoutGravity: layout("section-cut-diagonal", "upper left to lower right", "split section with diagonal media crossings", "technical chapters step down the page like drawing elevations"),
      heroAnatomy: hero("elevation-cut", "headline anchored to an elevation rule with media crossing the fold", ["drawing number", "headline", "diagonal jobsite media", "scope markers", "quote action"], "on the elevation baseline"),
      typographyPair: type("condensed-news", "Oswald", "Merriweather", "compressed authority balanced by readable long-form detail"),
      palette: colors("survey-night", "dark", "#111416", "#202629", "#F8F3E8", "#AAB2B0", "#F4B942", "#4DC3D2"),
      mediaFrame: media("section-cut-frame", "diagonal full-height slice with unmasked documentary stills", "7:10 + 16:9", "cool neutral grade with fine drafting rules"),
      sectionCadence: cadence("elevation-steps", "short technical chapter followed by a large visual plate", ["hero", "scope-elevation", "project-plate", "crew-method", "timeline-section", "review-callout", "service-map", "quote"]),
      buttonGrammar: buttons("drawing-label", "2px corners with a rule above", "condensed uppercase", "text label aligned to a measurement rule"),
      motionEffect: motion("section-draw", "diagonal reveal-clip", "drafting lines trace once at entry"),
      reviewTreatment: reviews("site-callout", "project quote inside a numbered drawing callout", "one callout per visual plate", "reviewer, municipality, scope, and source"),
    },
  ],
  "home-systems": [
    {
      id: "flow-diagnostic",
      label: "Flow Diagnostic",
      visualMetaphor: "A service path visualized as a clean diagnostic schematic",
      surfaceFamily: "circuit-trace",
      layoutGravity: layout("diagnostic-left-rail", "left with a vertical service rail", "4-column rail plus 8-column outcome field", "problem and outcome sections alternate across a persistent trace"),
      heroAnatomy: hero("source-to-outcome", "problem signal flows into a real outcome image", ["availability signal", "headline", "diagnostic trace", "outcome media", "dispatch action"], "between the trace and dispatch action"),
      typographyPair: type("cyber-mono", "JetBrains Mono", "Space Grotesk", "technical labels with calm geometric body copy"),
      palette: colors("clean-circuit", "light", "#F7FAF9", "#EAF1EF", "#0D2524", "#5E716F", "#007C7A", "#E4572E"),
      mediaFrame: media("diagnostic-port", "rectilinear outcome window connected to a visible trace", "16:10", "clean documentary crop with source and outcome labels"),
      sectionCadence: cadence("diagnose-resolve", "compact signal, broad explanation, compact proof", ["hero", "issue-selector", "resolution-story", "service-spectrum", "response-process", "review-readout", "coverage", "dispatch"]),
      buttonGrammar: buttons("service-signal", "8px corners with status dot", "sentence case and semibold", "outlined utility action with familiar icon"),
      motionEffect: motion("trace-and-resolve", "route trace progresses once toward the outcome", "status indicators pulse once, then rest"),
      reviewTreatment: reviews("resolution-readout", "problem, response, and result beside a short quote", "horizontal diagnostic readout", "reviewer, neighborhood, service, and source"),
    },
    {
      id: "calibrated-service",
      label: "Calibrated Service",
      visualMetaphor: "A field instrument calibrated around speed, clarity, and trust",
      surfaceFamily: "instrument-dial",
      layoutGravity: layout("instrument-center", "center with radial utility anchors", "central 6-column story and two 3-column readout rails", "focused central chapters with peripheral service data"),
      heroAnatomy: hero("calibrated-readout", "central promise framed by a live-service readout", ["service status", "headline", "instrument media", "response metrics", "book action"], "in a quiet baseline below the readout"),
      typographyPair: type("mono-serif-hybrid", "IBM Plex Mono", "IBM Plex Serif", "measured precision with humane explanatory copy"),
      palette: colors("instrument-dark", "dark", "#111718", "#1D282A", "#F5F7F2", "#A6B4B1", "#43C59E", "#FFB000"),
      mediaFrame: media("calibration-lens", "circular detail lens crossing a rectangular field image", "1:1 + 3:2", "true-color work detail with fine instrument ticks"),
      sectionCadence: cadence("calibrate-confirm", "focused module, explanatory band, measured proof", ["hero", "response-readout", "service-detail", "work-lens", "maintenance-path", "review-gauge", "faq", "booking"]),
      buttonGrammar: buttons("instrument-key", "pill only for primary status action; square utility controls", "compact sentence case", "icon-only utility with tooltip where familiar"),
      motionEffect: motion("calibration-settle", "spring-settle on the instrument lens", "numeric readouts count once without continuous motion"),
      reviewTreatment: reviews("trust-gauge", "quote paired with response and completion measures", "one large gauge with a source ledger", "reviewer, service date, outcome, and source"),
    },
  ],
  care: [
    {
      id: "clinical-gallery",
      label: "Clinical Gallery",
      visualMetaphor: "A calm gallery where care outcomes are explained without visual noise",
      surfaceFamily: "soft-partition",
      layoutGravity: layout("gallery-centered", "center and slightly high", "10-column gallery with generous two-column margins", "quiet full-width care chapters separated by small evidence moments"),
      heroAnatomy: hero("care-portrait-field", "measured copy beside an unforced human portrait", ["care category", "headline", "care promise", "portrait media", "appointment action"], "under the care promise, before the action"),
      typographyPair: type("optical-size", "Fraunces", "Fraunces", "soft optical contrast with restrained hierarchy"),
      palette: colors("mineral-care", "light", "#FAF9F6", "#EAF5F3", "#17322D", "#60716D", "#2B7A78", "#D8664A"),
      mediaFrame: media("quiet-portrait", "uncropped portrait field with a narrow contextual inset", "5:4 + 4:5", "soft natural light and honest clinical context"),
      sectionCadence: cadence("care-breath", "long calm chapter, concise answer, long calm chapter", ["hero", "care-options", "clinician-story", "outcome-explainer", "visit-path", "review-voice", "questions", "appointment"]),
      buttonGrammar: buttons("care-soft-square", "12px corners without pill inflation", "sentence case and regular weight", "quiet text action with calendar or phone icon"),
      motionEffect: motion("care-dissolve", "short opacity and focus dissolve", "no ambient looping effects"),
      reviewTreatment: reviews("care-voice", "long-form patient voice with one highlighted sentence", "single-column reading measure with source note", "first name or approved attribution, care type, and source"),
    },
    {
      id: "guided-care-path",
      label: "Guided Care Path",
      visualMetaphor: "A clear sequence of care choices presented as chapters",
      surfaceFamily: "chapter-tabs",
      layoutGravity: layout("pathway-leading", "left and progressive", "3-column chapter index plus 9-column story", "the index advances from concern to next step"),
      heroAnatomy: hero("guided-first-step", "compact first-step copy over a wide reassuring scene", ["chapter number", "headline", "next-step copy", "wide scene", "schedule action"], "inside the first-step chapter"),
      typographyPair: type("editorial-serif", "Fraunces", "Inter", "editorial reassurance with neutral utility text"),
      palette: colors("clear-sky-care", "light", "#F7FAFC", "#FFFFFF", "#1C2E3A", "#657681", "#2C6E9B", "#E8A13A"),
      mediaFrame: media("pathway-window", "wide corner window aligned to the active chapter", "16:9", "bright contextual scene with no decorative overlay"),
      sectionCadence: cadence("chaptered-guidance", "indexed step, open story, indexed step", ["hero", "concern-index", "approach-story", "team-introduction", "visit-sequence", "review-chapter", "insurance-faq", "schedule"]),
      buttonGrammar: buttons("next-step", "8px corners with a clear arrow bay", "direct sentence case", "simple previous or call action"),
      motionEffect: motion("chapter-swap", "sticky-swap between care chapters", "active index changes without parallax"),
      reviewTreatment: reviews("journey-chapter", "review excerpt organized by before, care, and after", "three short narrative beats on one line", "approved attribution, care path, and source"),
    },
  ],
  hospitality: [
    {
      id: "table-theater",
      label: "Table Theater",
      visualMetaphor: "A cinematic table set that reveals the experience before the menu",
      surfaceFamily: "menu-fold",
      layoutGravity: layout("cinema-bottom-left", "bottom left over full-bleed media", "edge-to-edge stage with a narrow reservation rail", "immersive scenes alternate with tight menu and proof folds"),
      heroAnatomy: hero("arrival-scene", "full-bleed arrival moment with low-set copy", ["venue mark", "headline", "cinematic media", "service cue", "reserve action"], "as a compact source line beside the action"),
      typographyPair: type("hairline-plus-slab", "Bodoni Moda", "Roboto Slab", "high-fashion display balanced by grounded menu copy"),
      palette: colors("saffron-noir", "dark", "#171411", "#26201B", "#FFF8ED", "#C5B8A8", "#E84A2A", "#F3B93F"),
      mediaFrame: media("full-table-stage", "full-bleed moving scene with one unframed detail cut", "16:9 + 3:2", "warm real-light grade with legible food and place detail"),
      sectionCadence: cadence("arrival-course-finale", "immersive arrival, concise course, social pause", ["hero", "signature-menu", "room-scene", "maker-story", "visit-details", "review-toast", "events", "reservation"]),
      buttonGrammar: buttons("reservation-seal", "small circular icon seal beside a square label", "short uppercase label", "underlined availability action"),
      motionEffect: motion("table-cinema", "muted source-video-loop or cinematic light-shader on a still", "light sweep follows section cuts once"),
      reviewTreatment: reviews("review-toast", "one vivid quote paired with a photographed table detail", "quote overlays negative space rather than a card", "reviewer, occasion, date, and source"),
    },
    {
      id: "house-journal",
      label: "House Journal",
      visualMetaphor: "A host's journal mixing place, menu, and neighborhood",
      surfaceFamily: "journal-margin",
      layoutGravity: layout("journal-off-center", "right with a generous left margin", "editorial 7/5 spread", "short journal entries build toward the booking moment"),
      heroAnatomy: hero("host-letter", "host note beside a wide place portrait", ["issue label", "headline", "host note", "place portrait", "visit action"], "in the journal margin"),
      typographyPair: type("magazine", "Playfair Display", "Source Sans 3", "classic publication contrast with clear details"),
      palette: colors("tomato-sea", "light", "#FFF9F1", "#F0E8DC", "#2A1B18", "#7D6B61", "#B6312C", "#147D73"),
      mediaFrame: media("journal-spread", "wide photograph crossing a ruled editorial margin", "3:2", "documentary warmth with captions outside the image"),
      sectionCadence: cadence("journal-entries", "essay, index, photo essay, note", ["hero", "menu-index", "neighborhood-note", "photo-essay", "people-story", "review-margin", "hours-location", "booking"]),
      buttonGrammar: buttons("journal-folio", "thin rule and 4px corners", "small caps", "folio link with page arrow"),
      motionEffect: motion("journal-turn", "subtle reveal-wipe like a page edge", "captions fade in with no looping motion"),
      reviewTreatment: reviews("margin-annotation", "short review printed as an editorial margin note", "several notes distributed through the story", "reviewer, visit context, and source"),
    },
  ],
  professional: [
    {
      id: "casebook-editorial",
      label: "Casebook Editorial",
      visualMetaphor: "A lucid casebook that turns expertise into a readable argument",
      surfaceFamily: "docket-rule",
      layoutGravity: layout("casebook-left", "left with a disciplined citation margin", "8-column argument plus 4-column evidence docket", "claims are followed immediately by evidence and method"),
      heroAnatomy: hero("opening-argument", "compact thesis beside an evidence docket", ["practice index", "headline", "thesis", "evidence docket", "consult action"], "inside the first evidence entry"),
      typographyPair: type("small-caps-editorial", "Cormorant SC", "Inter", "formal display with plain operational copy"),
      palette: colors("oxblood-citation", "light", "#F6F7F4", "#FFFFFF", "#181C22", "#626973", "#8A2635", "#266A8A"),
      mediaFrame: media("evidence-portrait", "restrained portrait or document detail aligned to citations", "4:5 + 3:2", "neutral grade with captions and provenance outside the frame"),
      sectionCadence: cadence("claim-evidence-method", "claim, evidence, explanation, pause", ["hero", "expertise-index", "case-evidence", "method-essay", "team-portrait", "review-citation", "insights", "consultation"]),
      buttonGrammar: buttons("citation-action", "4px corners and a leading section number", "small caps", "text citation with arrow icon"),
      motionEffect: motion("docket-reveal", "measured reveal-wipe on evidence rows", "citation rules draw once"),
      reviewTreatment: reviews("verified-citation", "quote treated as a sourced citation with outcome context", "one featured citation plus compact references", "reviewer, matter type where approved, and source"),
    },
    {
      id: "assurance-ledger",
      label: "Assurance Ledger",
      visualMetaphor: "A transparent ledger of decisions, safeguards, and outcomes",
      surfaceFamily: "ledger-columns",
      layoutGravity: layout("ledger-right-rail", "right with a sticky assurance rail", "9-column narrative plus 3-column ledger", "narrative sections reconcile against a persistent trust ledger"),
      heroAnatomy: hero("assurance-balance", "wide promise balanced by a narrow live ledger", ["entity line", "headline", "assurance points", "portrait or proof media", "contact action"], "as the first ledger line"),
      typographyPair: type("mono-serif-hybrid", "IBM Plex Mono", "IBM Plex Serif", "auditable labels with thoughtful explanatory prose"),
      palette: colors("charcoal-gilt", "dark", "#17191E", "#252832", "#F5F1E9", "#A9ACB5", "#D4A64A", "#5BA3A5"),
      mediaFrame: media("ledger-inset", "quiet inset portrait with a full-width evidence document", "4:5 + 8:3", "low-saturation portrait and high-legibility document detail"),
      sectionCadence: cadence("reconcile-and-prove", "narrative, ledger check, narrative, ledger check", ["hero", "service-ledger", "decision-story", "safeguards", "outcome-proof", "review-entry", "faq", "contact"]),
      buttonGrammar: buttons("ledger-entry", "square 6px control aligned to ledger rows", "sentence case", "plain row action with chevron icon"),
      motionEffect: motion("ledger-reconcile", "sticky-swap in the assurance rail", "check lines appear once without celebration effects"),
      reviewTreatment: reviews("ledger-entry-proof", "review summarized as situation, guidance, and result", "ledger rows with one expanded narrative", "reviewer, engagement type, date, and source"),
    },
  ],
  software: [
    {
      id: "product-cinema",
      label: "Product Cinema",
      visualMetaphor: "A working product shown as a cinematic sequence of real states",
      surfaceFamily: "viewport-sequence",
      layoutGravity: layout("cinema-center-stage", "center with product-led depth", "full-width stage over a restrained 10-column narrative", "product states lead; explanatory copy follows in short beats"),
      heroAnatomy: hero("live-product-state", "literal product state fills the stage behind a compact promise", ["product mark", "headline", "product state", "outcome cue", "start action"], "on the product baseline, not in a floating card"),
      typographyPair: type("expressive-display", "Bricolage Grotesque", "Inter", "distinct display voice with neutral interface copy"),
      palette: colors("signal-studio", "light", "#F5F7F8", "#FFFFFF", "#111719", "#5B686D", "#0A8F8A", "#E9543D"),
      mediaFrame: media("unframed-product-state", "unframed browser or device state with a single detail zoom", "16:10 + 1:1", "literal interface state with readable data and no fake chrome"),
      sectionCadence: cadence("state-outcome-proof", "product state, outcome, short explanation", ["hero", "workflow-state", "outcome-band", "feature-deep-dive", "integration-map", "review-transcript", "security", "start"]),
      buttonGrammar: buttons("product-command", "8px corners with familiar command icon", "sentence case and medium weight", "quiet outline command"),
      motionEffect: motion("state-sequence", "pin-scrub through three real product states", "cursor and status motion stops under reduced motion"),
      reviewTreatment: reviews("workflow-transcript", "short operator transcript paired with the product state discussed", "quote and state share one horizontal band", "name, role, company when approved, and source"),
    },
    {
      id: "signal-workbench",
      label: "Signal Workbench",
      visualMetaphor: "A precise workbench where inputs become visible decisions",
      surfaceFamily: "command-strip",
      layoutGravity: layout("workbench-asymmetric", "upper right with a long utility baseline", "7/5 asymmetric workbench", "compact command strips separate larger diagnostic stories"),
      heroAnatomy: hero("input-decision-output", "three-stage product flow beside the headline", ["input signal", "headline", "decision stage", "output proof", "try action"], "inside the output proof stage"),
      typographyPair: type("cyber-mono", "JetBrains Mono", "Space Grotesk", "technical signal labels with geometric reading text"),
      palette: colors("workbench-night", "dark", "#0E1215", "#171D22", "#F5F8F6", "#95A2A8", "#58D1C9", "#FFB64D"),
      mediaFrame: media("diagnostic-canvas", "wide live canvas with a narrow event strip", "2:1 + 6:1", "crisp product data with restrained grid context"),
      sectionCadence: cadence("command-and-canvas", "compact command, wide canvas, concise explanation", ["hero", "event-strip", "decision-canvas", "automation-story", "control-surface", "review-signal", "architecture", "demo"]),
      buttonGrammar: buttons("command-key", "6px corners with keyboard-like icon bay", "compact sentence case", "text command with shortcut hint only where useful"),
      motionEffect: motion("signal-route", "events progress through the canvas once", "ambient grid remains static; status changes use opacity"),
      reviewTreatment: reviews("signal-log", "review excerpt rendered as a clean event log with a human summary", "timestamped rows opening into one quote", "name, role, result, and source"),
    },
  ],
  retail: [
    {
      id: "collection-runway",
      label: "Collection Runway",
      visualMetaphor: "A collection reveal paced like a gallery runway",
      surfaceFamily: "catalog-slice",
      layoutGravity: layout("runway-horizontal", "horizontal and center", "edge-to-edge collection rail over an 8-column story", "visual collection runs alternate with concise product context"),
      heroAnatomy: hero("collection-reveal", "hero product crosses a wide collection rail", ["collection mark", "headline", "hero product", "collection rail", "shop action"], "as a discreet proof line below the rail"),
      typographyPair: type("boutique", "Cormorant Garamond", "Inter", "luxury display contrast with quiet commerce utility"),
      palette: colors("orchid-leaf", "light", "#FCF8F6", "#FFFFFF", "#241A20", "#75646E", "#C43A70", "#4E8B57"),
      mediaFrame: media("catalog-slice-frame", "unframed hero product with narrow vertical collection slices", "4:5 + 2:5", "true product color with clean but visible context"),
      sectionCadence: cadence("reveal-detail-context", "visual reveal, detail, context, pause", ["hero", "collection-rail", "material-detail", "maker-note", "use-scene", "review-label", "shipping-care", "shop"]),
      buttonGrammar: buttons("collection-label", "thin 6px frame with separate bag icon", "short sentence case", "underlined collection link"),
      motionEffect: motion("runway-drift", "slow horizontal collection drift controlled by scroll", "products remain static when motion is reduced"),
      reviewTreatment: reviews("product-label-quote", "review printed like a museum label beside the product", "one label per featured product scene", "reviewer, product, variant, and source"),
    },
    {
      id: "maker-lookbook",
      label: "Maker Lookbook",
      visualMetaphor: "A studio contact sheet that reveals process and finished object together",
      surfaceFamily: "studio-contact-sheet",
      layoutGravity: layout("lookbook-offset", "left with an offset image field", "5-column narrative plus 7-column contact sheet", "process details interrupt polished object spreads"),
      heroAnatomy: hero("object-and-hand", "finished object paired with one process close-up", ["maker signature", "headline", "finished object", "process detail", "browse action"], "between the two media states"),
      typographyPair: type("optical-size", "Fraunces", "Fraunces", "expressive optical sizing with restrained labels"),
      palette: colors("clay-cobalt", "light", "#F7F5EE", "#E9EEF2", "#1D2428", "#657079", "#D65A31", "#2F6FB2"),
      mediaFrame: media("contact-sheet-frame", "mixed-size contact sheet with no repeated equal cards", "3:2 + 1:1 + 4:5", "studio daylight with process texture retained"),
      sectionCadence: cadence("object-process-story", "polished object, process detail, maker story", ["hero", "new-work", "process-contact-sheet", "materials-story", "collection-index", "review-tag", "care-guide", "browse"]),
      buttonGrammar: buttons("maker-tag", "8px tag shape with a punched icon circle", "sentence case", "plain text browse action"),
      motionEffect: motion("lookbook-reveal", "staggered reveal-clip across unequal media", "contact sheet appears at once under reduced motion"),
      reviewTreatment: reviews("object-tag-proof", "short review on a product tag tied to a real object", "tags appear inline with the lookbook", "reviewer, item, purchase context, and source"),
    },
  ],
  mobility: [
    {
      id: "route-cinema",
      label: "Route Cinema",
      visualMetaphor: "A journey line moving through real service moments",
      surfaceFamily: "route-line",
      layoutGravity: layout("route-diagonal", "forward and diagonal", "diagonal media route over a stable 12-column base", "journey scenes advance between compact service checkpoints"),
      heroAnatomy: hero("departure-to-arrival", "departure scene and arrival promise connected by a route line", ["service signal", "headline", "departure media", "route proof", "book action"], "at the arrival checkpoint"),
      typographyPair: type("wide-poster", "Big Shoulders Display", "Inter", "wide motion-led display with clear operational text"),
      palette: colors("race-signal", "dark", "#111417", "#21262B", "#F7F7F2", "#A5ADB2", "#E53935", "#42B9D1"),
      mediaFrame: media("windshield-panorama", "wide scene with a diagonal detail window", "21:9 + 3:2", "sharp real vehicle or route detail with controlled reflections"),
      sectionCadence: cadence("checkpoint-journey", "cinematic scene, checkpoint, service detail", ["hero", "route-options", "vehicle-scene", "service-standard", "booking-path", "review-milepost", "coverage", "book"]),
      buttonGrammar: buttons("route-marker", "angled 6px end cap with directional icon", "condensed sentence case", "outlined route action"),
      motionEffect: motion("route-progress", "route line advances with scroll progress", "media uses a restrained pan with a static fallback"),
      reviewTreatment: reviews("milepost-quote", "quote anchored to a route milestone", "milestones run horizontally without card shells", "reviewer, route or service, date, and source"),
    },
    {
      id: "precision-bay",
      label: "Precision Bay",
      visualMetaphor: "A clean service bay exposing precision work and accountability",
      surfaceFamily: "machined-panel",
      layoutGravity: layout("bay-split", "right and low", "6/6 split with a narrow inspection baseline", "work detail and plain-language explanation remain paired"),
      heroAnatomy: hero("machine-and-measure", "macro work detail beside a measured service promise", ["bay number", "headline", "macro work", "inspection measure", "schedule action"], "on the inspection baseline"),
      typographyPair: type("condensed-news", "Oswald", "Merriweather", "mechanical display rhythm with readable service explanation"),
      palette: colors("alloy-vermilion", "light", "#F3F5F6", "#FFFFFF", "#15191D", "#626A70", "#D94B32", "#197E74"),
      mediaFrame: media("inspection-bay", "rectangular work bay plus circular inspection detail", "3:2 + 1:1", "neutral shop light with accurate surface detail"),
      sectionCadence: cadence("inspect-explain-confirm", "inspection plate, explanation, confirmation", ["hero", "service-bays", "inspection-detail", "parts-method", "timeline", "review-ticket", "faq", "schedule"]),
      buttonGrammar: buttons("bay-control", "4px corners with a distinct tool icon bay", "compact uppercase", "plain bordered schedule action"),
      motionEffect: motion("inspection-focus", "focus shift from full bay to detail lens", "measurement marks appear without continuous animation"),
      reviewTreatment: reviews("service-ticket-proof", "review condensed into concern, work, and confirmation", "ticket rows with one expanded quote", "reviewer, service item, date, and source"),
    },
  ],
  community: [
    {
      id: "civic-poster",
      label: "Civic Poster",
      visualMetaphor: "A public poster system built for participation and shared momentum",
      surfaceFamily: "poster-stack",
      layoutGravity: layout("poster-centered", "center with energetic edge notes", "bold 8-column poster field and two annotation columns", "large calls to participate alternate with compact impact evidence"),
      heroAnatomy: hero("public-call", "literal offer or mission fills a poster field over real community media", ["organization mark", "headline", "community media", "impact line", "participate action"], "as a visible impact line"),
      typographyPair: type("brutal-display", "Archivo Black", "IBM Plex Sans", "public-facing display energy with sturdy body copy"),
      palette: colors("civic-print", "light", "#F6F2E8", "#FFFFFF", "#1E2229", "#6E6B64", "#2457A6", "#E8A62A"),
      mediaFrame: media("poster-photo-field", "full poster field with one offset documentary photograph", "4:5 + 3:2", "honest event or people imagery with print-like color separation"),
      sectionCadence: cadence("call-impact-story", "large call, compact impact, human story", ["hero", "ways-to-join", "impact-numbers", "community-story", "program-index", "review-placard", "calendar", "participate"]),
      buttonGrammar: buttons("poster-stamp", "square 2px frame with a bold icon stamp", "short uppercase", "plain text date or location action"),
      motionEffect: motion("poster-paste", "quick reveal-clip with a settled finish", "edge notes appear once and stay fixed"),
      reviewTreatment: reviews("community-placard", "short participant voice on a public placard", "placards interrupt the page rhythm instead of forming a grid", "name, relationship, program, and source"),
    },
    {
      id: "story-assembly",
      label: "Story Assembly",
      visualMetaphor: "Individual stories assembled into one visible shared outcome",
      surfaceFamily: "chapter-bands",
      layoutGravity: layout("assembly-left", "left with full-width chapter bands", "4-column story index plus 8-column media field", "individual voices accumulate into a broad outcome chapter"),
      heroAnatomy: hero("many-to-one", "several real voices lead into one shared promise", ["chapter key", "headline", "voice montage", "shared outcome", "join action"], "inside the shared outcome band"),
      typographyPair: type("humanist-warm", "Fraunces", "Source Sans 3", "warm editorial display with accessible reading text"),
      palette: colors("assembly-garden", "dark", "#17211D", "#23312A", "#F6F3E8", "#A7B4AC", "#E15B3D", "#55A6B8"),
      mediaFrame: media("voice-montage", "unequal documentary strips converging into one wide scene", "4:5 + 16:9", "consistent natural grade without stock-style blur"),
      sectionCadence: cadence("voice-build-outcome", "single voice, paired voices, collective outcome", ["hero", "story-one", "program-path", "story-pair", "impact-outcome", "review-chorus", "resources", "join"]),
      buttonGrammar: buttons("chapter-action", "8px corners with a chapter numeral", "sentence case", "simple next-chapter action"),
      motionEffect: motion("assembly-reveal", "media strips reveal in sequence then settle as one scene", "all strips display immediately under reduced motion"),
      reviewTreatment: reviews("voice-chorus", "three short voices edited into a readable chorus", "staggered text lines without containers", "name, relationship, and source for each voice"),
    },
  ],
  default: [
    {
      id: "local-signature",
      label: "Local Signature",
      visualMetaphor: "A confident storefront window organized around one unmistakable offer",
      surfaceFamily: "window-sign",
      layoutGravity: layout("signature-left", "left with a broad media horizon", "5/7 split opening into full-width proof", "direct offer, visual proof, service detail, human trust"),
      heroAnatomy: hero("offer-and-proof", "literal offer beside a real business scene", ["wordmark", "headline", "offer detail", "business media", "contact action"], "between offer detail and action"),
      typographyPair: type("variable-width", "Recursive", "Inter", "adaptable display width with neutral utility text"),
      palette: colors("local-signal", "light", "#F6F7F5", "#FFFFFF", "#18201E", "#65706C", "#C44D36", "#287D78"),
      mediaFrame: media("storefront-horizon", "wide real scene with one square detail", "16:9 + 1:1", "literal business and work imagery with accurate color"),
      sectionCadence: cadence("offer-proof-detail", "direct offer, proof, detail, personal note", ["hero", "proof-strip", "services", "work-story", "process", "review-feature", "location", "contact"]),
      buttonGrammar: buttons("signature-action", "8px corners with a clear icon", "sentence case", "underlined phone or directions action"),
      motionEffect: motion("signature-reveal", "short reveal-wipe on the real media", "one restrained accent line movement"),
      reviewTreatment: reviews("featured-local-voice", "one substantial local review with useful context", "featured quote followed by a plain source list", "reviewer, locality, service, and source"),
    },
    {
      id: "founder-broadsheet",
      label: "Founder Broadsheet",
      visualMetaphor: "A modern broadsheet led by the owner, the work, and clear evidence",
      surfaceFamily: "broadsheet-columns",
      layoutGravity: layout("broadsheet-right", "right with a narrow contents column", "editorial 4/8 spread", "owner note opens into work evidence and practical next steps"),
      heroAnatomy: hero("front-page-story", "owner statement and real work image share the front page", ["edition line", "headline", "owner statement", "work image", "next action"], "in the contents column"),
      typographyPair: type("magazine", "Playfair Display", "Source Sans 3", "publication authority with straightforward details"),
      palette: colors("broadsheet-ink", "light", "#F5F2EA", "#FFFFFF", "#1B1B1D", "#6C6964", "#B33A32", "#2D6C8A"),
      mediaFrame: media("front-page-plate", "large documentary plate crossing editorial columns", "3:2", "neutral documentary grade with a factual caption"),
      sectionCadence: cadence("headline-story-evidence", "headline, story, evidence plate, service index", ["hero", "owner-letter", "work-plate", "services-index", "method", "review-column", "questions", "contact"]),
      buttonGrammar: buttons("broadsheet-folio", "4px corners aligned to column rules", "small caps", "folio-style text link"),
      motionEffect: motion("broadsheet-unfold", "measured vertical reveal across columns", "images and text appear together under reduced motion"),
      reviewTreatment: reviews("letters-column", "review presented as a short letter to the business", "single letters column with visible source lines", "reviewer, locality, context, and source"),
    },
  ],
};

// Local-service batches must not collapse into one landscape template. Reuse
// proven composition systems as distinct landscape directions; business truth
// and source media still drive all public copy and imagery.
ARCHETYPES.landscape.push(
  clone(ARCHETYPES["built-environment"][0]),
  clone(ARCHETYPES["built-environment"][1]),
  clone(ARCHETYPES.retail[1]),
  clone(ARCHETYPES.default[0]),
);

const ARCHETYPE_BY_ID = new Map();
for (const archetype of Object.values(ARCHETYPES).flat()) {
  if (!ARCHETYPE_BY_ID.has(archetype.id)) ARCHETYPE_BY_ID.set(archetype.id, archetype);
}

const EDITIONS = [
  { id: "gallery", density: "spacious", cropBias: "wide", proofPosition: "after the first story", tempo: "slow" },
  { id: "journal", density: "editorial", cropBias: "mixed", proofPosition: "inside the middle chapter", tempo: "measured" },
  { id: "showcase", density: "compact", cropBias: "detail-led", proofPosition: "before the final action", tempo: "brisk" },
];

const VERTICAL_RULES = [
  ["landscape", /\b(landscap\w*|lawn|garden\w*|arbor\w*|tree service|nursery|outdoor living|pool service)\b/],
  ["built-environment", /\b(built environment|roof\w*|construct\w*|concrete|excavat\w*|pav\w*|fenc\w*|floor\w*|remodel\w*|builder|masonry|hardscap\w*)\b/],
  ["home-systems", /\b(home systems|plumb\w*|hvac|electric\w*|solar|heating|cooling|septic|appliance|locksmith)\b/],
  ["care", /\b(dental|dentist|clinic\w*|health\w*|medical|therapy|therapist|chiropract\w*|care center|veterinar\w*)\b/],
  ["hospitality", /\b(restaurant|cafe|coffee|bar|hotel|cater\w*|bakery|beverage|hospitality|venue)\b/],
  ["software", /\b(software|saas|technology|tech platform|cyber\w*|\bai\b|b2b|web app|mobile app)\b/],
  // Auto care (detailing, ceramic, "auto spa", car wash) is automotive, not a
  // wellness "spa" — keep it ahead of retail so the "spa" token below can't
  // pull a detailer into a salon/beauty template.
  ["mobility", /\b(automotive|auto service|auto detail\w*|car detail\w*|mobile detail\w*|detailing|auto spa|car spa|car wash|ceramic coat\w*|paint correction|transport\w*|limousine|trucking|logistics|dealership|vehicle|fleet)\b/],
  ["retail", /\b(retail|ecommerce|e commerce|boutique|salon|spa|fashion|beauty|consumer product|shop)\b/],
  ["community", /\b(education|school|academy|nonprofit|non profit|church|community|arts|museum|foundation)\b/],
  ["professional", /\b(law|legal|attorney|account\w*|finance|financial|insurance|consult\w*|real estate|advis\w*|agency)\b/],
];

/**
 * Normalize a free-form business category into a composition vertical.
 */
export function normalizeVertical(value) {
  const category = normalizeText(value);
  for (const [vertical, matcher] of VERTICAL_RULES) {
    if (matcher.test(category)) return vertical;
  }
  return "default";
}

/**
 * Create a deterministic, renderer-ready composition plan.
 * Accepts either (vertical, businessSeed) or a packet-like object.
 */
export function planPremierComposition(input = {}, businessSeed) {
  const request = resolveRequest(input, businessSeed);
  const vertical = normalizeVertical(request.vertical);
  const seedKey = normalizeSeed(request.seed);
  const compositionSeed = hash32(`${PREMIER_COMPOSITION_SCHEMA}|${vertical}|${seedKey}`);
  const pool = ARCHETYPES[vertical] ?? ARCHETYPES.default;
  const compositionSlot = normalizeCompositionSlot(request.compositionSlot);
  const selectedIndex = compositionSlot == null
    ? hash32(`${compositionSeed}|archetype`) % pool.length
    : compositionSlot % pool.length;
  const editionIndex = compositionSlot == null
    ? hash32(`${compositionSeed}|edition`) % EDITIONS.length
    : Math.floor(compositionSlot / pool.length) % EDITIONS.length;
  const requestedCompositionBase = normalizeCompositionBase(request.compositionBase);
  const selected = requestedCompositionBase == null
    ? pool[selectedIndex]
    : ARCHETYPE_BY_ID.get(requestedCompositionBase);
  if (!selected) {
    throw new RangeError(`Unknown composition base: ${request.compositionBase}`);
  }
  const edition = EDITIONS[editionIndex];

  const composition = {
    schema: PREMIER_COMPOSITION_SCHEMA,
    vertical,
    compositionSeed,
    compositionSlot,
    archetype: {
      id: selected.id,
      label: selected.label,
      visualMetaphor: selected.visualMetaphor,
      surfaceFamily: selected.surfaceFamily,
      edition: edition.id,
    },
    layoutGravity: { ...clone(selected.layoutGravity), density: edition.density },
    heroAnatomy: clone(selected.heroAnatomy),
    typographyPair: clone(selected.typographyPair),
    palette: clone(selected.palette),
    mediaFrame: { ...clone(selected.mediaFrame), cropBias: edition.cropBias },
    sectionCadence: { ...clone(selected.sectionCadence), proofPosition: edition.proofPosition },
    buttonGrammar: clone(selected.buttonGrammar),
    motionEffect: { ...clone(selected.motionEffect), tempo: edition.tempo },
    reviewTreatment: { ...clone(selected.reviewTreatment), placement: edition.proofPosition },
  };
  if (requestedCompositionBase != null) composition.compositionBase = selected.id;

  composition.compositionFingerprint = compositionFingerprint(composition);
  return composition;
}

/**
 * Fingerprint only canonical planner fields, independent of object key order.
 */
export function compositionFingerprint(composition) {
  if (!composition || typeof composition !== "object" || Array.isArray(composition)) {
    throw new TypeError("composition must be an object");
  }

  const canonical = {
    schema: composition.schema ?? PREMIER_COMPOSITION_SCHEMA,
    vertical: composition.vertical ?? "default",
    compositionSeed: composition.compositionSeed ?? null,
    compositionSlot: composition.compositionSlot ?? null,
    archetype: composition.archetype ?? null,
  };
  for (const axis of PREMIER_COMPOSITION_AXES) canonical[axis] = composition[axis] ?? null;

  const digest = createHash("sha256").update(stableStringify(canonical)).digest("hex").slice(0, 24);
  return `pc1-${digest}`;
}

function resolveRequest(input, businessSeed) {
  if (typeof input === "string") return { vertical: input, seed: businessSeed ?? "site" };
  if (input == null) return { vertical: "default", seed: businessSeed ?? "site" };
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("composition input must be a vertical string or an object");
  }

  const business = input.business && typeof input.business === "object" ? input.business : {};
  return {
    vertical: input.vertical ?? input.trade ?? input.category ?? business.category ?? "default",
    seed: input.businessSeed ?? businessSeed ?? input.seed ?? input.slug ?? business.slug ?? business.name ?? input.name ?? "site",
    compositionSlot: input.compositionSlot ?? input.composition_slot ?? input.design_variant ?? business.composition_slot ?? null,
    compositionBase: input.compositionBase ?? input.composition_base ?? business.compositionBase ?? business.composition_base ?? null,
  };
}

function normalizeCompositionBase(value) {
  if (value === "" || value == null) return null;
  const id = String(value).trim().toLowerCase();
  return id || null;
}

function normalizeCompositionSlot(value) {
  if (value === "" || value == null) return null;
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 0 ? slot : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSeed(value) {
  return normalizeText(value).replace(/\s+/g, "-") || "site";
}

function hash32(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export default planPremierComposition;
