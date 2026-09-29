import { Building2 } from "lucide-react";
import { useLiveIdentity } from "@/lib/wssc";

/**
 * The donor's own logo image never ships — a logo is identity. The mark is the
 * client's own logo ({{LOGO_URL}} / island facts.logo_url) when the engine
 * placed one, and the design's gold monogram badge with the business wordmark
 * otherwise.
 */
export function Logo({
  variant = "header",
  className = "",
}: {
  variant?: "header" | "footer";
  className?: string;
}) {
  const id = useLiveIdentity();
  const size = variant === "header" ? "h-10" : "h-9";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {id.logoUrl ? (
        <img
          src={id.logoUrl}
          alt={`${id.businessName} logo`}
          width={40}
          height={40}
          className={`${size} w-auto rounded-md object-contain`}
        />
      ) : (
        <span
          className={`grid ${variant === "header" ? "h-10 w-10" : "h-9 w-9"} place-items-center rounded-lg bg-gradient-gold text-gold-foreground`}
          aria-hidden="true"
        >
          <Building2 className="h-5 w-5" />
        </span>
      )}
      <span className="font-display text-lg font-semibold tracking-tight">
        {id.businessName}
      </span>
    </div>
  );
}
