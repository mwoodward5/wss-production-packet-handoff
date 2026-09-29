// Headless CLI: pnpm build-site --packet packets/<slug>.json
import { readFileSync } from "node:fs";
import path from "node:path";
import { discover } from "./01-discover.mjs";
import { scrape } from "./02-scrape.mjs";
import { rescue } from "./03-rescue.mjs";
import { design } from "./04-design.mjs";
import { qc } from "./06-qc.mjs";
import { deploy } from "./07-deploy.mjs";
import { mergeEnrichment } from "../../asset-pipeline/firecrawl-gbp-merge.mjs";
import { buildVeoPrompt } from "../../asset-pipeline/veo-prompt.mjs";
import { runSiteforgePremierBuild } from "../lib/siteforge-premier-provider.mjs";

const packetArg = process.argv[process.argv.indexOf("--packet") + 1];
if (!packetArg) { console.error("usage: build-site --packet <path>"); process.exit(2); }

const packet = JSON.parse(readFileSync(packetArg, "utf8"));
packet.slug = packet.slug ?? slugify(packet.business.name);
const outDir = path.join("generated-sites", packet.slug);
const firecrawlKey = process.env.FIRECRAWL_API_KEY;
const lovableKey = process.env.LOVABLE_API_KEY;
const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;

await discover(packet, { firecrawlKey, gbpEnabled: !!packet.toggles?.gbp, serpEnabled: !!packet.toggles?.local_serp });
await scrape(packet, { firecrawlKey });
await rescue(packet, { lovableKey, outDir });
mergeEnrichment(packet);
design(packet);
if (packet.toggles?.video_prompt) packet.veo_prompt = buildVeoPrompt(packet);
await runSiteforgePremierBuild(packet, { outDir, heroFamily: packet.hero_family || null });
const qcResult = qc(packet, { outDir });
if (qcResult.qc.exit !== 0) { console.error("QC failed"); process.exit(1); }
await deploy(packet, { hookUrl });

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
