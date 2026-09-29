// The Edge Progression — single source of truth.
// Copy authored verbatim from Rami's brief. Do not soften, do not
// overclaim: no ranks, no records, no dates, no lodging, no itinerary,
// no guaranteed outcomes.

export type EdgeCategory =
  | "foundations"
  | "sambo"
  | "combat-sambo"
  | "blade"
  | "lineage"
  | "seminars"
  | "cabo"
  | "online"
  | "proof";

export type EdgeStatus = "confirmed" | "media-backed" | "pending";

export type EdgeMedia =
  | { kind: "video"; mediaId: string; seal: string }
  | { kind: "image"; mediaId: string; seal: string }
  | { kind: "pending"; seal: string; note: string };

export interface EdgeStage {
  n: string;
  stage: string;
  title: string;
  category: EdgeCategory;
  audience: string;
  focus: string;
  status: EdgeStatus;
  cta: { label: string; href: "/training" | "/arts" | "/seminars" | "/media" | "/contact" };
  media: EdgeMedia;
  /** optional footnote appearing under the focus paragraph */
  note?: string;
}

export interface EdgeTab {
  id: "all" | EdgeCategory;
  label: string;
  /** categories included by this tab (all=[] means unfiltered) */
  match: EdgeCategory[];
}

export const edgeTabs: EdgeTab[] = [
  { id: "all",          label: "All",             match: [] },
  { id: "foundations",  label: "Foundations",     match: ["foundations"] },
  { id: "sambo",        label: "Sambo",           match: ["sambo"] },
  { id: "combat-sambo", label: "Combat SAMBO",    match: ["combat-sambo"] },
  { id: "blade",        label: "Blade / Knife",   match: ["blade", "lineage"] },
  { id: "seminars",     label: "Seminars",        match: ["seminars"] },
  { id: "cabo",         label: "Cabo Training",   match: ["cabo"] },
  { id: "online",       label: "Online Coaching", match: ["online"] },
  { id: "proof",        label: "Proof Media",     match: ["proof"] },
];

export const edgeStages: EdgeStage[] = [
  {
    n: "01",
    stage: "Entry Point",
    title: "Controlled Fundamentals",
    category: "foundations",
    audience: "Beginners, returning martial artists, private clients.",
    focus:
      "Stance, posture, base movement, distance, safe partner contact, and controlled progression.",
    status: "pending",
    cta: { label: "Explore training", href: "/training" },
    media: { kind: "video", mediaId: "blade-05", seal: "基" },
  },
  {
    n: "02",
    stage: "Grappling Engine",
    title: "Sambo Base",
    category: "sambo",
    audience: "Novice grapplers, advanced martial artists, coaches.",
    focus:
      "Grips, entries, off-balancing, throws, trips, transitions, and live resistance.",
    status: "confirmed",
    cta: { label: "Study Sambo", href: "/arts" },
    media: { kind: "video", mediaId: "sambo-07", seal: "組" },
  },
  {
    n: "03",
    stage: "Pressure Bridge",
    title: "Combat SAMBO Decision-Making",
    category: "combat-sambo",
    audience: "Fighters, coaches, serious students.",
    focus:
      "Clinch pressure, striking transitions, takedown decisions, timing, and scenario control.",
    status: "confirmed",
    cta: { label: "Request seminar", href: "/seminars" },
    media: { kind: "video", mediaId: "sambo-09", seal: "圧" },
  },
  {
    n: "04",
    stage: "Edges and Angles",
    title: "Blade Arts",
    category: "blade",
    audience: "Serious students, instructors, private groups.",
    focus:
      "Distance, angle, access, control, footwork, disengagement, and ethical restraint.",
    status: "media-backed",
    cta: { label: "Watch proof", href: "/media" },
    media: { kind: "video", mediaId: "blade-04", seal: "刃" },
  },
  {
    n: "05",
    stage: "Lineage Map",
    title: "Historical Blade Lineages",
    category: "lineage",
    audience: "Advanced martial artists, instructors, martial arts researchers.",
    focus:
      "A refined reference set of Japanese, Filipino, Spanish, Italian, and HEMA-informed blade traditions studied within the practice.",
    note:
      "Traditions referenced · pending Rami confirmation · Kenjutsu · Daito Ryu · Budo Taijutsu (Ishizuka lineage) · Sayoc / Sayok Kali · Pekiti-Tirsia Kali · Kali / Kalis Ilustrisimo · Medusa Evo · Western Piper Method · HEMA · La Verdadera Destreza · Fiore. Spellings and authorization language to be confirmed.",
    status: "pending",
    cta: { label: "Explore lineages", href: "/arts" },
    media: { kind: "pending", seal: "系", note: "Lineage map · pending confirmation" },
  },
  {
    n: "06",
    stage: "Intensive Delivery",
    title: "Seminar Format",
    category: "seminars",
    audience: "Gyms, private groups, coaches, serious students.",
    focus:
      "Condensed high-intensity instruction organized around useful skill blocks.",
    status: "confirmed",
    cta: { label: "Host a seminar", href: "/seminars" },
    media: { kind: "video", mediaId: "seminar-legacy", seal: "会" },
  },
  {
    n: "07",
    stage: "Fieldwork",
    title: "International Seminar Trail",
    category: "seminars",
    audience: "Host schools, seminar students, advanced practitioners.",
    focus:
      "Seminar and travel anchors referenced by Rami: Slovenia, Romania, Spain, and Mexico.",
    note: "Field notes · SI · RO · ES · MX · seminar map under review.",
    status: "pending",
    cta: { label: "Confirm the map", href: "/contact" },
    media: { kind: "pending", seal: "旅", note: "Seminar map · under review" },
  },
  {
    n: "08",
    stage: "Immersion",
    title: "Cabo Training",
    category: "cabo",
    audience: "Private clients, small groups, travelers seeking focused training.",
    focus:
      "In-person training in Cabo with serious attention and personal instruction.",
    status: "confirmed",
    cta: { label: "Train in Cabo", href: "/training" },
    media: { kind: "image", mediaId: "cabo-still", seal: "海" },
  },
  {
    n: "09",
    stage: "Remote Continuity",
    title: "Online Semi-Private Coaching",
    category: "online",
    audience: "Remote students, returning seminar students, private clients.",
    focus:
      "Video review, training direction, structure, and continuity between live sessions.",
    status: "confirmed",
    cta: { label: "Ask about online coaching", href: "/contact" },
    media: { kind: "pending", seal: "遠", note: "Media pending" },
  },
  {
    n: "10",
    stage: "Receipts",
    title: "Proof Media",
    category: "proof",
    audience: "Prospects, hosts, advanced martial artists.",
    focus:
      "Remastered clips, posters, seminar footage, Sambo images, blade work fragments, and future testimonials.",
    status: "media-backed",
    cta: { label: "View media", href: "/media" },
    media: { kind: "image", mediaId: "sambo-medal", seal: "証" },
  },
];
