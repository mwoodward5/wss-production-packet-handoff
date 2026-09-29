import type { Service } from "@/content/services";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ServiceIcon({ name, className }: { name: Service["icon"]; className?: string }) {
  switch (name) {
    case "screed":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M4 34h40M8 34l4-10h24l4 10" />
          <path {...stroke} d="M14 24V14M34 24V14M14 14h20" />
          <circle cx="12" cy="38" r="3" {...stroke} />
          <circle cx="36" cy="38" r="3" {...stroke} />
          <path {...stroke} d="M4 20h40" strokeDasharray="2 4" />
        </svg>
      );
    case "slab":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M6 30l18-8 18 8-18 8z" />
          <path {...stroke} d="M6 30v6l18 8 18-8v-6" />
          <path {...stroke} d="M14 27v6M24 23v6M34 27v6" />
        </svg>
      );
    case "flat":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M4 38h40" />
          <path {...stroke} d="M8 38l6-18h20l6 18" />
          <path {...stroke} d="M16 28h16M14 33h20" />
        </svg>
      );
    case "stamp":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <rect x="6" y="14" width="36" height="22" rx="2" {...stroke} />
          <path {...stroke} d="M6 22h36M6 30h36M16 14v22M28 14v22" />
          <path {...stroke} d="M20 8h8v6h-8z" />
        </svg>
      );
    case "demo-interior":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M6 40h36" />
          <path {...stroke} d="M10 40V18l14-8 14 8v22" />
          <path {...stroke} d="M18 40V28h12v12" />
          <path {...stroke} d="M30 14l8 14" strokeDasharray="2 3" />
        </svg>
      );
    case "demo-wall":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M6 40h36" />
          <path {...stroke} d="M10 40V14h28v26" />
          <path {...stroke} d="M10 22h28M10 30h28M18 14v26M28 14v26" />
          <path {...stroke} d="M20 6l14 14" />
        </svg>
      );
    case "demo-structure":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden>
          <path {...stroke} d="M4 42h40" />
          <path {...stroke} d="M10 42V20l8-6 8 6v22" />
          <path {...stroke} d="M28 42V26l6-4 6 4v16" />
          <path {...stroke} d="M14 4l6 8M40 8l-4 8" />
        </svg>
      );
  }
}