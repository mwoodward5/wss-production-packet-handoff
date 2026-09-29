import { BrandMark } from "./BrandMark";

export function Wordmark({
  size = 34,
  shimmer = true,
}: {
  size?: number;
  shimmer?: boolean;
}) {
  return (
    <span className="group inline-flex items-center gap-3 leading-none">
      <BrandMark size={size} className="text-edge stamp-in" />
      <span className="leading-none">
        <span
          className={`block font-serif text-[17px] tracking-tight text-bone ${
            shimmer ? "brand-shimmer" : ""
          }`}
        >
          Bajo El Filo
        </span>
        <span className="eyebrow mt-1 block text-[9px] text-bone-dim">
          Under the Edge · Rami
        </span>
      </span>
    </span>
  );
}
