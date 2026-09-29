import { z } from "zod";

export const QuoteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  zip: z.string().trim().max(20).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  service_type: z.string().trim().max(80).optional().or(z.literal("")),
  urgency: z.string().trim().max(60).optional().or(z.literal("")),
  footprint_sqft: z.coerce.number().int().nonnegative().max(1_000_000).optional(),
  condition: z.string().trim().max(80).optional().or(z.literal("")),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  source: z.enum(["hero-leveler", "contact-form", "footer-cta", "leveler-section"]),
  // honeypot — must be empty
  company_website: z.string().max(0).optional().or(z.literal("")),
});

export type QuoteInput = z.infer<typeof QuoteSchema>;