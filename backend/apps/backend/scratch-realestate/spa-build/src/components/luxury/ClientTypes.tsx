import { useReveal } from "@/hooks/useReveal";
import { ArrowRight } from "lucide-react";
import heroImg from "@/assets/hero-waterfront.jpg";
import skylineImg from "@/assets/skyline-dusk.jpg";
import kitchenImg from "@/assets/luxury-kitchen.jpg";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");
const STATE = fact("STATE");
const PLACE = CITY + ", " + STATE;

const clientTypes = [
  {
    title: "Buyers",
    description:
      "Finding the right home takes more than browsing listings. It takes a trusted advisor who understands your vision, tracks the local inventory closely, and makes sure every detail aligns with how you want to live.",
    cta: "Explore Buyer Services",
    image: heroImg,
    alt: "Waterfront home with private water access at sunset",
  },
  {
    title: "Sellers",
    description:
      "Your property deserves presentation that matches its caliber. Strategic pricing, polished marketing, broad qualified-buyer exposure and careful negotiation — all orchestrated to protect your value.",
    cta: "Discover Seller Strategy",
    image: skylineImg,
    alt: "City skyline residences at dusk",
  },
  {
    title: "Investors & Relocations",
    description:
      "Whether you're timing the market, building a property portfolio, or relocating to the " + PLACE + " area, you need neighborhood intelligence and a local expert who simplifies complexity.",
    cta: "Start the Conversation",
    image: kitchenImg,
    alt: "Modern kitchen interior in a luxury residence",
  },
];

export default function ClientTypes() {
  const { ref, revealed } = useReveal();

  return (
    <section className="bg-sand py-40 md:py-56" ref={ref}>
      <div className="luxury-section">
        <div className={`text-center mb-24 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.35em] uppercase text-gold mb-6">
            Tailored Representation
          </p>
          <h2 className="font-display font-medium text-charcoal leading-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
            Crafted for Your <em className="italic">Ambition</em>
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-0">
          {clientTypes.map((client, i) => (
            <div
              key={client.title}
              className={`group relative overflow-hidden h-[600px] md:h-[700px] reveal-scale ${revealed ? "revealed" : ""}`}
              style={{ transitionDelay: `${0.2 + i * 0.12}s` }}
            >
              <img
                src={client.image}
                alt={client.alt}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.4s] group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/90 via-charcoal/40 to-charcoal/10 transition-all duration-700 group-hover:from-charcoal/95" />

              <div className="relative z-10 h-full flex flex-col justify-end p-10 lg:p-12">
                <div className="transform transition-all duration-500 group-hover:translate-y-[-12px]">
                  <h3 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium text-ivory mb-4">
                    {client.title}
                  </h3>
                  {/* Gold rule that draws on hover */}
                  <div className="w-0 h-px bg-gold group-hover:w-16 transition-all duration-700 mb-5" />
                  <p className="font-body text-sm text-ivory/45 leading-relaxed mb-8 max-w-sm">
                    {client.description}
                  </p>
                  <a
                    href="#contact"
                    className="inline-flex items-center gap-2 font-body text-[11px] tracking-luxury uppercase text-gold group-hover:text-gold-light transition-colors"
                  >
                    {client.cta}
                    <ArrowRight size={14} className="group-hover:translate-x-2 transition-transform duration-300" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
