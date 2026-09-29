import { z } from "zod";

export const bookingSchema = z.object({
  fullName: z.string().min(2, "Full name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(7, "Phone required"),
  over18: z.boolean().refine((v) => v, "Must be of legal age"),
  placement: z.string().min(2, "Where on the body?"),
  approxSize: z.string().min(1, "Approximate size"),
  style: z.string().min(1, "Preferred style"),
  colorPref: z.enum(["Black & Grey", "Full Color", "Not sure"]),
  budget: z.string().min(1, "Budget range"),
  description: z.string().min(10, "Describe your idea"),
  referenceUrl: z.string().url().optional().or(z.literal("")),
  healthNotes: z.string().optional(),
  availability: z.string().min(2, "General availability"),
  depositAck: z.boolean().refine((v) => v, "Acknowledge deposit policy"),
  photoRelease: z.boolean().optional(),
  // Structured health intake flags — none required, all self-attested.
  healthFlags: z
    .object({
      pregnantOrNursing: z.boolean().optional(),
      bleedingDisorder: z.boolean().optional(),
      recentSurgery: z.boolean().optional(),
      onMedication: z.boolean().optional(),
      metalOrPigmentAllergy: z.boolean().optional(),
    })
    .optional(),
});

export type BookingValues = z.infer<typeof bookingSchema>;
