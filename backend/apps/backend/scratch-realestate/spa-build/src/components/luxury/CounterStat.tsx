import { useEffect, useState } from "react";
import { useReveal } from "@/hooks/useReveal";

interface CounterStatProps {
  end: number;
  prefix?: string;
  suffix?: string;
  label: string;
  duration?: number;
}

export default function CounterStat({ end, prefix = "", suffix = "", label, duration = 2000 }: CounterStatProps) {
  const { ref, revealed } = useReveal(0.3);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!revealed) return;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * end));
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [revealed, end, duration]);

  return (
    <div ref={ref}>
      <p className="font-display text-4xl md:text-5xl font-medium text-charcoal">
        {prefix}{count}{suffix}
      </p>
      <p className="font-body text-xs tracking-editorial uppercase text-muted-foreground mt-2">{label}</p>
    </div>
  );
}
