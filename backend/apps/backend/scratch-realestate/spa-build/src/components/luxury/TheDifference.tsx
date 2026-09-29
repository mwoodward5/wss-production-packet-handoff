import { useReveal } from "@/hooks/useReveal";

const differences = [
  { title: "Bespoke Representation", desc: "Every client relationship is singular. Strategy, communication, and execution are tailored entirely to you." },
  { title: "Exceptional Presentation", desc: "Polished photography, architectural storytelling, and marketing materials that honor the caliber of every property." },
  { title: "Responsive Communication", desc: "Timely availability, transparent updates, and a proactive approach that respects your time and expectations." },
  { title: "Strategic Execution", desc: "From first conversation to closing — deliberate timing, thoughtful preparation, and confident guidance at every stage." },
  { title: "Trusted Guidance", desc: "Honest counsel rooted in market knowledge, experience, and a genuine commitment to your long-term satisfaction." },
  { title: "Broad Exposure", desc: "Listings reach qualified buyers through premium channels, curated networks, and targeted digital campaigns." },
];

export default function TheDifference() {
  const { ref, revealed } = useReveal();

  return (
    <section className="bg-charcoal py-40 md:py-56" ref={ref}>
      <div className="luxury-section">
        <div className={`text-center mb-24 reveal-up ${revealed ? "revealed" : ""}`}>
          <p className="font-body text-[11px] tracking-[0.4em] uppercase text-gold mb-6">
            The Standard
          </p>
          <h2 className="font-display font-medium text-ivory leading-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
            What Sets This<br />
            Practice <em className="italic text-gold">Apart</em>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-ivory/5">
          {differences.map((item, i) => (
            <div
              key={item.title}
              className={`bg-charcoal p-10 lg:p-14 group hover:bg-charcoal-light transition-all duration-700 relative reveal-up ${revealed ? "revealed" : ""}`}
              style={{ transitionDelay: `${0.15 + i * 0.08}s` }}
            >
              {/* Number watermark */}
              <span className="absolute top-6 right-8 font-display text-[48px] text-gold/[0.06] font-medium select-none pointer-events-none">
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* Gold left border on hover */}
              <div className="absolute left-0 top-0 w-[2px] h-0 bg-gold group-hover:h-full transition-all duration-700" />

              <div className="w-8 h-px bg-gold/30 mb-8 group-hover:w-14 transition-all duration-500" />
              <h3 className="font-display text-xl font-medium text-ivory mb-4 group-hover:text-gold transition-colors duration-500">{item.title}</h3>
              <p className="font-body text-sm text-ivory/35 leading-[1.8] group-hover:text-ivory/55 transition-colors duration-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
