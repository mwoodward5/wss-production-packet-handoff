import { Phone } from "lucide-react";
import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/track";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  variant?: "primary" | "ghost" | "gold";
  location?: string;
  label?: string;
  showIcon?: boolean;
};

export function CallButton({ className, variant = "primary", location = "header", label, showIcon = true }: Props) {
  const styles =
    variant === "gold"
      ? "bg-gradient-gold text-gold-foreground hover:opacity-95 shadow-glow"
      : variant === "ghost"
        ? "bg-transparent text-foreground hover:bg-muted border border-border"
        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-elegant";

  return (
    <a
      href={`tel:${site.phoneTel}`}
      onClick={() => trackPhoneClick(location)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        styles,
        className,
      )}
    >
      {showIcon && <Phone className="h-4 w-4" />}
      <span>{label ?? site.phone}</span>
    </a>
  );
}
