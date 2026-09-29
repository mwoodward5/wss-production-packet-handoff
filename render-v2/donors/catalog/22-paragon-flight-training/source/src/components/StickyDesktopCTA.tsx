import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Floating Request-Info pill that surfaces after the user scrolls past
 * roughly the hero, and hides again near the contact section so it never
 * collides with the form. Desktop only — mobile uses StickyCallBar.
 */
export const StickyDesktopCTA = () => {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const contact = document.getElementById("contact");
      const contactTop = contact ? contact.getBoundingClientRect().top + y : Infinity;
      const past = y > window.innerHeight * 0.85;
      const beforeContact = y + window.innerHeight < contactTop + 200;
      setVisible(past && beforeContact);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-8 right-8 z-40 hidden md:block">
      <AnimatePresence>
        {visible && (
          <motion.a
            href="/#contact"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto group relative inline-flex h-12 items-center gap-2.5 overflow-hidden rounded-md px-5 font-display text-[13px] font-semibold tracking-wide text-primary-foreground bg-[linear-gradient(180deg,hsl(var(--primary-glow))_0%,hsl(var(--primary))_55%,hsl(var(--horizon))_100%)] shadow-[0_1px_0_0_hsl(0_0%_100%/0.35)_inset,0_18px_40px_-12px_hsl(var(--primary)/0.55)] transition-shadow duration-300 hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.45)_inset,0_22px_48px_-12px_hsl(var(--primary)/0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Jump to admissions inquiry"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-md p-px bg-[linear-gradient(180deg,hsl(0_0%_100%/0.55)_0%,hsl(var(--primary)/0.2)_50%,hsl(var(--sky-deep)/0.5)_100%)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] [-webkit-mask-composite:xor]"
            />
            Request Info
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </motion.a>
        )}
      </AnimatePresence>
    </div>
  );
};
