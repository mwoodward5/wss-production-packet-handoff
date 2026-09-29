import { BrandMark } from "./brand/BrandMark";

export function ChapterMark({
  n,
  variant = "numeral",
  onLight = false,
}: {
  n: string;
  variant?: "numeral" | "seal";
  onLight?: boolean;
}) {
  if (variant === "seal") {
    return (
      <span className="inline-flex items-center gap-2">
        <BrandMark onLight={onLight} size={16} withSeal={false} className="text-edge" />
        <span className="chapter-mark">— {n} —</span>
      </span>
    );
  }
  return <span className="chapter-mark">— {n} —</span>;
}

export function Epigraph({
  text,
  credit,
  align = "left",
}: {
  text: string;
  credit: string;
  align?: "left" | "center";
}) {
  if (!text || !credit) return null;
  return (
    <blockquote className={`max-w-xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <p className="epigraph">"{text}"</p>
      <footer className="eyebrow mt-3 text-edge">{credit}</footer>
    </blockquote>
  );
}
