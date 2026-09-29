import type { IconKey } from "@/data/arts";

// Monochrome hairline SVGs, 1.25px stroke, 32×32 base viewBox.
// Rendered in currentColor; parent controls tone.

interface Props { name: IconKey; className?: string; size?: number; }

export function ArtIcon({ name, className = "", size = 32 }: Props) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "katana":
      return (
        <svg {...props}>
          <path d="M4 26 L26 6" />
          <path d="M24 4 L28 8" />
          <circle cx="6" cy="27" r="1.4" />
          <path d="M4 26 L6.5 24.5" />
        </svg>
      );
    case "bujinkan":
      return (
        <svg {...props}>
          <circle cx="16" cy="16" r="10" />
          <path d="M16 6 L18.5 13.5 L26 13.5 L20 18 L22 25.5 L16 21 L10 25.5 L12 18 L6 13.5 L13.5 13.5 Z" />
        </svg>
      );
    case "sayoc":
      return (
        <svg {...props}>
          <path d="M6 26 L16 4 L26 26 Z" />
          <path d="M11 26 L16 15 L21 26" />
          <path d="M16 4 L16 22" />
        </svg>
      );
    case "kampilan":
      return (
        <svg {...props}>
          <path d="M4 22 Q 12 8 28 6 L 26 10 L 6 24 Z" />
          <path d="M4 22 L6 26" />
          <circle cx="5.5" cy="25" r="0.8" />
        </svg>
      );
    case "ilustrisimo":
      return (
        <svg {...props}>
          <path d="M16 4 L16 28" />
          <path d="M8 12 L24 12" />
          <path d="M6 10 L10 14" />
          <path d="M22 10 L26 14" />
          <circle cx="16" cy="4" r="1" />
        </svg>
      );
    case "medusa":
      return (
        <svg {...props}>
          <path d="M8 28 Q 8 20 16 20 Q 24 20 24 12 Q 24 6 18 6 Q 14 6 14 10" />
          <circle cx="18" cy="12" r="1" />
        </svg>
      );
    case "piper":
      return (
        <svg {...props}>
          <path d="M6 26 Q 10 20 14 24 Q 18 28 22 22 Q 26 16 22 12 Q 18 8 22 6" />
          <path d="M22 6 L24 4 M22 6 L20 4" />
        </svg>
      );
    case "longsword":
      return (
        <svg {...props}>
          <path d="M16 2 L16 22" />
          <path d="M10 22 L22 22" />
          <path d="M14 22 L14 27 L18 27 L18 22" />
          <circle cx="16" cy="29" r="1" />
        </svg>
      );
    case "compass":
      return (
        <svg {...props}>
          <circle cx="16" cy="16" r="11" />
          <path d="M16 6 L18 16 L16 26 L14 16 Z" />
          <path d="M6 16 L26 16" />
          <circle cx="16" cy="16" r="1" />
        </svg>
      );
    case "fiore":
      return (
        <svg {...props}>
          <circle cx="16" cy="16" r="10" />
          <circle cx="16" cy="8" r="2" />
          <circle cx="24" cy="16" r="2" />
          <circle cx="16" cy="24" r="2" />
          <circle cx="8" cy="16" r="2" />
        </svg>
      );
    case "kurtka":
      return (
        <svg {...props}>
          <path d="M8 6 L16 10 L24 6 L26 26 L6 26 Z" />
          <path d="M16 10 L16 26" />
          <path d="M12 14 L20 14" />
        </svg>
      );
    case "combat-sambo":
      return (
        <svg {...props}>
          <path d="M6 8 L26 26" />
          <path d="M26 8 L6 26" />
          <circle cx="16" cy="17" r="9" />
        </svg>
      );
    case "torii":
      return (
        <svg {...props}>
          <path d="M4 8 L28 8" />
          <path d="M6 6 L26 6" />
          <path d="M9 8 L9 26" />
          <path d="M23 8 L23 26" />
          <path d="M9 13 L23 13" />
        </svg>
      );
    case "wave":
      return (
        <svg {...props}>
          <path d="M2 20 Q 8 14 14 20 T 26 20 T 30 20" />
          <path d="M2 24 Q 8 18 14 24 T 26 24 T 30 24" opacity="0.6" />
        </svg>
      );
    case "sun":
      return (
        <svg {...props}>
          <circle cx="16" cy="16" r="6" />
          <path d="M16 3 L16 6 M16 26 L16 29 M3 16 L6 16 M26 16 L29 16 M6 6 L8 8 M24 6 L26 8 M6 26 L8 24 M24 26 L26 24" />
        </svg>
      );
    case "mat":
      return (
        <svg {...props}>
          <rect x="4" y="9" width="24" height="14" />
          <path d="M10 9 L10 23 M22 9 L22 23" />
        </svg>
      );
    case "mountain":
      return (
        <svg {...props}>
          <path d="M3 26 L12 10 L18 20 L22 14 L29 26 Z" />
        </svg>
      );
  }
}
