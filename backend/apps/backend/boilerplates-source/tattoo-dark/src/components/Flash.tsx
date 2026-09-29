import { Sparkles, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { siteConfig } from "@/config/siteConfig";

export function Flash({ onBook }: { onBook: () => void }) {
  return (
    <section id="flash" className="py-28 md:py-32 container-wss">
      <div className="max-w-3xl mb-14 flex items-end justify-between gap-8 flex-wrap">
        <div>
          <div className="section-label">Available Flash</div>
          <h2 className="text-4xl md:text-5xl font-bold leading-[1.05]">
            Ready-to-book <span className="italic text-signal">designs.</span>
          </h2>
        </div>
        <p className="text-fadetext max-w-sm">Pre-drawn pieces available now. Repeatable unless marked one-time.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-5 md:gap-6">
        {siteConfig.flash.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: i * 0.1 }}
            className="glass p-7 flex flex-col gap-3 group relative overflow-hidden"
          >
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-signal/10 blur-3xl rounded-full group-hover:bg-signal/25 transition duration-700" />
            <div className="relative flex items-center justify-between">
              <div className="w-11 h-11 rounded-xl bg-signal/15 text-signal grid place-items-center border border-signal/30">
                <Sparkles size={20} />
              </div>
              <span className={`tag text-[10px] ${f.status === "One left" ? "text-signal border-signal/50" : "text-brass border-brass/40"}`}>
                <Zap size={10} /> {f.status}
              </span>
            </div>
            <h3 className="font-display font-semibold text-xl mt-2 relative">{f.title}</h3>
            <p className="text-sm text-fadetext relative">{f.size} · {f.note}</p>
            <div className="text-4xl font-display font-bold text-bone relative mt-1">{f.price}</div>
            <button
              onClick={onBook}
              className="relative mt-3 border border-line rounded-full py-2.5 text-sm hover:border-signal hover:text-signal transition text-fadetext"
            >
              Request this piece →
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
