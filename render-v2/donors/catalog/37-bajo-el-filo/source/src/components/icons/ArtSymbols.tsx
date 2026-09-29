import type { IconKey } from "@/data/arts";

/**
 * Symbolic marks for each art — a step up from geometric line icons.
 * Each carries a kanji, sigil, or family mark specific to its tradition.
 * Rendered at 64×64 native. currentColor drives stroke; fill is optional.
 */

interface Props { name: IconKey; className?: string; size?: number; accent?: string; }

export function ArtSymbol({ name, className = "", size = 64, accent }: Props) {
  const base = {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };

  const A = accent ?? "currentColor";

  switch (name) {
    case "katana":
      // 剣 kanji reduced + katana silhouette
      return (
        <svg {...base}>
          <text x="32" y="26" fontSize="22" fontFamily="Fraunces, serif" fill={A} textAnchor="middle" opacity="0.9">剣</text>
          <path d="M14 52 L48 30" stroke={A} strokeWidth="1.6" />
          <path d="M46 26 L52 32" stroke={A} strokeWidth="1.6" />
          <circle cx="16" cy="53" r="2" fill={A} />
        </svg>
      );
    case "bujinkan":
      // 武 kanji + concentric
      return (
        <svg {...base}>
          <circle cx="32" cy="32" r="22" opacity="0.35" />
          <circle cx="32" cy="32" r="14" stroke={A} />
          <text x="32" y="38" fontSize="16" fontFamily="Fraunces, serif" fill={A} textAnchor="middle">武</text>
        </svg>
      );
    case "sayoc":
      // Triskele — three-blade fan (Sayoc family template)
      return (
        <svg {...base}>
          <g stroke={A} strokeWidth="1.4">
            <path d="M32 32 L32 10" />
            <path d="M32 32 L50 42" />
            <path d="M32 32 L14 42" />
          </g>
          <circle cx="32" cy="32" r="3" fill={A} />
          <path d="M28 12 L32 8 L36 12" stroke={A} strokeWidth="1.2" />
          <path d="M48 40 L54 44 L52 38" stroke={A} strokeWidth="1.2" />
          <path d="M16 40 L10 44 L12 38" stroke={A} strokeWidth="1.2" />
        </svg>
      );
    case "kampilan":
      // Pekiti-Tirsia — curved bolo silhouette + triangle footwork
      return (
        <svg {...base}>
          <path d="M10 44 Q 22 20 54 12 L 50 20 L 14 48 Z" stroke={A} strokeWidth="1.3" />
          <path d="M14 48 L18 54" stroke={A} />
          <path d="M10 56 L54 56 L32 24 Z" stroke={A} opacity="0.4" strokeWidth="0.8" />
        </svg>
      );
    case "ilustrisimo":
      // Cross-hilt espada
      return (
        <svg {...base}>
          <path d="M32 6 L32 56" stroke={A} strokeWidth="1.6" />
          <path d="M18 20 L46 20" stroke={A} strokeWidth="1.6" />
          <path d="M14 18 L18 22 M46 18 L50 22" stroke={A} />
          <circle cx="32" cy="6" r="2" fill={A} />
          <path d="M28 56 L36 56" stroke={A} strokeWidth="1.8" />
        </svg>
      );
    case "medusa":
      // Serpentine glyph — deception & cognitive break
      return (
        <svg {...base}>
          <path d="M14 54 Q 14 40 32 40 Q 50 40 50 24 Q 50 10 36 10 Q 26 10 26 20" stroke={A} strokeWidth="1.4" />
          <circle cx="38" cy="24" r="2" fill={A} />
          <path d="M12 52 L16 56 M52 22 L48 26" stroke={A} strokeWidth="0.9" />
        </svg>
      );
    case "piper":
      // Piper — rhythmic close-pressure zigzag
      return (
        <svg {...base}>
          <path d="M10 54 Q 18 42 26 50 Q 34 58 42 46 Q 50 34 44 24 Q 38 14 46 8" stroke={A} strokeWidth="1.4" />
          <path d="M46 8 L50 6 M46 8 L44 4" stroke={A} />
          <circle cx="10" cy="54" r="1.6" fill={A} />
        </svg>
      );
    case "longsword":
      // HEMA longsword (Liechtenauer)
      return (
        <svg {...base}>
          <path d="M32 6 L32 44" stroke={A} strokeWidth="1.6" />
          <path d="M20 44 L44 44" stroke={A} strokeWidth="1.6" />
          <path d="M28 44 L28 54 L36 54 L36 44" stroke={A} />
          <circle cx="32" cy="58" r="2" fill={A} />
          <path d="M30 6 L32 2 L34 6" stroke={A} />
        </svg>
      );
    case "compass":
      // Destreza — geometric circle
      return (
        <svg {...base}>
          <circle cx="32" cy="32" r="22" stroke={A} strokeWidth="1.2" />
          <path d="M32 10 L36 32 L32 54 L28 32 Z" fill={A} opacity="0.5" />
          <path d="M10 32 L54 32" stroke={A} opacity="0.6" />
          <circle cx="32" cy="32" r="2" fill={A} />
          <text x="32" y="9" fontSize="4" fill={A} textAnchor="middle" opacity="0.6">N</text>
        </svg>
      );
    case "fiore":
      // Fiore — four animal wheel
      return (
        <svg {...base}>
          <circle cx="32" cy="32" r="20" stroke={A} />
          <circle cx="32" cy="12" r="3.5" fill={A} />
          <circle cx="52" cy="32" r="3.5" fill={A} />
          <circle cx="32" cy="52" r="3.5" fill={A} />
          <circle cx="12" cy="32" r="3.5" fill={A} />
          <path d="M32 15 L32 49 M15 32 L49 32" stroke={A} opacity="0.4" />
        </svg>
      );
    case "combat-sambo":
    case "kurtka":
      // Sambo — Cyrillic С over crossed limbs
      return (
        <svg {...base}>
          <path d="M12 16 L52 48" stroke={A} strokeWidth="1.4" />
          <path d="M52 16 L12 48" stroke={A} strokeWidth="1.4" />
          <circle cx="32" cy="32" r="18" stroke={A} />
          <text x="32" y="38" fontSize="18" fontFamily="Fraunces, serif" fill={A} textAnchor="middle">С</text>
        </svg>
      );
    case "torii":
      return <svg {...base}><path d="M6 16 L58 16 M10 12 L54 12 M14 16 L14 56 M50 16 L50 56 M14 26 L50 26" stroke={A} /></svg>;
    case "wave":
      return <svg {...base}><path d="M4 40 Q 16 28 28 40 T 52 40 T 60 40" stroke={A} /><path d="M4 48 Q 16 36 28 48 T 52 48 T 60 48" stroke={A} opacity="0.6" /></svg>;
    case "sun":
      return <svg {...base}><circle cx="32" cy="32" r="12" stroke={A} /><path d="M32 6 L32 12 M32 52 L32 58 M6 32 L12 32 M52 32 L58 32 M12 12 L16 16 M48 12 L52 16 M12 52 L16 48 M48 52 L52 48" stroke={A} /></svg>;
    case "mat":
      return <svg {...base}><rect x="8" y="18" width="48" height="28" stroke={A} /><path d="M20 18 L20 46 M44 18 L44 46" stroke={A} /></svg>;
    case "mountain":
      return <svg {...base}><path d="M6 52 L24 20 L36 40 L44 28 L58 52 Z" stroke={A} /></svg>;
  }
}
