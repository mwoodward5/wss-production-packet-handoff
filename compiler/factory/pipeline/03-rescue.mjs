// Pipeline stage 3 — rescue: logo remaster, image pHash dedup, palette pull.
import { emit } from "../lib/emit.mjs";
import { remasterLogo } from "../../asset-pipeline/logo-remaster.mjs";
import { remasterLogoLocal } from "../lib/asset-remaster/local-logo-remaster.mjs";
import path from "node:path";

export async function rescue(packet, { lovableKey, outDir }) {
  emit("rescue", "start", {});
  const src = packet.enrichment_sources ?? {};
  const logoUrl = src.logo?.value;
  const logoOrigin = src.logo?.source === "gbp" ? "gbp" : "firecrawl";

  if (logoUrl && lovableKey) {
    try {
      const remaster = await remasterLogo(logoUrl, path.join(outDir, "media"), { lovableKey });
      packet.logo_source = {
        url: logoUrl,
        origin: logoOrigin,
        proposed: false,
        remastered_path: remaster.path,
      };
    } catch (e) {
      emit("rescue", "logo-error", { message: e.message });
      packet.logo_source = { url: logoUrl, origin: logoOrigin, proposed: false };
    }
  } else if (logoUrl) {
    // No external provider key: still make THEIR mark look premium with a
    // local background-drop + trim + upscale + sharpen. Falls through to the
    // raw source URL if the remaster can't run — never a generic name box.
    let remastered_path;
    try {
      const local = await remasterLogoLocal(logoUrl, path.join(outDir, "media"));
      if (local.performed) {
        remastered_path = local.path;
        emit("rescue", "logo-remastered-local", { path: local.path, background_removed: local.background_removed, upscaled: local.upscaled });
      } else {
        emit("rescue", "logo-remaster-skipped", { reason: local.reason });
      }
    } catch (e) {
      emit("rescue", "logo-local-error", { message: e.message });
    }
    packet.logo_source = {
      url: logoUrl,
      origin: logoOrigin,
      proposed: false,
      ...(remastered_path ? { remastered_path } : {}),
    };
    emit("rescue", "logo-source-used", { url: logoUrl, remastered: Boolean(remastered_path) });
  } else {
    // No source logo — flag for proposed-mark generation, operator must confirm.
    packet.logo_source = { url: null, origin: "proposed", proposed: true };
    emit("rescue", "logo-missing", {});
  }

  emit("rescue", "done", { logo: packet.logo_source });
  return packet;
}
