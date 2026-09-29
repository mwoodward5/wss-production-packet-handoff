import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

const submissionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(255),
  service: z.string().trim().min(2).max(100),
  message: z.string().trim().min(5).max(2000),
  // Honeypot — must stay empty for real humans.
  company: z.string().max(0).optional().or(z.literal("")),
});

export type ContactSubmissionInput = z.infer<typeof submissionSchema>;

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MINUTES = 10;

async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`elc:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const submitContactForm = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submissionSchema.parse(data))
  .handler(async ({ data }) => {
    // Silently accept honeypot hits without storing them.
    if (data.company) return { ok: true as const, id: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rawIp =
      getRequestHeader("cf-connecting-ip") ??
      getRequestIP({ xForwardedFor: true }) ??
      "unknown";
    const ipHash = await hashIp(rawIp);

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
    const { count, error: countError } = await supabaseAdmin
      .from("contact_submissions")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    if (countError) throw new Error("We couldn't reach our servers. Please try again.");
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      throw new Error(
        `Too many requests. Please wait a few minutes or call us directly.`,
      );
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("contact_submissions")
      .insert({
        name: data.name,
        phone: data.phone,
        email: data.email,
        service: data.service,
        message: data.message,
        ip_hash: ipHash,
        status: "new",
      })
      .select("id")
      .single();

    if (error || !inserted) {
      throw new Error("We couldn't save your request. Please try again.");
    }

    return { ok: true as const, id: inserted.id };
  });
