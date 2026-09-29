import { useSite, serviceHref, ClientService, paragraphs } from "@/wss/bridge";
import { Link } from "react-router-dom";
import { ArrowRight, Phone } from "lucide-react";
import Seo from "@/components/Seo";
import CinemaReel, { ReelFrame } from "@/components/CinemaReel";
import SideRail from "@/components/SideRail";
import Parallax from "@/components/Parallax";
import Faq, { FaqItem } from "@/components/Faq";
import PricingPackages from "@/components/PricingPackages";

export type ReelGroup = { label: string; frames: ReelFrame[] };

interface Props {
  meta: {
    folio: string;
    faqs?: FaqItem[];
    eyebrow: string;
    title: string;
    italicWord: string;
    intro: string;
    longCopy: string[];
    bullets: { title: string; body: string }[];
    heroImg: string;
    heroObjectPosition?: string;
    reels: ReelGroup[];
    seoTitle: string;
    seoDesc: string;
    path: string;
    showPricing?: boolean;
  };
}

export default function ServiceTemplate({ meta }: Props) {
  const {client}=useSite();
  return (
    <>
      <Seo title={meta.seoTitle} description={meta.seoDesc} path={meta.path} />

      {/* HERO */}
      <section className="relative h-[88svh] min-h-[640px] overflow-hidden text-ivory bg-paper">
        <SideRail label={meta.reels[0]?.label || meta.eyebrow} meta={[client.identity.city,client.identity.state]} />
        <Parallax speed={-0.12} className="absolute inset-0">
          <div className="absolute inset-0 cinema-overlay">
            {meta.heroImg && <img src={meta.heroImg} alt={meta.title} className="absolute inset-0 w-full h-full object-cover ken-burns" style={meta.heroObjectPosition ? { objectPosition: meta.heroObjectPosition } : undefined} />}
          </div>
          <div className="absolute inset-0 grain z-[2]" />
        </Parallax>

        <div className="absolute top-32 right-10 z-10 hidden md:block text-right">
          <div className="font-mono text-ivory/50 text-xs tracking-widest">FOLIO</div>
          <div className="font-display text-7xl text-ivory/20 leading-none">{meta.folio}</div>
        </div>

        <div className="container relative z-10 h-full flex flex-col justify-end pb-20">
          <div className="fade-up max-w-5xl">
            <div className="label-eyebrow text-molten mb-6">{meta.eyebrow}</div>
            <h1 className="font-display text-[9.6vw] md:text-[6.4vw] lg:text-[5.6vw] text-ivory leading-[0.9] tracking-[-0.03em] text-balance">
              {meta.title.split(meta.italicWord)[0]}
              <span className="italic text-molten">{meta.italicWord}</span>
              {meta.title.split(meta.italicWord)[1]}
            </h1>
          </div>
        </div>
      </section>

      {/* INTRO */}
      <section className="py-24 md:py-32 bg-paper">
        <div className="container grid md:grid-cols-12 gap-12">
          <div className="md:col-span-5">
            <p className="font-display text-3xl md:text-4xl text-ivory italic leading-snug text-balance">
              {meta.intro}
            </p>
          </div>
          <div className="md:col-span-6 md:col-start-7 space-y-5 text-ivory/70 text-lg leading-relaxed text-pretty">
            {meta.longCopy.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>
      </section>

      {/* CINEMA REELS (one or many — ratios preserved) */}
      {meta.reels.map((r) => (
        <CinemaReel key={r.label} frames={r.frames} reelLabel={r.label} />
      ))}

      {/* BULLETS */}
      {meta.bullets.length > 0 && <section className="py-24 md:py-32 bg-paper-soft border-y border-hairline">
        <div className="container">
          <div className="label-eyebrow text-molten mb-6">What's Included</div>
          <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory leading-[0.92] tracking-tight max-w-3xl mb-16">
            {meta.title}
          </h2>
          <div className="grid md:grid-cols-2 gap-x-16 gap-y-10">
            {meta.bullets.map((b, i) => (
              <div key={b.title} className="border-t border-hairline pt-6">
                <div className="flex items-baseline gap-4 mb-3">
                  <span className="font-mono text-molten text-sm">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="font-display text-2xl text-ivory">{b.title}</h3>
                </div>
                <p className="text-ivory/65 ml-9">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      }
      {/* PRICING & PACKAGES (before FAQ) */}
      {meta.showPricing !== false && <PricingPackages />}

      {/* FAQ */}
      {meta.faqs && meta.faqs.length > 0 && (
        <Faq items={meta.faqs} emitSchema heading="Common questions" eyebrow="FAQ" />
      )}

      {/* CTA */}
      <section className="py-28 bg-paper relative">
        <div className="container text-center max-w-3xl">
          <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory leading-[0.95] tracking-tight">
            Reserve a <span className="italic text-molten">session</span>.
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/reserve" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-white label-eyebrow hover:bg-ivory transition">
              Begin Booking <ArrowRight className="w-4 h-4" />
            </Link>
            <a href={client.identity.phoneTel} className="inline-flex items-center gap-3 px-8 py-4 border border-hairline text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
              <Phone className="w-4 h-4 text-molten" /> {client.identity.phoneDisplay}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

export function CertifiedServicePage({service,index}:{service:ClientService;index:number}){
 const {client,plan}=useSite();
 const rich=plan?.services.find((x:unknown)=>!!x && typeof x==='object' && (x as {name?:string}).name===service.name) as {longDescMd?:string;shortDesc?:string}|undefined;
 const body=paragraphs(typeof rich?.longDescMd==='string'?rich.longDescMd:service.description);
 const intro=body.shift()||service.description;
 return <ServiceTemplate meta={{folio:String(index+2).padStart(3,'0'),eyebrow:service.shortLabel,title:service.name,italicWord:service.name,intro,longCopy:body,bullets:[],heroImg:'',reels:[],seoTitle:`${service.name} · ${client.identity.businessName}`,seoDesc:service.description,path:serviceHref(service,index),showPricing:false}}/>;
}
