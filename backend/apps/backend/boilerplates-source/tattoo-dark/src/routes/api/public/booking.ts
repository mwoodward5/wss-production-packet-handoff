import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const HealthFlags = z
  .object({
    pregnantOrNursing: z.boolean().optional(),
    bleedingDisorder: z.boolean().optional(),
    recentSurgery: z.boolean().optional(),
    onMedication: z.boolean().optional(),
    metalOrPigmentAllergy: z.boolean().optional(),
  })
  .optional();

const BookingInput = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(40),
  over18: z.boolean(),
  placement: z.string().min(2).max(120),
  approxSize: z.string().min(1).max(60),
  style: z.string().min(1).max(80),
  colorPref: z.enum(["Black & Grey", "Full Color", "Not sure"]),
  budget: z.string().min(1).max(80),
  description: z.string().min(10).max(4000),
  referenceUrl: z.string().url().optional().or(z.literal("")),
  referenceUrls: z.array(z.string().max(500)).max(10).optional(),
  healthNotes: z.string().max(2000).optional(),
  availability: z.string().min(2).max(200),
  depositAck: z.boolean(),
  photoRelease: z.boolean().optional(),
  healthFlags: HealthFlags,
  utm: z
    .object({
      utm_source: z.string().max(100).optional(),
      utm_medium: z.string().max(100).optional(),
      utm_campaign: z.string().max(100).optional(),
      referrer: z.string().max(500).optional(),
      landing_path: z.string().max(500).optional(),
    })
    .optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Rough lead scoring: budget signal + size signal. */
function scoreLead(data: z.infer<typeof BookingInput>): "high" | "warm" | "standard" {
  const budget = data.budget.toLowerCase();
  const size = data.approxSize.toLowerCase();
  const bigBudget =
    budget.includes("2000") ||
    budget.includes("2,000") ||
    budget.includes("3000") ||
    budget.includes("3,000") ||
    budget.includes("5000") ||
    budget.includes("sleeve") ||
    budget.includes("$1500+") ||
    budget.includes("1500+");
  const bigSize =
    size.includes("large") || size.includes("sleeve") || size.includes("back") || size.includes("10");
  if (bigBudget || bigSize) return "high";
  if (data.style.toLowerCase().includes("cover")) return "warm";
  return "standard";
}

export const Route = createFileRoute("/api/public/booking")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const json = await request.json();
          const parsed = BookingInput.safeParse(json);
          if (!parsed.success) {
            return Response.json(
              { error: "Invalid submission", issues: parsed.error.issues },
              { status: 400, headers: corsHeaders },
            );
          }
          const data = parsed.data;
          if (!data.over18 || !data.depositAck) {
            return Response.json(
              { error: "You must confirm age and deposit acknowledgement." },
              { status: 400, headers: corsHeaders },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Simple rate limit: max 5 per email per hour
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { count } = await supabaseAdmin
            .from("booking_requests")
            .select("id", { count: "exact", head: true })
            .eq("email", data.email)
            .gte("created_at", oneHourAgo);
          if ((count ?? 0) >= 5) {
            return Response.json(
              { error: "Too many requests. Please try again later." },
              { status: 429, headers: corsHeaders },
            );
          }

          const score = scoreLead(data);
          const utm = data.utm ?? {};

          const { data: inserted, error } = await supabaseAdmin
            .from("booking_requests")
            .insert({
              full_name: data.fullName,
              email: data.email,
              phone: data.phone,
              placement: data.placement,
              approx_size: data.approxSize,
              style: data.style,
              color_pref: data.colorPref,
              budget: data.budget,
              description: data.description,
              reference_url: data.referenceUrl || null,
              reference_urls: data.referenceUrls ?? null,
              health_notes: data.healthNotes || null,
              health_flags: data.healthFlags ?? {},
              availability: data.availability,
              over_18: data.over18,
              deposit_ack: data.depositAck,
              photo_release: data.photoRelease ?? false,
              utm_source: utm.utm_source ?? null,
              utm_medium: utm.utm_medium ?? null,
              utm_campaign: utm.utm_campaign ?? null,
              referrer: utm.referrer ?? null,
              landing_path: utm.landing_path ?? null,
              lead_score: score,
              status: "new",
              source: "website",
            })
            .select("id, request_number, created_at")
            .single();

          if (error) {
            console.error("[booking] insert failed", error);
            return Response.json(
              { error: "Could not save request." },
              { status: 500, headers: corsHeaders },
            );
          }

          // Fire-and-forget notification (do not block user)
          try {
            const { notifyBookingRequest } = await import("@/lib/notifications.server");
            await notifyBookingRequest({
              ...data,
              requestNumber: inserted.request_number,
              leadScore: score,
            });
          } catch (notifyErr) {
            console.error("[booking] notify failed (non-blocking)", notifyErr);
          }

          return Response.json(
            { ok: true, id: inserted.id, requestNumber: inserted.request_number },
            { headers: corsHeaders },
          );
        } catch (e) {
          console.error("[booking] unexpected", e);
          return Response.json(
            { error: "Unexpected error" },
            { status: 500, headers: corsHeaders },
          );
        }
      },
    },
  },
});
