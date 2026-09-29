import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * ApproachLightBar — sequenced runway centerline lights.
 * A horizontal strip of LEDs that pulse left-to-right, mimicking
 * approach-light progression. Sits under the sticky Nav.
 */
export const ApproachLightBar = ({ count = 32 }: { count?: number }) => {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex h-1 w-full items-center gap-[3px] overflow-hidden bg-sky-deep/60 px-2"
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="h-0.5 flex-1 rounded-full bg-primary/15"
          style={
            reduced
              ? undefined
              : {
                  animation: `approach-pulse 2.4s ease-in-out infinite`,
                  animationDelay: `${(i / count) * 2.4}s`,
                }
          }
        />
      ))}
      <style>{`
        @keyframes approach-pulse {
          0%, 100% { background-color: hsl(var(--primary) / 0.12); box-shadow: none; }
          25% { background-color: hsl(var(--primary)); box-shadow: 0 0 6px hsl(var(--primary) / 0.9); }
          60% { background-color: hsl(var(--primary) / 0.4); box-shadow: 0 0 2px hsl(var(--primary) / 0.4); }
        }
      `}</style>
    </div>
  );
};
