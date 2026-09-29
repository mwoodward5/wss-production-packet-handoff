import { ReactNode } from "react";

interface Props { children: ReactNode; cite?: string; }
export default function PullQuote({ children, cite }: Props) {
  return (
    <figure className="my-14 border-y border-molten/30 py-10">
      <blockquote className="font-display italic text-3xl md:text-4xl text-ivory leading-snug text-balance">
        "{children}"
      </blockquote>
      {cite && <figcaption className="mt-4 label-eyebrow text-molten/80">— {cite}</figcaption>}
    </figure>
  );
}
