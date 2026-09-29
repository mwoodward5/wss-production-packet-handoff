import { motion } from "framer-motion";
import { siteConfig } from "@/config/siteConfig";

export function ProcessSection() {
  return (
    <section id="process" className="py-28 md:py-32 relative overflow-hidden">
      <div className="container-wss relative">
        <div className="max-w-3xl mb-16">
          <div className="section-label">How it works</div>
          <h2 className="text-4xl md:text-5xl font-bold mb-5 leading-[1.05]">
            From idea to <span className="italic text-signal">appointment.</span>
          </h2>
          <p className="text-fadetext text-lg leading-relaxed">
            A calm, deliberate process — because the tattoo is permanent and the experience should feel that way too.
          </p>
        </div>

        <div className="relative space-y-24 md:space-y-32">
          {/* Vertical ink line */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-signal/40 to-transparent pointer-events-none" />

          {siteConfig.process.map((p, i) => {
            const flipped = i % 2 === 1;
            return (
              <motion.div
                key={p.step}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className={`grid md:grid-cols-2 gap-8 md:gap-16 items-center ${flipped ? "md:[&>*:first-child]:order-2" : ""}`}
              >
                <div className="frame-plate relative">
                  <img
                    src={p.image}
                    alt={p.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full aspect-[5/4] object-cover"
                  />
                </div>
                <div className="relative">
                  <div className="absolute -top-16 md:-top-20 -left-2 md:-left-4 text-[10rem] md:text-[14rem] font-display font-bold leading-none text-transparent pointer-events-none select-none" style={{ WebkitTextStroke: "1px hsl(30 8% 20%)" }}>
                    {p.step}
                  </div>
                  <div className="relative">
                    <div className="section-label">Step {p.step}</div>
                    <h3 className="font-display text-3xl md:text-4xl font-bold mb-4 leading-tight">{p.title}</h3>
                    <p className="text-fadetext text-lg leading-relaxed max-w-md">{p.text}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
