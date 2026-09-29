import { useReveal } from "@/hooks/useReveal";
import { useRef, useState, useEffect } from "react";
import yachtImg from "@/assets/yacht-lifestyle.jpg";
import kitchenImg from "@/assets/luxury-kitchen.jpg";
import aerialImg from "@/assets/aerial-estates.jpg";
import { fact } from "@/lib/facts";

const CITY = fact("CITY");

const slides = [
  {
    image: yachtImg,
    alt: "Boat docked behind a modern waterfront home at golden hour",
    label: "Private Dock Access",
    title: "Water-Ready Estates",
  },
  {
    image: kitchenImg,
    alt: "Modern kitchen with premium finishes in a luxury home",
    label: "Curated Interiors",
    title: "Architectural Excellence",
  },
  {
    image: aerialImg,
    alt: "Aerial view of an exclusive residential enclave",
    label: "Exclusive Enclaves",
    title: CITY + "'s Most Coveted Addresses",
  },
];

export default function FeaturedLifestyle() {
  const { ref, revealed } = useReveal();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setScrollProgress(maxScroll > 0 ? (el.scrollLeft / maxScroll) * 100 : 0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="bg-ivory py-40 md:py-56" ref={ref}>
      <div className="luxury-section mb-14">
        <div className={`mb-4 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.35em] uppercase text-gold mb-6">
            The Lifestyle
          </p>
          <div className="flex items-end justify-between">
            <h2 className="font-display font-medium text-charcoal leading-tight max-w-2xl"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
              Living at the Edge of <em className="italic">Everything</em>
            </h2>
            <span className="hidden md:block font-body text-[11px] tracking-luxury uppercase text-gold/50">
              {String(slides.length).padStart(2, "0")} Highlights
            </span>
          </div>
        </div>
      </div>

      {/* Horizontal scroll gallery */}
      <div className={`reveal-up ${revealed ? "revealed" : ""}`} style={{ transitionDelay: "0.3s" }}>
        <div ref={scrollRef} className="horizontal-scroll-container px-6 md:px-12 lg:px-20 xl:px-32 pb-4">
          {slides.map((slide, i) => (
            <div
              key={i}
              className="horizontal-scroll-item relative group w-[85vw] md:w-[60vw] lg:w-[45vw] h-[500px] md:h-[650px] overflow-hidden flex-shrink-0"
            >
              <img
                src={slide.image}
                alt={slide.alt}
                className="w-full h-full object-cover transition-transform duration-[1.2s] group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/70 via-transparent to-transparent" />

              {/* Counter */}
              <div className="absolute top-8 right-8">
                <span className="font-body text-[11px] tracking-luxury uppercase text-gold/60">
                  {String(i + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
                </span>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-10 md:p-12 transform transition-transform duration-500 group-hover:translate-y-[-6px]">
                <p className="font-body text-[10px] tracking-[0.3em] uppercase text-gold mb-3">{slide.label}</p>
                <p className="font-display text-2xl md:text-3xl lg:text-4xl text-ivory">{slide.title}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Scroll progress bar */}
        <div className="luxury-section mt-6">
          <div className="w-full h-px bg-charcoal/10 relative">
            <div
              className="absolute top-0 left-0 h-full bg-gold/60 transition-[width] duration-150"
              style={{ width: `${scrollProgress}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
