import { createFileRoute } from "@tanstack/react-router";
import path from "node:path";
import { discover } from "../../../../../factory/pipeline/01-discover.mjs";
import { scrape } from "../../../../../factory/pipeline/02-scrape.mjs";
import { rescue } from "../../../../../factory/pipeline/03-rescue.mjs";
import { design } from "../../../../../factory/pipeline/04-design.mjs";
import { qc } from "../../../../../factory/pipeline/06-qc.mjs";
import { deploy } from "../../../../../factory/pipeline/07-deploy.mjs";
import { mergeEnrichment } from "../../../../../asset-pipeline/firecrawl-gbp-merge.mjs";
import { buildVeoPrompt } from "../../../../../asset-pipeline/veo-prompt.mjs";
import { onEmit } from "../../../../../factory/lib/emit.mjs";
import { runSiteforgePremierBuild } from "../../../../../factory/lib/siteforge-premier-provider.mjs";

// SSE route. Streams pipeline events. External callers wire ?POST /api/build
// with a Packet body; response is text/event-stream.
export const Route = createFileRoute("/api/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const packet = await request.json();
        packet.slug = packet.slug ?? slugify(packet.business.name);
        const repoRoot = process.cwd().endsWith(path.join("engine", "console"))
          ? path.resolve(process.cwd(), "../..")
          : process.cwd();
        const outDir = path.join(repoRoot, "generated-sites", packet.slug);

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            onEmit((ev) => controller.enqueue(enc.encode(`event: ${ev.stage}.${ev.phase}\ndata: ${JSON.stringify(ev)}\n\n`)));

            try {
              const firecrawlKey = process.env.FIRECRAWL_API_KEY!;
              const lovableKey = process.env.LOVABLE_API_KEY;
              const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;

              await discover(packet, { firecrawlKey, gbpEnabled: packet.toggles?.gbp, serpEnabled: packet.toggles?.local_serp });
              await scrape(packet, { firecrawlKey });
              await rescue(packet, { lovableKey, outDir });
              mergeEnrichment(packet);
              design(packet);

              if (packet.toggles?.video_prompt) {
                packet.veo_prompt = buildVeoPrompt(packet);
              }

              await runSiteforgePremierBuild(packet, { outDir, heroFamily: packet.hero_family || null });
              const qcResult = qc(packet, { outDir });
              if (qcResult.qc.exit !== 0) {
                throw new Error(`QC failed: ${qcResult.qc.results.filter((r: any) => !r.pass).map((r: any) => r.name).join(", ")}`);
              }
              await deploy(packet, { hookUrl });
            } catch (e: any) {
              controller.enqueue(enc.encode(`event: pipeline.fail\ndata: ${JSON.stringify({ stage: "pipeline", phase: "fail", payload: { error: e.message } })}\n\n`));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
      },
    },
  },
});

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
