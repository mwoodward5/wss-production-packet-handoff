/**
 * Community / about-the-area block. Neutral until configured.
 */
import { CLIENT } from "@/config";
import { Section, SectionHeader } from "./Sections";

export function Community() {
  return (
    <Section>
      <SectionHeader
        eyebrow="Our Community"
        title={<>Proud to serve <span className="text-primary">{CLIENT.serviceAreaLabel}</span></>}
        intro={CLIENT.shortDescription}
      />
    </Section>
  );
}
