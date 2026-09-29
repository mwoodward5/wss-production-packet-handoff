/**
 * WSS-AI vertical presets. Swap siteConfig.ts default export for one of these
 * (or blend fields) to retarget the template at another appointment vertical.
 * All landing components read from siteConfig, so no component edits are needed.
 */
import type { SiteConfig } from "./siteConfig";

export const tattooPreset: Partial<SiteConfig> = {
  artistName: "Studio Artist",
  studioName: "STUDIO NAME",
  tagline: "Custom blackwork, fine-line & illustrative tattoos built around your story.",
  specialties: ["Blackwork", "Fine Line", "Botanical", "Ornamental", "Illustrative"],
  pricing: { deposit: "$150", minimum: "$250", hourly: "$220/hr", priceRange: "$$" },
};

export const hairSalonPreset: Partial<SiteConfig> = {
  artistName: "Elena Vance",
  studioName: "MAISON VANCE",
  tagline: "Precision cuts, lived-in color, and long-lasting balayage.",
  specialties: ["Balayage", "Lived-in Color", "Precision Cuts", "Extensions", "Bridal"],
  pricing: { deposit: "$75", minimum: "$120", hourly: "$180/hr", priceRange: "$$" },
  bookingStatus: "Now booking through the season",
  bio: "Elena focuses on intentional, low-maintenance color and cuts that grow out beautifully.",
};

export const spaPreset: Partial<SiteConfig> = {
  artistName: "Amaya Rios",
  studioName: "NORA RITUAL",
  tagline: "Facials, body treatments, and rituals rooted in slow, sensory care.",
  specialties: ["Signature Facial", "Deep Tissue", "Body Ritual", "Lymphatic", "Bridal Prep"],
  pricing: { deposit: "$50", minimum: "$140", hourly: "$160/hr", priceRange: "$$" },
  bookingStatus: "Sunday & Monday availability",
  bio: "Amaya designs personalized treatments that address your skin and nervous system together.",
};

export const barberPreset: Partial<SiteConfig> = {
  artistName: "Marco Bell",
  studioName: "BELL & CO.",
  tagline: "Classic barbering with modern edges — cuts, fades, and shaves.",
  specialties: ["Skin Fade", "Scissor Cut", "Beard Design", "Hot Towel Shave", "Kid's Cut"],
  pricing: { deposit: "$25", minimum: "$45", hourly: "$85/hr", priceRange: "$" },
  bookingStatus: "Walk-ins Tuesday–Saturday",
  bio: "Marco has been shaping heads and beards for 12 years — traditional craft, no frills.",
};

export const tutorPreset: Partial<SiteConfig> = {
  artistName: "Dr. Priya Shah",
  studioName: "SHAH TUTORING",
  tagline: "1:1 SAT, ACT, and college-app coaching that earns real score gains.",
  specialties: ["SAT Math", "SAT Verbal", "ACT", "College Essay", "Interview Prep"],
  pricing: { deposit: "$100", minimum: "$150/session", hourly: "$180/hr", priceRange: "$$" },
  bookingStatus: "Fall cohort — limited seats",
  bio: "Priya combines 10 years of test-prep expertise with data-driven study plans.",
};

export const presets = {
  tattoo: tattooPreset,
  hair: hairSalonPreset,
  spa: spaPreset,
  barber: barberPreset,
  tutor: tutorPreset,
} as const;

export type PresetKey = keyof typeof presets;
