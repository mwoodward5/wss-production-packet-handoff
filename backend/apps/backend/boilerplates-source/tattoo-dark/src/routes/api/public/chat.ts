import { createFileRoute } from "@tanstack/react-router";
import { createLovableAiGatewayProvider, getLovableAiGatewayResponseHeaders, getLovableAiGatewayRunId, withLovableAiGatewayRunIdHeader } from "@/lib/ai-gateway.server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { siteConfig } from "@/config/siteConfig";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const { messages } = (await request.json()) as { messages: UIMessage[] };
          if (!Array.isArray(messages)) {
            return new Response("Messages required", { status: 400, headers: corsHeaders });
          }

          const key = process.env.LOVABLE_API_KEY;
          if (!key) {
            return new Response("AI not configured", { status: 500, headers: corsHeaders });
          }

          const systemPrompt = `You are the friendly, professional booking assistant for ${siteConfig.studioName}, a tattoo studio in ${siteConfig.city}, ${siteConfig.state}.

The artist is ${siteConfig.artistName}. Specialties: ${siteConfig.specialties.join(", ")}.
Pricing: minimum ${siteConfig.pricing.minimum}, hourly ${siteConfig.pricing.hourly}, deposit ${siteConfig.pricing.deposit}.
Current status: ${siteConfig.bookingStatus}.

Your job:
1. Answer FAQs about process, pricing, aftercare, and policies using the studio's actual info (below).
2. Help prospective clients think through placement, size, style, and reference material.
3. When the client is ready to book, guide them to the booking form on this page (tell them to scroll to Booking or click Request Tattoo).
4. Never invent prices, availability, or promises. If unsure, say the artist will confirm.
5. Be warm, concise, and calm. Never pushy.

Studio policies:
${siteConfig.policies.map((p) => "- " + p).join("\n")}

Aftercare:
${siteConfig.aftercare.map((a) => "- " + a).join("\n")}

FAQs:
${siteConfig.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")}`;

          const initialRunId = getLovableAiGatewayRunId(request);
          const gateway = createLovableAiGatewayProvider(key, initialRunId);
          const result = streamText({
            model: gateway("google/gemini-2.5-flash"),
            system: systemPrompt,
            messages: await convertToModelMessages(messages),
          });

          const response = result.toUIMessageStreamResponse({
            headers: getLovableAiGatewayResponseHeaders(undefined, corsHeaders),
          });
          return withLovableAiGatewayRunIdHeader(response, gateway, corsHeaders);
        } catch (e) {
          console.error("[chat]", e);
          return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      },
    },
  },
});
