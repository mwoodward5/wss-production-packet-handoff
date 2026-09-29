import { useState } from "react";
import { site, client } from "@/lib/site";

export function Logo({
  variant = "header",
  className = "",
}: {
  variant?: "header" | "footer";
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const size =
    variant === "header"
      ? "w-[132px] sm:w-[145px] lg:w-[170px]"
      : "w-[210px] sm:w-[230px]";

  if (errored) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="grid h-10 w-10 place-items-center rounded-md bg-gradient-gold text-gold-foreground font-display font-bold">
          {site.name.slice(0,1)}
        </span>
        <span className="font-display text-lg font-semibold">{site.name}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={client.identity.logoOnDark}
        alt={`${site.legalName} logo`}
        width={1522}
        height={702}
        className={`${size} h-auto object-contain`}
        onError={() => setErrored(true)}
      />
    </div>
  );
}
