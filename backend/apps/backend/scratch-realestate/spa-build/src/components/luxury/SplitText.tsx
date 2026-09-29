import { useReveal } from "@/hooks/useReveal";

interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  mode?: "char" | "word";
}

export default function SplitText({ text, className = "", delay = 0, as: Tag = "span", mode = "char" }: SplitTextProps) {
  const { ref, revealed } = useReveal(0.1);

  const items = mode === "word" ? text.split(" ") : text.split("");
  const delayStep = mode === "word" ? 0.08 : 0.03;

  return (
    <Tag ref={ref as never} className={`inline ${className}`}>
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-block transition-all duration-500"
          style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? "translateY(0) rotateX(0)" : "translateY(100%) rotateX(-80deg)",
            transitionDelay: `${delay + i * delayStep}s`,
          }}
        >
          {mode === "word" ? (
            <>{item}{i < items.length - 1 ? " " : ""}</>
          ) : (
            item === " " ? " " : item
          )}
        </span>
      ))}
    </Tag>
  );
}
