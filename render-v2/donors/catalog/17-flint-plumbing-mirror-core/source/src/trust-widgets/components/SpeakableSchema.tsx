import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { JsonLd } from "./primitives";

/**
 * Marks the concise answer blocks as speakable for voice assistants.
 * Only emitted when the matching selectors are actually rendered on the page.
 */
export function SpeakableSchema({
  selectors = [".tw-voice-answer"],
  pagePath = "/",
  rendered = true,
}: { selectors?: string[]; pagePath?: string; rendered?: boolean }) {
  const cfg = useTrust();
  const data = cfg.business?.url
    ? {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": `${cfg.business.url}${pagePath}#webpage`,
        url: `${cfg.business.url}${pagePath}`,
        name: cfg.business.name,
        speakable: { "@type": "SpeakableSpecification", cssSelector: selectors },
      }
    : undefined;
  return (
    <Gate id="SpeakableSchema" when={Boolean(data) && rendered}>
      <JsonLd data={data} />
    </Gate>
  );
}
