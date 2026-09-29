// Rami's international seminar trail — the anchors he named:
// Slovenia · Romania · Spain · Mexico. Coordinates are map-local (0..100)
// on a stylized parchment atlas, NOT geographic lat/lon.

export interface SeminarStop {
  code: "SI" | "RO" | "ES" | "MX";
  name: string;
  /** map-local x/y in 0..100 */
  x: number;
  y: number;
  arts: string[];
  note: string;
}

export const seminarJourney: SeminarStop[] = [
  {
    code: "MX",
    name: "Mexico",
    x: 16, y: 60,
    arts: ["Blade arts", "Sambo", "Combat SAMBO", "Western Piper"],
    note: "Home base in Cabo. Immersions, private and small-group work.",
  },
  {
    code: "ES",
    name: "Spain",
    x: 52, y: 44,
    arts: ["La Verdadera Destreza", "Blade arts", "Sambo"],
    note: "Seminar anchor. Destreza territory, historically.",
  },
  {
    code: "SI",
    name: "Slovenia",
    x: 60, y: 40,
    arts: ["Blade arts", "Sambo", "Combat SAMBO"],
    note: "Recurring host schools in the region.",
  },
  {
    code: "RO",
    name: "Romania",
    x: 66, y: 44,
    arts: ["Blade arts", "Combat SAMBO", "Pekiti-Tirsia"],
    note: "Seminar work with regional gyms.",
  },
];
