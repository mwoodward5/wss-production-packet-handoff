import { cn } from "@/lib/utils";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
};

export function SectionHeading({ eyebrow, title, subtitle, align = "left", tone = "light", className }: Props) {
  const isDark = tone === "dark";
  return (
    <div className={cn(align === "center" && "text-center", "max-w-3xl", align === "center" && "mx-auto", className)}>
      {eyebrow && (
        <div className={cn(
          "mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
          isDark
            ? "border border-white/20 bg-white/10 text-primary-foreground/80 backdrop-blur"
            : "border border-border bg-card text-muted-foreground",
        )}>
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          {eyebrow}
        </div>
      )}
      <h2 className={cn(
        "text-balance text-3xl font-semibold leading-tight md:text-4xl lg:text-5xl",
        isDark && "text-primary-foreground",
      )}>
        {title}
      </h2>
      {subtitle && (
        <p className={cn(
          "mt-4 text-balance text-lg",
          isDark ? "text-primary-foreground/80" : "text-muted-foreground",
        )}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
