import { Phone, MessageSquare, Tag, ShieldCheck, CreditCard, Sparkles } from "lucide-react";
import { business } from "@/data/business";
import { OpenNowPill } from "./OpenNowPill";
import { ProofTicker } from "./ProofTicker";
import { HeroQuickAction } from "@/components/widgets/HeroQuickAction";
import {client} from "@/wss/bridge";
import {HeroMedia} from "@/wss/HeroMedia";



export function HeroHome() {
  return (
    <section className="relative isolate overflow-hidden bg-navy-deep text-white">
      {/* Single editorial hero photo. The right ~30% of the source image is a soft
          navy gradient — UI sits on calm pixels, not faces or floor. */}
      <HeroMedia />
      {/* Bottom-to-top + left scrim for legibility of the headline copy */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,18,38,0.78)_0%,rgba(10,18,38,0.55)_45%,rgba(10,18,38,0.35)_100%)] md:bg-[linear-gradient(100deg,rgba(10,18,38,0.92)_0%,rgba(10,18,38,0.72)_42%,rgba(10,18,38,0.18)_70%,rgba(10,18,38,0.55)_100%)]"
      />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.05fr_1fr] md:gap-12 md:py-20 lg:py-24">
        {/* LEFT — headline column */}
        <div>
          {/* Ribbon moved out of the widget overlap zone — now anchored to copy column */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            {client.content.seasonalNote && <span className="ribbon-deal rounded-xl px-3 py-1.5 text-xs">{client.content.seasonalNote}</span>}
            <span className="chip-glass">
              <Sparkles className="h-3.5 w-3.5 text-brand-glow" /> {client.hero.eyebrow}
            </span>
            <OpenNowPill className="!bg-white/10 !text-white !border-white/20" />
          </div>

          <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-white md:text-6xl lg:text-[4.4rem]">
            {client.hero.line1}
            <br />
            <span className="italic font-medium text-white/90">{client.hero.emphasis}</span>
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-cta)" }}
            >
              {client.hero.line3}
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-white/90">
            {client.hero.support}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`tel:${business.telephone}`}
              data-event="click_call"
              className="btn-glow btn-beam inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-extrabold"
            >
              <Phone className="h-5 w-5" /> Call <span className="tabnum">{business.displayPhone}</span>
            </a>
            <a
              href={business.smsHref}
              data-event="click_sms"
              className="glass-dark inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-base font-bold text-white transition hover:bg-white/15"
            >
              <MessageSquare className="h-5 w-5" /> Text the showroom
            </a>
          </div>

          {client.trust.badges.length>0 && <ul className="mt-7 grid gap-2 text-sm text-white/85 sm:grid-cols-3">{client.trust.badges.map(b=><li key={b.label} className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-glow"/>{b.label}</li>)}</ul>}

          <div className="mt-6">
            <ProofTicker />
          </div>
        </div>

        {/* RIGHT — widget sits over the calm navy fade-to-dark side of the photo */}
        <div className="relative">
          <HeroQuickAction />
        </div>
      </div>
    </section>
  );
}
