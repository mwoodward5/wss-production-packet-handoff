import { useReveal } from "@/hooks/useReveal";
import interiorImg from "@/assets/lifestyle-interior.jpg";
import CounterStat from "./CounterStat";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;
const RATING = fact("RATING");
const REVIEW_COUNT = fact("REVIEW_COUNT");
const LICENSE = fact("LICENSE");

// TRUTH LAW: the source design's fabricated prestige metrics ($500M+ portfolio,
// 15+ years) are gone. The stat rail renders only verified facts — the rating
// and the review count — and collapses entirely when neither exists.
const hasStats = Boolean(RATING || REVIEW_COUNT);

export default function AboutBrand() {
  const { ref, revealed } = useReveal();

  return (
    <section id="about" className="scroll-mt-24 bg-ivory py-40 md:py-56 section-transition-up" ref={ref}>
      <div className="luxury-section">
        <div className="grid lg:grid-cols-12 gap-20 lg:gap-12 items-center">
          {/* Text */}
          <div className={`lg:col-span-5 lg:pr-4 reveal-up ${revealed ? "revealed" : ""}`}>
            <p className="font-body text-[11px] tracking-[0.4em] uppercase text-gold mb-6">
              The Approach
            </p>
            <h2 className="font-display font-medium text-charcoal leading-[1.05] mb-10"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
              Representation<br />
              Refined to an <em className="italic text-gold-dark">Art</em>
            </h2>
            <div className={`luxury-divider-animate ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.3s" }} />
            <div className="space-y-6 font-body text-sm md:text-[15px] text-muted-foreground leading-[1.9] mt-10">
              <p>
                In the {PLACE} market, significant properties demand serious
                representation. Every client receives the attention, preparation and
                strategic guidance that a major purchase or sale deserves — from the
                first conversation to the closing table.
              </p>
              <p>
                The work is built on local market insight, a disciplined read of
                comparable sales, meticulous preparation, polished presentation and
                skilled negotiation — carried out with the discretion discerning
                clients expect.
              </p>
            </div>

            {/* Pull quote with decorative mark */}
            <blockquote className={`mt-12 pl-8 border-l-2 border-gold/40 relative reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.4s" }}>
              <span className="absolute -left-3 -top-8 font-display text-[80px] text-gold/10 leading-none select-none">"</span>
              <p className="font-display text-xl md:text-2xl italic text-charcoal/80 leading-relaxed">
                "Every transaction is guided by discretion, expertise, and an unwavering commitment."
              </p>
            </blockquote>

            {/* Verified stats only — collapses when nothing is verified */}
            {hasStats && (
              <div className="grid grid-cols-2 gap-8 mt-16 pt-10 border-t border-border">
                {RATING && (
                  <div>
                    <p className="font-display text-4xl md:text-5xl font-medium text-charcoal">
                      {RATING} <span className="text-gold">★</span>
                    </p>
                    <p className="font-body text-xs tracking-editorial uppercase text-muted-foreground mt-2">Client Rating</p>
                  </div>
                )}
                {REVIEW_COUNT && (
                  <CounterStat end={Number(REVIEW_COUNT) || 0} label="Client Reviews" />
                )}
              </div>
            )}

            {LICENSE && (
              <div className="mt-10 p-5 border border-gold/25 bg-gold/5">
                <p className="font-body text-[10px] tracking-[0.3em] uppercase text-gold-dark mb-1.5">Credentials</p>
                <p className="font-body text-sm text-muted-foreground">{LICENSE}</p>
              </div>
            )}
          </div>

          {/* Image with gold frame offset */}
          <div className={`lg:col-span-7 lg:pl-8 reveal-clip ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.3s" }}>
            <div className="relative">
              {/* Gold frame offset */}
              <div className="absolute -top-4 -right-4 bottom-4 left-4 border border-gold/20 pointer-events-none z-0" />
              <div className="relative overflow-hidden z-10">
                <img
                  src={interiorImg}
                  alt="Light-filled living room of a luxury waterfront residence"
                  className="w-full h-[550px] lg:h-[750px] object-cover img-luxury"
                  loading="lazy"
                  width={1280}
                  height={960}
                />
                <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-charcoal/20 to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
