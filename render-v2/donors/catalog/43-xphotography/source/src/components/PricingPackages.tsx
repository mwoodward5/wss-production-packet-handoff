import { Check, MessageSquare } from "lucide-react";

type Pkg = {
  name: string;
  duration: string;
  price: string;
  priceNote?: string;
  includes: string[];
  smsLabel: string;
  smsBody: string;
};

// Deliberately empty: CSD and rich-plan references do not define certified package fields.
const packages: Pkg[] = [];
const smsHref = (_body:string) => '';

export default function PricingPackages() {
  if (!packages.length) return null;
  return (
    <section className="bg-paper-soft py-24 md:py-32 border-y border-hairline">
      <div className="container max-w-6xl">
        <div className="text-center mb-12">
          <div className="label-eyebrow text-molten mb-4">Pricing & Packages</div>
          <h2 className="font-display text-[2.025rem] md:text-[3.375rem] text-ivory leading-[0.95] tracking-tight text-balance">
            Pricing & <span className="italic text-molten">Packages</span>
          </h2>
          <p className="mt-6 text-ivory/70 text-lg max-w-2xl mx-auto text-pretty">
            
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {packages.map((p) => (
            <div
              key={p.name}
              className="bg-paper border border-hairline p-8 md:p-10 flex flex-col"
            >
              <div className="label-eyebrow text-molten mb-2">{p.name}</div>
              <h3 className="font-display text-3xl text-ivory mb-6">
                {p.duration}
              </h3>
              <div className="divider-gold mb-6" />

              <div className="label-eyebrow text-ivory/55 mb-3">Includes</div>
              <ul className="space-y-3 mb-8 flex-1">
                {p.includes.map((inc) => (
                  <li key={inc} className="flex items-start gap-3 text-ivory/85">
                    <Check className="w-4 h-4 text-molten mt-1 shrink-0" />
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>

              <div className="mb-6">
                {p.price && (
                  <div className="font-display text-5xl text-ivory leading-none">
                    {p.price}
                  </div>
                )}
                {p.priceNote && (
                  <div className="label-eyebrow text-ivory/60 mt-2">{p.priceNote}</div>
                )}
              </div>

              <a
                href={smsHref(p.smsBody)}
                className="inline-flex items-center justify-center gap-2 px-6 py-4 bg-molten text-white label-eyebrow hover:bg-ivory transition"
              >
                <MessageSquare className="w-4 h-4" />
                {p.smsLabel}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
