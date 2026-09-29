import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile"; // your own responsive hook
import { useTimeOfDay } from "@/hooks/useTimeOfDay"; // returns { background, ...palette } based on hour
import { TropicalEnvironment } from "./hero/TropicalEnvironment";
import { FloatingCan } from "./hero/FloatingCan"; // your PRODUCT — swap can for bottle/box/etc
import { WaterSurface } from "./hero/WaterSurface";
import { InteractiveRipples } from "./hero/InteractiveRipples";
import { HeroContent } from "./hero/HeroContent";
import { AmbientEffects } from "./hero/AmbientEffects";
import { PremiumPalmTree } from "./effects/PremiumPalmTree";

/**
 * Coco Love Immersive Hero
 *
 * This is the HEAVIEST hero in the kit — it composes ~8 child components
 * into a layered scroll-reactive scene:
 *
 *   Layer 1: Time-of-day dynamic gradient background (animated)
 *   Layer 2: TropicalEnvironment (palm fronds, islands, sunrays, stars)
 *   Layer 3: AmbientEffects (bubbles, sparkles)
 *   Layer 4: Foreground PremiumPalmTree(s) (mobile only)
 *   Layer 5: WaterSurface — rises on scroll
 *   Layer 6: InteractiveRipples (click/touch)
 *   Layer 7: FloatingCan (the product hero, uses gyroscope on mobile)
 *   Layer 8: HeroContent (typography overlay, fades on scroll)
 *   Layer 9: Scroll indicator
 *
 * The full extraction was not shipped — see NOTES.md for what to build.
 */
const Hero = () => {
  const containerRef = useRef(null);
  const isMobile = useIsMobile();
  const timeTheme = useTimeOfDay();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const waterY = useTransform(scrollYProgress, [0, 1], ["100%", "0%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.5, 1], [1, 0.5, 0]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);

  return (
    <section ref={containerRef}
             className="relative h-screen w-full max-w-[100vw] overflow-x-hidden flex items-center justify-center pt-20 md:pt-24">
      <motion.div className="absolute inset-0 transition-all duration-[2000ms] ease-in-out"
                  style={{ background: timeTheme.background, backgroundSize: "200% 200%" }}
                  animate={{ backgroundPosition: isMobile ? ["0% 50%"] : ["0% 50%", "100% 50%", "0% 50%"] }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }} />

      <TropicalEnvironment timeTheme={timeTheme} />
      <AmbientEffects isMobile={isMobile} timeTheme={timeTheme} />

      {isMobile && (
        <>
          <div className="absolute bottom-28 -left-8 z-20 pointer-events-none scale-[0.7]">
            <PremiumPalmTree size="medium" timeTheme={timeTheme} animationDelay={0.8} />
          </div>
          <div className="absolute bottom-20 -right-12 z-20 pointer-events-none scale-[0.75]">
            <PremiumPalmTree size="medium" timeTheme={timeTheme} animationDelay={1.0} />
          </div>
        </>
      )}

      <motion.div className="absolute inset-0" style={{ y: waterY }}>
        <WaterSurface timeTheme={timeTheme} />
      </motion.div>

      <InteractiveRipples />

      <motion.div className="absolute inset-0 z-10 flex items-center justify-center"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 1 }}>
        <FloatingCan timeTheme={timeTheme} />
      </motion.div>

      <motion.div className="relative z-20 w-full max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-center min-h-screen"
                  style={{ opacity: contentOpacity, y: contentY }}>
        <HeroContent />
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5 }}
                  className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30">
        <motion.div animate={{ y: [0, 10, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    className="flex flex-col items-center gap-2 text-foreground/60 cursor-pointer"
                    onClick={() => window.scrollBy({ top: window.innerHeight, behavior: "smooth" })}>
          <span className="text-sm font-medium">Scroll to explore</span>
          <motion.div className="w-6 h-10 border-2 border-primary/60 rounded-full flex items-start justify-center p-1"
                      whileHover={{ scale: 1.1 }}>
            <motion.div className="w-1.5 h-1.5 bg-primary rounded-full"
                        animate={{ y: [0, 16, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
};

export default Hero;
