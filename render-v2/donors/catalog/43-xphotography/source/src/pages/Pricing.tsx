import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import Seo from "@/components/Seo";
import SideRail from "@/components/SideRail";

import {useSite} from "@/wss/bridge";

export default function Pricing() {
 const {client}=useSite();
 const tiers=client.services.map((s,i)=>({name:s.name,folio:String(i+1),desc:s.description,points:[] as string[],cta:'Ask about pricing',featured:false}));
  return (
    <>
      <Seo title={`Pricing · ${client.identity.businessName}`}
        description={client.content.serviceIntro}
        path="/pricing" />

      <section className="relative pt-44 pb-12 bg-paper overflow-hidden">
        <SideRail label="PRICING · 008" />
        <div className="container max-w-6xl">
          <div className="label-eyebrow text-molten mb-6">Folio 008 · Investment</div>
          <h1 className="font-display text-[11.2vw] md:text-[7.2vw] lg:text-[6.4vw] text-ivory leading-[0.88] tracking-[-0.04em] text-balance">
            <span className="italic text-molten">Pricing</span> inquiries.
          </h1>
          <p className="mt-8 max-w-2xl text-ivory/70 text-lg">
            Contact {client.identity.businessName} to ask about pricing.
          </p>
        </div>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <div className="container grid md:grid-cols-3 gap-6 lg:gap-10">
          {tiers.map((t) => (
            <div key={t.name} className={`relative p-10 border ${t.featured ? "border-molten bg-paper-soft" : "border-ivory/15 bg-paper-soft/60"}`}>
              {t.featured && <div className="absolute -top-3 left-10 px-3 py-1 bg-molten text-ink label-eyebrow">Most Booked</div>}
              <div className="font-mono text-molten text-sm mb-3">FOLIO {t.folio}</div>
              <h3 className="font-display text-4xl text-ivory mb-3">{t.name}</h3>
              <p className="text-ivory/65 mb-8 text-pretty">{t.desc}</p>
              <ul className="space-y-3 mb-10">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-3 text-sm text-ivory/80">
                    <Check className="w-4 h-4 text-molten flex-shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
              <Link to="/reserve" className="inline-flex items-center gap-2 label-eyebrow text-molten border-b border-molten pb-1 hover:gap-4 transition-all">
                {t.cta} <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="py-28 bg-paper-soft border-t border-ivory/10">
        <div className="container max-w-3xl text-center">
          <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory leading-[0.95] tracking-tight mb-6">
            Tell me about your <span className="italic text-molten">date</span>.
          </h2>
          <p className="text-ivory/70 mb-10">Use the inquiry form or call {client.identity.phoneDisplay}.</p>
          <Link to="/reserve" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">
            Begin Booking <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
