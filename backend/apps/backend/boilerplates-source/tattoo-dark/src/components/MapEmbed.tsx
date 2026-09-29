import { siteConfig } from "@/config/siteConfig";

export function MapEmbed() {
  return (
    <div className="relative rounded-xl overflow-hidden border border-line aspect-[16/10] bg-surface">
      <iframe
        title={`Map to ${siteConfig.studioName}`}
        src={siteConfig.directions.googleEmbed}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="w-full h-full grayscale-[35%] contrast-125"
        style={{ colorScheme: "dark", filter: "invert(0.92) hue-rotate(180deg)" }}
      />
    </div>
  );
}
