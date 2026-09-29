import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Expand } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
import { Lightbox, type LightboxItem } from "./Lightbox";
import { track } from "@/lib/analytics";

export function Portfolio() {
  const styles = ["All", ...Array.from(new Set(siteConfig.gallery.map((g) => g.style)))];
  const [active, setActive] = useState("All");
  const [lightIndex, setLightIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () => (active === "All" ? siteConfig.gallery : siteConfig.gallery.filter((g) => g.style === active)),
    [active]
  );

  const openLightbox = (i: number, title: string) => {
    setLightIndex(i);
    track("gallery_open", { title, filter: active });
  };

  const requestSimilar = (item: LightboxItem) => {
    try {
      sessionStorage.setItem("wss_prefill", JSON.stringify({
        style: item.style,
        placement: item.placement,
        size: item.size.startsWith("Small") ? "Small (< 3\")" : item.size === "Medium" ? "Medium (3–6\")" : "Large (6–10\")",
        description: `Inspired by "${item.title}"`,
      }));
    } catch {}
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="portfolio" className="py-28 md:py-32 container-wss">
      <div className="max-w-3xl mb-12">
        <div className="section-label">Portfolio</div>
        <h2 className="text-4xl md:text-5xl font-bold mb-5 leading-[1.05]">
          Recent work, <span className="italic text-signal">sorted by style.</span>
        </h2>
        <p className="text-fadetext text-lg leading-relaxed">
          Every piece is drawn for the person wearing it. Click any frame to see the full story — session length, placement notes, and how it was designed.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-12">
        {styles.map((s) => (
          <button
            key={s}
            onClick={() => setActive(s)}
            className={`relative px-5 py-2.5 rounded-full text-sm transition ${
              active === s ? "text-ink font-semibold" : "border border-line text-fadetext hover:text-bone hover:border-bone/40"
            }`}
          >
            {active === s && (
              <motion.span
                layoutId="chip-active"
                className="absolute inset-0 bg-signal rounded-full emboss"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            )}
            <span className="relative">{s}</span>
          </button>
        ))}
      </div>

      {/* Masonry grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 auto-rows-[180px] md:auto-rows-[220px]">
        <AnimatePresence mode="popLayout">
          {filtered.map((item, i) => {
            const span = item.aspect === "tall" ? "row-span-2" : "row-span-2 md:row-span-2";
            const wide = i % 5 === 0 ? "md:col-span-2 md:row-span-2" : "";
            return (
              <motion.button
                layout
                key={item.title}
                onClick={() => openLightbox(i, item.title)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.5, delay: i * 0.04 }}
                className={`group relative ${span} ${wide} frame-plate cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-signal focus:ring-offset-4 focus:ring-offset-ink`}
                aria-label={`Open ${item.title}`}
              >
                <div className="relative overflow-hidden w-full h-full">
                  <img
                    src={item.image}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent opacity-70 group-hover:opacity-90 transition" />
                  <div className="absolute top-3 right-3 w-9 h-9 rounded-full grid place-items-center bg-ink/70 border border-bone/20 text-bone opacity-0 group-hover:opacity-100 transition">
                    <Expand size={14} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-signal mb-1">{item.style}</div>
                    <div className="font-display font-semibold text-bone text-sm md:text-base leading-tight">{item.title}</div>
                    <div className="text-[11px] text-fadetext mt-0.5">{item.placement} · {item.size}</div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <Lightbox
        items={filtered}
        index={lightIndex}
        onClose={() => setLightIndex(null)}
        onIndex={setLightIndex}
        onRequest={requestSimilar}
      />
    </section>
  );
}
