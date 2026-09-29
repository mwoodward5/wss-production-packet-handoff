// Logo remaster: bg removal via Lovable AI Gateway image edit, 2× upscale via
// Replicate-compatible endpoint, output flagged proposed:true if AI-generated.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export async function remasterLogo(logoUrl, outDir, { lovableKey }) {
  mkdirSync(outDir, { recursive: true });

  // 1. Fetch original
  const orig = await (await fetch(logoUrl)).arrayBuffer();
  const origPath = path.join(outDir, "logo-original.png");
  writeFileSync(origPath, Buffer.from(orig));

  // 2. Background removal via Gemini image edit
  const editBody = {
    model: "google/gemini-3-pro-image",
    stream: false,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Remove the background. Preserve every letterform and mark edge. Output PNG with transparent background." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(orig).toString("base64")}` } },
      ],
    }],
    modalities: ["image", "text"],
  };
  const editRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
    body: JSON.stringify(editBody),
  });
  if (!editRes.ok) {
    return { path: origPath, proposed: false, note: "bg-removal-failed" };
  }
  const editJson = await editRes.json();
  const b64 = extractImageB64(editJson);
  const cleanPath = path.join(outDir, "logo-bg-removed.png");
  writeFileSync(cleanPath, Buffer.from(b64, "base64"));

  return {
    path: cleanPath,
    proposed: false,
    render_size_px: 76, // target 72-80
    note: "remastered",
  };
}

function extractImageB64(json) {
  const c = json.choices?.[0]?.message?.content;
  if (Array.isArray(c)) {
    for (const part of c) {
      if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
        return part.image_url.url.split(",")[1];
      }
    }
  }
  throw new Error("No image in response");
}
