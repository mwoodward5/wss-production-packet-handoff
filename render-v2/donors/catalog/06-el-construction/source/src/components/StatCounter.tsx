import { useCountUp } from "@/hooks/useCountUp";

type Props = {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
};

export function StatCounter({ value, suffix = "", prefix = "", label }: Props) {
  const [n, ref] = useCountUp(value);
  return (
    <div ref={ref as never} className="text-center">
      <div className="font-display text-5xl font-semibold leading-none tracking-tight md:text-6xl">
        {prefix}
        {n}
        <span className="text-gold">{suffix}</span>
      </div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
