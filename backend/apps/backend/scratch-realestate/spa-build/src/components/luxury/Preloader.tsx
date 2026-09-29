import { useEffect, useState } from "react";
import { fact } from "@/lib/facts";

const BUSINESS_NAME = fact("BUSINESS_NAME");
const LOGO_URL = fact("LOGO_URL");

const SPARKLE_COUNT = 8;

// Sanitized from the source design: the donor's brand mark and name are gone.
// The drawn gold ring stays; the centre renders the CLIENT's verified logo
// when the engine placed one, else a gold diamond glyph; the label renders the
// client's business name. Timings are shortened from the source (2500/3300ms)
// so an engine proof shot never captures the loading state.
export default function Preloader() {
  const [phase, setPhase] = useState<"loading" | "reveal" | "done">("loading");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("reveal"), 1100);
    const t2 = setTimeout(() => setPhase("done"), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-charcoal transition-all duration-700 ${
        phase === "reveal" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-10 relative">
        {/* Radial gold glow */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, hsl(var(--gold) / 0.12) 0%, transparent 70%)",
            animation: "pulse-glow 2.5s ease-in-out infinite",
          }}
        />

        {/* Drawing ring */}
        <div className="relative w-28 h-28 md:w-32 md:h-32 flex items-center justify-center">
          <svg
            className="absolute -inset-6 w-[calc(100%+48px)] h-[calc(100%+48px)]"
            viewBox="0 0 200 200"
          >
            <circle
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke="hsl(var(--gold))"
              strokeWidth="0.5"
              strokeDasharray="565"
              strokeDashoffset="565"
              className="preloader-ring"
              opacity="0.4"
            />
          </svg>

          {LOGO_URL ? (
            <img
              src={LOGO_URL}
              alt={BUSINESS_NAME}
              className={`max-w-full max-h-full object-contain relative z-10 transition-all duration-700 ${
                phase === "loading" ? "opacity-100 scale-100" : "opacity-0 scale-110"
              }`}
            />
          ) : (
            <span
              aria-hidden
              className={`font-display text-4xl text-gold relative z-10 transition-all duration-700 ${
                phase === "loading" ? "opacity-100 scale-100" : "opacity-0 scale-110"
              }`}
            >
              ◆
            </span>
          )}
        </div>

        {/* Floating sparkles */}
        {Array.from({ length: SPARKLE_COUNT }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-gold/40"
            style={{
              left: `${30 + Math.random() * 40}%`,
              top: `${20 + Math.random() * 60}%`,
              animation: `float ${3 + Math.random() * 3}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}

        <div className="w-16 h-px bg-gold/60 preloader-line" />
        <p className="font-body text-[10px] tracking-[0.4em] uppercase text-gold/50">
          {BUSINESS_NAME}
        </p>
      </div>
    </div>
  );
}
