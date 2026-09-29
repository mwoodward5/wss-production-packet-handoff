import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  aspect?: string;
  seal?: string;
  variant?: "vertical" | "landscape";
  maskCorners?: Array<"tl" | "tr" | "bl" | "br" | "center">;
}

/**
 * Hanging-scroll frame with real papyrus depth. Warm parchment bands with
 * torn deckle edges flank the media; a turned wooden dowel with brass end-
 * caps sits along the outer edge. Overflow-visible outer padding so the
 * dowels and torn edges never clip.
 */
export function ScrollFrame({
  children,
  className = "",
  aspect = "9/16",
  seal = "刃",
  variant = "vertical",
  maskCorners,
}: Props) {
  const isLandscape = variant === "landscape";
  const outerPad = isLandscape ? "px-6" : "py-6";

  return (
    <div className={`relative isolate ${outerPad} ${className}`}>
      <div
        className="relative"
        style={{
          aspectRatio: aspect,
          filter: "drop-shadow(0 30px 50px rgba(0,0,0,.5))",
        }}
      >
        {/* Papyrus bands */}
        {isLandscape ? (
          <>
            <PapyrusBand side="left" />
            <PapyrusBand side="right" />
          </>
        ) : (
          <>
            <PapyrusBand side="top" />
            <PapyrusBand side="bottom" />
          </>
        )}

        {/* Media well */}
        <div
          className="absolute overflow-hidden bg-ink-2"
          style={{
            inset: isLandscape ? "0 32px" : "32px 0",
            boxShadow:
              "inset 0 0 0 1px color-mix(in oklab, var(--edge) 30%, transparent), inset 0 20px 30px -20px rgba(0,0,0,.7), inset 0 -20px 30px -20px rgba(0,0,0,.7)",
          }}
        >
          <div
            className="absolute inset-0"
            style={{ filter: "contrast(1.08) saturate(0.85) sepia(0.05)" }}
          >
            {children}
          </div>

          {maskCorners?.map((c) => <CornerMask key={c} corner={c} />)}

          {/* Vignette */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%)",
              mixBlendMode: "multiply",
            }}
          />
          {/* Grain */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.09]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.9 0 0 0 0 0.85 0 0 0 0 0.75 0 0 0 0.55 0'/></filter><rect width='120' height='120' filter='url(%23n)'/></svg>\")",
              mixBlendMode: "overlay",
            }}
          />

          {/* Hand-stamped ink chop */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 grid h-9 w-9 place-items-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              color: "#e8dcb8",
              background: "radial-gradient(circle at 30% 30%, #7c2a1c 0%, #5a1810 55%, #3d1008 100%)",
              boxShadow: "inset 0 0 6px rgba(0,0,0,.5), 0 2px 4px rgba(0,0,0,.4)",
              clipPath: "polygon(6% 3%, 96% 0%, 100% 94%, 92% 100%, 3% 97%, 0% 8%)",
              transform: "rotate(-3deg)",
              opacity: 0.92,
            }}
          >
            {seal}
          </div>
        </div>
      </div>
    </div>
  );
}

const PAPYRUS_BG = `
  linear-gradient(180deg, rgba(120,80,20,0.12), rgba(120,80,20,0.12)),
  linear-gradient(90deg,
    #d4bc7c 0%, #e6d29e 12%, #dbc487 32%, #e8d5a2 50%,
    #d1b876 70%, #e6d29e 88%, #b89960 100%)
`;

function PapyrusBand({ side }: { side: "top" | "bottom" | "left" | "right" }) {
  const horizontal = side === "top" || side === "bottom";
  // Band sits inset from media edge and past the dowel
  const bandStyle: React.CSSProperties = horizontal
    ? { left: -6, right: -6, height: 42, [side]: -8 }
    : { top: -6, bottom: -6, width: 42, [side]: -8 };

  // Deckle edge — torn paper cut via clip-path
  const deckle =
    side === "top"
      ? "polygon(0 0, 100% 0, 100% 60%, 98% 68%, 95% 62%, 92% 70%, 88% 63%, 84% 71%, 80% 64%, 75% 72%, 70% 65%, 65% 73%, 60% 66%, 55% 74%, 50% 66%, 45% 74%, 40% 66%, 35% 73%, 30% 65%, 25% 72%, 20% 64%, 15% 71%, 10% 63%, 5% 70%, 0 62%)"
      : side === "bottom"
      ? "polygon(0 38%, 5% 30%, 10% 37%, 15% 29%, 20% 36%, 25% 28%, 30% 35%, 35% 27%, 40% 34%, 45% 26%, 50% 34%, 55% 26%, 60% 34%, 65% 27%, 70% 35%, 75% 28%, 80% 36%, 85% 29%, 90% 37%, 95% 30%, 100% 38%, 100% 100%, 0 100%)"
      : side === "left"
      ? "polygon(0 0, 60% 0, 68% 5%, 62% 10%, 70% 15%, 63% 20%, 71% 25%, 64% 30%, 72% 35%, 65% 40%, 73% 45%, 66% 50%, 73% 55%, 65% 60%, 72% 65%, 64% 70%, 71% 75%, 63% 80%, 70% 85%, 62% 90%, 68% 95%, 60% 100%, 0 100%)"
      : "polygon(40% 0, 100% 0, 100% 100%, 40% 100%, 32% 95%, 38% 90%, 30% 85%, 37% 80%, 29% 75%, 36% 70%, 28% 65%, 35% 60%, 27% 55%, 34% 50%, 27% 45%, 35% 40%, 28% 35%, 36% 30%, 29% 25%, 37% 20%, 30% 15%, 38% 10%, 32% 5%)";

  const dowelPos: React.CSSProperties = horizontal
    ? {
        left: -8,
        right: -8,
        height: 14,
        [side]: 6,
      }
    : {
        top: -8,
        bottom: -8,
        width: 14,
        [side]: 6,
      };

  const capSize = 20;

  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ ...bandStyle, zIndex: 2 }}>
      {/* Papyrus paper */}
      <div
        className="absolute inset-0"
        style={{
          background: PAPYRUS_BG,
          clipPath: deckle,
          boxShadow: horizontal
            ? side === "top"
              ? "inset 0 -6px 10px -4px rgba(60,40,10,.5)"
              : "inset 0 6px 10px -4px rgba(60,40,10,.5)"
            : side === "left"
            ? "inset -6px 0 10px -4px rgba(60,40,10,.5)"
            : "inset 6px 0 10px -4px rgba(60,40,10,.5)",
        }}
      >
        {/* Fiber grain */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='" +
              (horizontal ? "0.02 0.9" : "0.9 0.02") +
              "' numOctaves='2'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.6'/></svg>\")",
            mixBlendMode: "multiply",
          }}
        />
      </div>

      {/* Dowel — turned wood */}
      <div
        className="absolute"
        style={{
          ...dowelPos,
          background: horizontal
            ? "linear-gradient(180deg, #f4e5b8 0%, #c9a860 22%, #6b4416 55%, #c9a860 82%, #8a6a2e 100%)"
            : "linear-gradient(90deg, #f4e5b8 0%, #c9a860 22%, #6b4416 55%, #c9a860 82%, #8a6a2e 100%)",
          borderRadius: horizontal ? "7px / 50%" : "50% / 7px",
          boxShadow: "inset 0 0 3px rgba(0,0,0,.4), 0 3px 6px rgba(0,0,0,.4)",
        }}
      >
        {/* End caps */}
        <div
          className="absolute"
          style={{
            ...(horizontal
              ? { left: -capSize / 2, top: -3, width: capSize, height: 20 }
              : { top: -capSize / 2, left: -3, width: 20, height: capSize }),
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #f6ead0, #b8892f 55%, #3a2408 100%)",
            boxShadow: "0 2px 6px rgba(0,0,0,.55)",
          }}
        />
        <div
          className="absolute"
          style={{
            ...(horizontal
              ? { right: -capSize / 2, top: -3, width: capSize, height: 20 }
              : { bottom: -capSize / 2, left: -3, width: 20, height: capSize }),
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #f6ead0, #b8892f 55%, #3a2408 100%)",
            boxShadow: "0 2px 6px rgba(0,0,0,.55)",
          }}
        />
      </div>
    </div>
  );
}

function CornerMask({ corner }: { corner: "tl" | "tr" | "bl" | "br" | "center" }) {
  const map: Record<string, React.CSSProperties> = {
    tl: { top: 0, left: 0, width: "22%", height: "14%" },
    tr: { top: 0, right: 0, width: "22%", height: "14%" },
    bl: { bottom: 0, left: 0, width: "48%", height: "10%" },
    br: { bottom: 0, right: 0, width: "22%", height: "14%" },
    center: { top: "38%", left: "34%", width: "32%", height: "22%" },
  };
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        ...map[corner],
        background: "radial-gradient(ellipse at center, rgba(8,6,4,0.98) 30%, rgba(8,6,4,0.85) 65%, rgba(8,6,4,0) 100%)",
        mixBlendMode: "multiply",
      }}
    />
  );
}
