import {ClientImage} from "./ClientImage";
import {client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHONE_DISPLAY, PHONE_TEL } from "@/data/site";

type Props = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "sun" | "asphalt" | "outline";
  label?: string;
  ariaLabel?: string;
};

const sizeMap = {
  sm: "h-12 px-4 text-sm gap-2",
  md: "h-12 px-5 text-[15px] gap-2",
  lg: "h-14 px-7 text-base gap-3",
  xl: "h-16 px-9 text-lg gap-3",
};

export function CallButton({
  className,
  size = "md",
  variant = "sun",
  label,
  ariaLabel,
}: Props) {
  const base =
    "group inline-flex items-center justify-center rounded-full font-semibold tracking-tight transition-all duration-200 will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:-translate-y-0.5 active:translate-y-0";
  const variants = {
    sun: "bg-[image:var(--gradient-sun)] text-[color:var(--asphalt)] shadow-[var(--shadow-sun)] hover:shadow-[0_18px_40px_-12px_color-mix(in_oklab,var(--banana-deep)_70%,transparent)]",
    asphalt:
      "bg-[image:var(--gradient-asphalt)] text-white shadow-[var(--shadow-lift)] hover:brightness-110",
    outline:
      "border-2 border-foreground/20 text-foreground hover:border-foreground/40 hover:bg-foreground/[0.04]",
  } as const;

  return (
    <a
      href={`tel:${PHONE_TEL}`}
      aria-label={ariaLabel ?? `Call ${client.identity.businessName} at ${PHONE_DISPLAY}`}
      className={cn(base, sizeMap[size], variants[variant], className)}
      data-call-cta
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full p-1.5",
          variant === "sun" ? "bg-[color:var(--asphalt)]/10" : "bg-white/10",
        )}
      >
        <Phone className="size-4" strokeWidth={2.5} />
      </span>
      <span className="whitespace-nowrap">
        {label ?? `Call ${PHONE_DISPLAY}`}
      </span>
    </a>
  );
}
