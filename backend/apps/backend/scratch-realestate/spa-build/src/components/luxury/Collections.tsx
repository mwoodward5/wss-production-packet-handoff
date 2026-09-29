import { useReveal } from "@/hooks/useReveal";
import { ArrowRight } from "lucide-react";
import heroImg from "@/assets/hero-waterfront.jpg";
import skylineImg from "@/assets/skyline-dusk.jpg";
import aerialImg from "@/assets/aerial-estates.jpg";
import kitchenImg from "@/assets/luxury-kitchen.jpg";
import yachtImg from "@/assets/yacht-lifestyle.jpg";
import { fact } from "@/lib/facts";
import { WSSC } from "@/lib/content";

const CITY = fact("CITY");

// The design's five collection frames, in composition order. Titles and
// subtitles are trade-generic (the kinds of representation any agent offers —
// never a claim about specific inventory). On a real build the engine's
// verified service list maps onto these frames via the content bridge, so the
// section carries the CLIENT's own service language on the same imagery.
const defaultCollections = [
  {
    title: "Waterfront & View Homes",
    subtitle: "Representation for water-access and view properties",
    image: heroImg,
    alt: "Waterfront estate with expansive water views",
  },
  {
    title: "Luxury Condominiums",
    subtitle: "Sky residences and full-service buildings",
    image: skylineImg,
    alt: "High-rise condominium towers at dusk",
  },
  {
    title: "New Developments",
    subtitle: "Pre-construction and new-build opportunities",
    image: kitchenImg,
    alt: "Modern new-construction interior with premium finishes",
  },
  {
    title: "Dock & Water Access",
    subtitle: "Homes for owners who live on the water",
    image: yachtImg,
    alt: "Private dock behind a luxury home at golden hour",
  },
  {
    title: "Signature Neighborhoods",
    subtitle: "The addresses that define the " + CITY + " market",
    image: aerialImg,
    alt: "Aerial view of an exclusive residential enclave",
  },
];

const services: { name: string; description?: string }[] =
  Array.isArray(WSSC.services) ? WSSC.services.filter((s) => s && s.name) : [];

const collections = services.length
  ? defaultCollections.map((c, i) => ({
      ...c,
      title: services[i] ? services[i].name : c.title,
      subtitle: services[i] && services[i].description ? String(services[i].description) : c.subtitle,
    }))
  : defaultCollections;

export default function Collections() {
  const { ref, revealed } = useReveal();

  return (
    <section id="collections" className="scroll-mt-24 bg-charcoal py-40 md:py-56" ref={ref}>
      <div className="luxury-section">
        <div className={`text-center mb-24 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.4em] uppercase text-gold mb-6">
            Property Collections
          </p>
          <h2 className="font-display font-medium text-ivory leading-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
            Curated for the <em className="italic text-gold">Exceptional</em>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {collections.map((item, i) => (
            <a
              key={item.title + i}
              href="#contact"
              className={`group relative overflow-hidden gold-glow-hover ${
                i === 0 ? "md:col-span-2 lg:col-span-2 h-[500px] md:h-[600px]" : "h-[400px] md:h-[450px]"
              } reveal-scale ${revealed ? "revealed" : ""}`}
              style={{ transitionDelay: `${0.1 + i * 0.08}s` }}
            >
              <img
                src={item.image}
                alt={item.alt}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.4s] group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/80 via-charcoal/10 to-transparent transition-all duration-500" />

              {/* Collection number watermark */}
              <div className="absolute top-6 right-8 font-display text-[80px] md:text-[120px] font-medium text-ivory/[0.03] leading-none select-none pointer-events-none">
                {String(i + 1).padStart(2, "0")}
              </div>

              {/* Gold border on hover - draws from corners */}
              <div className="absolute inset-3 border border-gold/0 group-hover:border-gold/20 transition-all duration-1000" />

              <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
                <p className="font-display text-xl md:text-2xl lg:text-3xl text-ivory mb-2">{item.title}</p>
                <p className="font-body text-[11px] text-ivory/40 tracking-wide">{item.subtitle}</p>
                <div className="mt-5 flex items-center gap-2 text-gold opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500">
                  <span className="font-body text-[10px] tracking-luxury uppercase">Begin a Conversation</span>
                  <ArrowRight size={12} />
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
