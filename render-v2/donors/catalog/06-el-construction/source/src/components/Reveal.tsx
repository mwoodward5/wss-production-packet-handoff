import type { ReactNode } from "react";
import { useReveal } from "@/hooks/useReveal";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  delay?: 0 | 1 | 2 | 3 | 4;
  as?: "div" | "section" | "article" | "li";
};

const delayClass = ["", "reveal-d1", "reveal-d2", "reveal-d3", "reveal-d4"];

export function Reveal({ children, className, delay = 0, as: Tag = "div" }: Props) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <Tag
      ref={ref as never}
      className={cn("reveal", delayClass[delay], className)}
    >
      {children}
    </Tag>
  );
}
