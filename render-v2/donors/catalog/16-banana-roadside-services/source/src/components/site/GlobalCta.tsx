import {ClientImage} from "./ClientImage";
import {client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { CallButton } from "./CallButton";
import { ASSETS } from "@/assets/manifest";
import { PHONE_DISPLAY } from "@/data/site";

export function GlobalCta() {
  if(!client.content.ctaHeadline) return null;
  return (
    <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)]">
      <div className="absolute inset-0 -z-10">
        <ClientImage
          src={ASSETS.team_callout.url}
          alt=""
          className="h-full w-full object-cover object-[center_top]"
          style={{ objectPosition: "center 15%" }}
          aria-hidden
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, color-mix(in oklab, var(--asphalt) 82%, transparent) 0%, color-mix(in oklab, var(--asphalt) 45%, transparent) 60%, color-mix(in oklab, var(--asphalt) 22%, transparent) 100%)",
          }}
        />
      </div>
      <div className="mx-auto flex min-h-[640px] max-w-7xl flex-col items-start gap-8 px-4 py-32 text-white sm:px-6 sm:py-40 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
            <span className="sun-pulse size-2 rounded-full bg-[color:var(--banana)]" />
            {client.identity.businessName}
          </span>
          <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">{client.content.ctaHeadline}</h2>
          <p className="mt-5 max-w-xl text-base text-white/85 sm:text-lg">{client.content.ctaBody}</p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <CallButton size="xl" variant="sun" />
          <p className="text-xs text-white/60">
            Direct dial · {PHONE_DISPLAY} {hoursText && ` · ${hoursText}`}
          </p>
        </div>
      </div>
    </section>
  );
}
