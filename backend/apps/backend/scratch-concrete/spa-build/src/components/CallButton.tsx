import { Link } from "@tanstack/react-router";
import { Phone, FileText } from "lucide-react";
import { trackPhoneClick } from "@/lib/track";
import { cn } from "@/lib/utils";
import { useLiveIdentity } from "@/lib/wssc";

type Props = {
  className?: string;
  variant?: "primary" | "ghost" | "gold";
  location?: string;
  label?: string;
  showIcon?: boolean;
};

/**
 * PHONE IS OPTIONAL — a blank takes the WHOLE construct with it.
 * With a phone: a dialable gold CTA exactly as designed.
 * Without one: the same button real estate becomes the estimate route, so the
 * mirror still converts (the lead form inherits the primary action).
 */
export function CallButton({ className, variant = "primary", location = "header", label, showIcon = true }: Props) {
  const id = useLiveIdentity();

  const styles =
    variant === "gold"
      ? "bg-gradient-gold text-gold-foreground hover:opacity-95 shadow-glow"
      : variant === "ghost"
        ? "bg-transparent text-foreground hover:bg-muted border border-border"
        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-elegant";

  const base = cn(
    "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5",
    styles,
    className,
  );

  if (id.phone) {
    const digits = id.phoneDigits.replace(/\D/g, "").replace(/^1/, "");
    return (
      <a
        href={`tel:${digits ? `+1${digits}` : id.phone}`}
        onClick={() => trackPhoneClick(location)}
        className={base}
      >
        {showIcon && <Phone className="h-4 w-4" />}
        <span>{label ?? id.phone}</span>
      </a>
    );
  }

  return (
    <Link to="/contact" className={base} onClick={() => trackPhoneClick(location)}>
      {showIcon ? <FileText className="h-4 w-4" /> : null}
      <span>{label ?? "Get an Estimate"}</span>
    </Link>
  );
}
