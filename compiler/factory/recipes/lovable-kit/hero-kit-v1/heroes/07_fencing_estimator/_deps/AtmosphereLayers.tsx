"use client";

import { motion } from "framer-motion";

/**
 * Cinematic atmosphere stack rendered on top of the hero image.
 * All layers are GPU-cheap: transforms + opacity only.
 *
 * Layers, in Z-order:
 *  1. Teal-orange split-tone color grade (mix-blend-soft-light)
 *  2. Cinematic vignette
 *  3. Slow drifting fog A (SVG turbulence, warm)
 *  4. Slow drifting fog B (counter-direction, cooler)
 *  5. Anamorphic light-sweep (crosses every 9s)
 *  6. Floating wood-dust particles (18 sprites, drifting up)
 *  7. Film grain (radial-gradient dots)
 *  8. Letterbox bars top + bottom (cinematic aspect)
 */
export function AtmosphereLayers() {
  return (
    <>
      {/* 1. Split-tone grade */}
      <div className="absolute inset-0 pointer-events-none mix-blend-soft-light"
           style={{ background: "linear-gradient(180deg, rgba(255,170,90,0.35) 0%, rgba(20,30,18,0.0) 45%, rgba(15,35,55,0.45) 100%)" }} />

      {/* 2. Vignette */}
      <div className="absolute inset-0 pointer-events-none"
           style={{ background: "radial-gradient(120% 80% at 50% 45%, transparent 40%, rgba(0,0,0,0.55) 100%)" }} />

      {/* 3. Fog layer A */}
      <motion.div aria-hidden
                  className="absolute -inset-[20%] pointer-events-none opacity-[0.18] mix-blend-screen"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.95  0 0 0 0 0.85  0 0 0 0 0.7  0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
                    backgroundSize: "900px 900px",
                  }}
                  animate={{ x: [0, 60, 0], y: [0, -30, 0] }}
                  transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }} />

      {/* 4. Fog layer B */}
      <motion.div aria-hidden
                  className="absolute -inset-[20%] pointer-events-none opacity-[0.12] mix-blend-screen"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.008' numOctaves='2' seed='9'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 0.9  0 0 0 0 0.75  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
                    backgroundSize: "1200px 1200px",
                  }}
                  animate={{ x: [0, -80, 0], y: [0, 40, 0] }}
                  transition={{ duration: 52, repeat: Infinity, ease: "easeInOut" }} />

      {/* 5. Anamorphic light-sweep */}
      <motion.div aria-hidden
                  className="absolute inset-y-0 pointer-events-none"
                  style={{
                    width: "40%",
                    background: "linear-gradient(105deg, transparent 0%, rgba(255,220,170,0.0) 30%, rgba(255,230,190,0.22) 50%, rgba(255,220,170,0.0) 70%, transparent 100%)",
                    filter: "blur(14px)",
                    mixBlendMode: "screen",
                  }}
                  animate={{ x: ["-60vw", "180vw"] }}
                  transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", repeatDelay: 4 }} />

      {/* 6. Wood-dust particles */}
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 18 }).map((_, i) => {
          const left = (i * 53) % 100;
          const size = 2 + ((i * 7) % 5);
          const dur = 12 + ((i * 3) % 14);
          const delay = (i * 1.3) % 8;
          return (
            <motion.span key={i} className="absolute rounded-full"
                         style={{
                           left: `${left}%`, bottom: "-10px", width: size, height: size,
                           background: "radial-gradient(circle, rgba(255,225,180,0.9) 0%, rgba(255,200,140,0.25) 60%, transparent 100%)",
                           filter: "blur(0.5px)",
                         }}
                         animate={{
                           y: ["0vh", "-110vh"],
                           x: [0, ((i % 2) ? 30 : -30), 0],
                           opacity: [0, 0.9, 0],
                         }}
                         transition={{ duration: dur, repeat: Infinity, delay, ease: "easeInOut" }} />
          );
        })}
      </div>

      {/* 7. Film grain */}
      <div aria-hidden className="absolute inset-0 opacity-[0.06] pointer-events-none mix-blend-overlay"
           style={{
             backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
             backgroundSize: "3px 3px",
           }} />

      {/* 8. Letterbox bars */}
      <div aria-hidden className="absolute top-0 inset-x-0 h-[6vh] pointer-events-none"
           style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.85), transparent)" }} />
      <div aria-hidden className="absolute bottom-0 inset-x-0 h-[10vh] pointer-events-none"
           style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.85), transparent)" }} />
    </>
  );
}
