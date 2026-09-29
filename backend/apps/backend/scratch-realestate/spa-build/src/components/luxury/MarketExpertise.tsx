import { useReveal } from "@/hooks/useReveal";
import skylineImg from "@/assets/skyline-dusk.jpg";
import ParallaxImage from "./ParallaxImage";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");

const expertisePoints = [
  { title: "Market Intelligence", desc: "A close read of pricing trends, absorption and neighborhood dynamics across the " + CITY + " market — grounded in the comparable sales, not the headlines." },
  { title: "Strategic Timing", desc: "Advice on when to buy, sell, or hold based on real data and local insight — an understanding of what actually drives value in the market you're in." },
  { title: "Skilled Negotiation", desc: "Protecting your interests with calm precision, creative deal structuring, and preparation that holds up on both sides of the table." },
  { title: "Tailored Strategy", desc: "No two properties or clients are alike. Every acquisition or listing strategy is custom-built around your goals, timeline, and risk tolerance." },
];

export default function MarketExpertise() {
  const { ref, revealed } = useReveal();

  return (
    <section id="expertise" className="scroll-mt-24 bg-ivory py-40 md:py-56" ref={ref}>
      <div className="luxury-section">
        <div className="grid lg:grid-cols-2 gap-20 lg:gap-28 items-center">
          <div className={`order-2 lg:order-1 reveal-clip ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.2s" }}>
            <div className="relative">
              <div className="absolute -bottom-4 -left-4 top-4 right-4 border border-gold/20 pointer-events-none z-0" />
              <div className="relative z-10">
                <ParallaxImage
                  src={skylineImg}
                  alt="City skyline at dusk reflecting on the water"
                  className="h-[500px] lg:h-[700px]"
                  speed={0.2}
                />
              </div>
            </div>
          </div>

          <div className={`order-1 lg:order-2 reveal-up ${revealed ? "revealed" : ""}`}>
            <p className="font-body text-[11px] tracking-[0.35em] uppercase text-gold mb-6">
              Local Market Fluency
            </p>
            <h2 className="font-display font-medium text-charcoal leading-[1.05] mb-10"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
              Expertise That<br />
              <em className="italic">Moves Markets</em>
            </h2>
            <div className={`luxury-divider-animate ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.4s" }} />

            <div className="space-y-10 mt-12">
              {expertisePoints.map((point, i) => (
                <div
                  key={point.title}
                  className={`group reveal-up ${revealed ? "revealed" : ""}`}
                  style={{ transitionDelay: `${0.3 + i * 0.1}s` }}
                >
                  <h3 className="font-display text-xl font-medium text-charcoal mb-3 group-hover:text-gold-dark transition-colors duration-300">{point.title}</h3>
                  <p className="font-body text-sm text-muted-foreground leading-[1.8]">{point.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
