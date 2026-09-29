// Pipeline stage 7 — deploy: fire the Vercel deploy hook.
import { emit } from "../lib/emit.mjs";
export async function deploy(packet, { hookUrl }) {
  emit("deploy", "start", {});
  if (!hookUrl) {
    emit("deploy", "skipped", { reason: "VERCEL_DEPLOY_HOOK_URL not set" });
    return packet;
  }
  const r = await fetch(hookUrl, { method: "POST" });
  const url = r.ok ? await r.text().catch(() => "") : "";
  emit("deploy", "done", { url: url || "queued", status: r.status });
  return packet;
}
