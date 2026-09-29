import { useReveal } from "@/hooks/useReveal";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const RATING = fact("RATING");
const REVIEW_COUNT = fact("REVIEW_COUNT");

// Sanitized from the source design: the donor's third-party platform claims
// (partner sites, MLS name-drops) are gone. The marquee now carries only what
// is true of any real build: who the practice serves, how it works, the
// verified market, and — only when verified — the rating.
const base: string[] = [
  "Buyers · Sellers · Investors · Relocations",
  "Private, White-Glove Representation",
  `Serving the ${PLACE} Market`,
  ...(RATING ? [`${RATING} ★ Client Rating${REVIEW_COUNT ? ` · ${REVIEW_COUNT} Reviews` : ""}`] : []),
];

const items = base.flatMap((item) => [item, "◆"]);

export default function CredibilityStrip() {
  const { ref, revealed } = useReveal();

  return (
    <section
      id="credibility"
      className="bg-charcoal py-12 md:py-16 overflow-hidden border-t border-gold/5 border-b border-b-gold/5"
      ref={ref}
    >
      <div className={`reveal-up ${revealed ? "revealed" : ""}`}>
        <div className="marquee-track">
          {items.concat(items).map((item, i) => (
            <span
              key={i}
              className={`font-body text-xs tracking-luxury uppercase mx-10 whitespace-nowrap ${
                item === "◆" ? "text-gold/30 text-[8px]" : "text-ivory/35"
              }`}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
