// Veo 3 / Gemini video prompt generator. Emits a submission-ready prompt JSON
// derived from trade + motif + region + owner_story + palette. Never generic
// stock — every prompt names local geography, real materials, and a specific
// business moment.
export function buildVeoPrompt(packet) {
  const { business, motif, voice_persona, enrichment_sources } = packet;
  const palette = enrichment_sources?.branding?.value?.colors ?? {};
  const region = `${business.city}, ${business.state}`;
  const trade = business.category.toLowerCase();

  const beats = tradeCinematicBeats(trade);
  const paletteWords = colorWords(palette);
  const ownerLine = voice_persona?.first_person_snippets?.[0] ?? "";

  const prompt =
    `Cinematic 10-second hero video for ${business.name}, a ${trade} operator in ${region}. ` +
    `${beats}. Lighting is golden hour, slight haze, anamorphic 2.39:1 with subtle lens breathing. ` +
    `Palette: ${paletteWords}. Motif reference: ${motif} — the composition should echo this without literal overlays. ` +
    `Camera: slow dolly-in at 15mm equivalent, minimal cuts, one held beat at 6s. ` +
    `Grade: teal-shadow / warm-highlight, gentle grain. No text, no logos, no captions. ` +
    (ownerLine ? `Emotional intent from the owner: "${ownerLine.slice(0, 140)}". ` : "") +
    `Duration 10s, 24fps, resolution 1920x1080, HDR-ready.`;

  return {
    provider: "veo-3",
    model: "veo-3-cinematic",
    duration_s: 10,
    fps: 24,
    resolution: "1920x1080",
    aspect_ratio: "16:9",
    prompt,
    negative_prompt: "stock footage aesthetic, generic drone shot, watermark, text, logo, cartoon, illustration, oversaturated",
    seed_slug: `${packet.slug}-${packet.layout_seed}`,
  };
}

function tradeCinematicBeats(trade) {
  if (trade.includes("landscape")) {
    return "Beats: (0-3s) hand brushing a hedge, morning mist; (3-6s) irrigation arc catching light over fresh sod; (6-10s) wide reveal of a finished front yard with the owner walking out of frame";
  }
  if (trade.includes("excavat")) {
    return "Beats: (0-3s) survey stakes in packed clay; (3-6s) hydraulic arm arc, dust plume; (6-10s) wide pull-back to graded pad with the crew boot in foreground";
  }
  if (trade.includes("roof")) {
    return "Beats: (0-3s) chalk line snap on decking; (3-6s) shingle course laid, nail-gun rhythm; (6-10s) rooftop wide with valley detail catching light";
  }
  return "Beats: (0-3s) tool-in-hand macro; (3-6s) mid-shot of work in progress; (6-10s) finished detail hero reveal";
}

function colorWords(colors) {
  const list = [];
  if (colors.primary) list.push(`primary ${colors.primary}`);
  if (colors.secondary) list.push(`secondary ${colors.secondary}`);
  if (colors.accent) list.push(`accent ${colors.accent}`);
  if (!list.length) return "warm earth tones";
  return list.join(", ");
}
