/**
 * ┌── MIRROR:TEMPLATE-CODE — UNIVERSAL AI CONCIERGE, one endpoint, whole fleet
 * │ WHAT THIS IS: a streaming chat endpoint backed by the Lovable AI gateway.
 * │ WHAT THE MIRRORING ENGINE HAS TO DO WITH IT: nothing. Zero. This file is
 * │ byte-identical in every mirrored client. The personality and every fact
 * │ come from `buildSystemPrompt()`, which reads src/trust.config.ts and
 * │ src/client.config.ts — the only two files a mirror ever rewrites.
 * │
 * │ KEY: process.env.LOVABLE_API_KEY, held server-side. One key covers every
 * │ mirrored site, so a new client costs nothing extra to switch on.
 * │ MODEL: google/gemini-3.6-flash (fast + cheap; good enough to reason on the
 * │ fly about a homeowner's plumbing problem).
 * └──────────────────────────────────────────────────────────────────────────
 */
import { createFileRoute } from "@tanstack/react-router";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 16;
const MAX_CHARS = 1500;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("AI is not configured", { status: 500 });

        let body: { messages?: ChatMessage[] };
        try {
          body = (await request.json()) as { messages?: ChatMessage[] };
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const incoming = Array.isArray(body.messages) ? body.messages : [];
        const history = incoming
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_TURNS)
          .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

        if (history.length === 0) return new Response("Messages are required", { status: 400 });

        const { buildSystemPrompt } = await import("@/lib/site-brief");

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify({
            model: "google/gemini-3.6-flash",
            stream: true,
            messages: [{ role: "system", content: buildSystemPrompt() }, ...history],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          if (upstream.status === 429)
            return new Response("Busy right now — please call us instead.", { status: 429 });
          if (upstream.status === 402)
            return new Response("AI assistant is temporarily unavailable.", { status: 402 });
          console.error("AI gateway error", upstream.status, detail);
          return new Response("AI assistant is temporarily unavailable.", { status: 502 });
        }

        // Re-emit the SSE token stream as plain text so the browser side stays tiny.
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const reader = upstream.body.getReader();
        let buffer = "";

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const raw of lines) {
              const l = raw.trim();
              if (!l.startsWith("data:")) continue;
              const payload = l.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta = json?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta)
                  controller.enqueue(encoder.encode(delta));
              } catch {
                /* partial frame — ignore */
              }
            }
          },
          cancel: (reason) => reader.cancel(reason),
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
