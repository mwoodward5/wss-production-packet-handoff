import { z } from "zod";

export const ContactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name").max(100),
  email: z.string().trim().email("Please enter a valid email").max(200),
  phone: z.string().trim().min(7, "Please enter a phone number").max(30),
  propertyType: z.enum(["homeowner", "landlord", "rental", "commercial", "other"]),
  service: z.enum(["painting", "drywall", "doors-windows", "flooring", "bathroom", "repairs", "maintenance", "other"]),
  urgency: z.enum(["asap", "month", "planning", "flexible"]),
  zip: z.string().trim().max(15).optional().or(z.literal("")),
  message: z.string().trim().min(5, "Please add a few details").max(2000),
  // Lead-routing metadata (auto-populated, not user-editable)
  locationSlug: z.string().trim().max(60).optional().or(z.literal("")),
  locationLabel: z.string().trim().max(120).optional().or(z.literal("")),
  source: z.string().trim().max(120).optional().or(z.literal("")),
});

export type ContactPayload = z.infer<typeof ContactSchema>;

export const SERVICE_OPTIONS: { value: ContactPayload["service"]; label: string }[] = [
  { value: "painting", label: "Painting (interior or exterior)" },
  { value: "drywall", label: "Drywall repair or finishing" },
  { value: "doors-windows", label: "Doors & windows" },
  { value: "flooring", label: "Flooring" },
  { value: "bathroom", label: "Bathroom update" },
  { value: "repairs", label: "Interior or exterior repair" },
  { value: "maintenance", label: "Routine home maintenance" },
  { value: "other", label: "Something else / not sure yet" },
];

export const URGENCY_OPTIONS: { value: ContactPayload["urgency"]; label: string; desc: string }[] = [
  { value: "asap",     label: "As soon as possible", desc: "Within the next week or two" },
  { value: "month",    label: "Within a month",      desc: "I have a target window" },
  { value: "planning", label: "Planning ahead",      desc: "1–3 months out" },
  { value: "flexible", label: "Flexible",            desc: "Whenever fits your schedule" },
];

export const PROPERTY_OPTIONS: { value: ContactPayload["propertyType"]; label: string }[] = [
  { value: "homeowner",  label: "I own & live in the home" },
  { value: "landlord",   label: "I'm a landlord / property owner" },
  { value: "rental",     label: "It's a rental property" },
  { value: "commercial", label: "Small commercial / office" },
  { value: "other",      label: "Other" },
];
