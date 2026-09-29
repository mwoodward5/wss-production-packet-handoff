import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proofRoot = path.join(__dirname, "proof", "ca-landscape-leadminer-2026-07-05", "preview-sites");
const currentManifestPath = path.join(proofRoot, "CA_LANDSCAPE_THREE_KITCHEN_REBUILD_2026-07-06.json");
const legacyManifestPath = path.join(proofRoot, "CA_LANDSCAPE_PREVIEW_MANIFEST.json");
const manifestFile = JSON.parse(readFileSync(
  currentManifestPath && await exists(currentManifestPath) ? currentManifestPath : legacyManifestPath,
  "utf8",
));
const manifest = Array.isArray(manifestFile) ? manifestFile : manifestFile.manifest;

async function exists(file) {
  try {
    await import("node:fs/promises").then((fs) => fs.access(file));
    return true;
  } catch {
    return false;
  }
}

async function check(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow" });
    const html = await res.text();
    const bannedPublicCopy = [
      "LeadMiner rank",
      "opportunity score",
      "source detected",
      "rebuild opening",
      "weak points",
      "Tune this build",
      "View Google profile",
      "Ghost Agency",
      "factory controls",
      "Preview controls",
      "Preview generated from LeadMiner",
      "Noindex until verified",
      "local proof",
      "audit stays",
      "report sent",
      "AI follow-up",
      "Source images",
    ];
    return {
      url,
      ok: res.ok,
      status: res.status,
      responseMs: Date.now() - started,
      finalUrl: res.url,
      title: html.match(/<title>([^<]+)/i)?.[1] || "",
      noindexHeader: res.headers.get("x-robots-tag") || "",
      hasConfig: /id=["']config["']/.test(html),
      hasPlatformSelect: /id=["']platform["']/.test(html),
      hasSourceSelect: /id=["']source["']/.test(html),
      hasPackageSelect: /id=["']package["']/.test(html),
      sections: (html.match(/<section\b/g) || []).length,
      images: (html.match(/<img\b/g) || []).length,
      dataMotion: html.match(/data-motion=["']([^"']+)/)?.[1] || "",
      hasV4Build: /data-v4-build=["']a-plus-meta["']/.test(html),
      hasVideo: /<video\b/i.test(html),
      videoReady: /data-video-status=["']veo-ready["']/.test(html),
      videoPending: /data-video-status=["']veo-pending["']/.test(html),
      bannedHits: bannedPublicCopy.filter((phrase) => html.toLowerCase().includes(phrase.toLowerCase())),
    };
  } catch (error) {
    return { url, ok: false, status: 0, responseMs: Date.now() - started, error: error.message };
  }
}

async function checkAsset(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow" });
    const bytes = Number(res.headers.get("content-length") || 0);
    return {
      url,
      ok: res.ok,
      status: res.status,
      responseMs: Date.now() - started,
      contentType: res.headers.get("content-type") || "",
      bytes,
    };
  } catch (error) {
    return { url, ok: false, status: 0, responseMs: Date.now() - started, error: error.message };
  }
}

const results = [];
for (const item of manifest) {
  results.push({
    business: item.business,
    project: item.project,
    home: await check(item.url),
    source: await check(`${item.url}/source/`),
    package: await check(`${item.url}/package/`),
    heroVideo: await checkAsset(`${item.url}/assets/hero-video.mp4`),
  });
}

mkdirSync(proofRoot, { recursive: true });
writeFileSync(path.join(proofRoot, "CA_LANDSCAPE_LIVE_SMOKE.json"), JSON.stringify(results, null, 2));
writeFileSync(path.join(proofRoot, "CA_LANDSCAPE_LIVE_SMOKE.md"), [
  "# CA Landscape Live Smoke",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  ...results.flatMap((row) => [
    `## ${row.business}`,
    `- URL: ${row.home.url}`,
    `- Home: ${row.home.status} / ${row.home.title}`,
    `- Routes: source ${row.source.status}, package ${row.package.status}`,
    `- Provider video: ${row.heroVideo.status} / ${row.heroVideo.contentType} / ${row.heroVideo.bytes || "streamed"} bytes`,
    `- Home controls removed: ${!row.home.hasPlatformSelect && !row.home.hasSourceSelect && !row.home.hasPackageSelect}`,
    `- Home banned copy hits: ${row.home.bannedHits.length ? row.home.bannedHits.join(", ") : "none"}`,
    `- Sections/images: ${row.home.sections} / ${row.home.images}`,
    `- Noindex header: ${row.home.noindexHeader || "missing"}`,
    "",
  ]),
].join("\n"));

const failures = results.flatMap((row) => [
  row.home.ok ? null : `${row.business} home failed`,
  row.source.ok ? null : `${row.business} source failed`,
  row.package.ok ? null : `${row.business} package failed`,
  row.heroVideo.ok ? null : `${row.business} hero video asset failed`,
  !row.home.hasPlatformSelect && !row.home.hasSourceSelect && !row.home.hasPackageSelect ? null : `${row.business} homepage still exposes internal controls`,
  row.home.bannedHits.length === 0 ? null : `${row.business} homepage banned copy: ${row.home.bannedHits.join(", ")}`,
  row.home.hasV4Build ? null : `${row.business} missing v4 build marker`,
  row.home.hasVideo ? null : `${row.business} missing provider video tag`,
  row.home.videoReady ? null : `${row.business} provider video is not ready on live page`,
]).filter(Boolean);

console.log(JSON.stringify({ ok: failures.length === 0, failures, results }, null, 2));
if (failures.length) process.exitCode = 1;
