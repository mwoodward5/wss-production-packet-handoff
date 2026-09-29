// Gemini 3 Pro Image cinematic still — used as the hero background image when
// Veo credits haven't been spent yet. Branded, not stock. Never a Unsplash tile.
export function buildGeminiStillPrompt(packet) {
  const { business, motif } = packet;
  const trade = business.category.toLowerCase();
  const region = `${business.city}, ${business.state}`;
  return {
    model: "google/gemini-3-pro-image",
    stream: true,
    messages: [{
      role: "user",
      content:
        `Editorial cinematic photograph, hero image for ${business.name} ` +
        `— ${trade} in ${region}. Golden hour, 35mm anamorphic, ` +
        `shallow depth, motif reference: ${motif}. No text, no logos, no watermark. ` +
        `Composition leaves negative space in the upper-left third for a headline overlay. ` +
        `Warm shadow tones with teal shadow, natural grain.`,
    }],
    modalities: ["image", "text"],
  };
}
