import { Link } from "react-router-dom";
import { ArrowRight, Phone, Mail } from "lucide-react";
import Seo from "@/components/Seo";
import CinemaReel from "@/components/CinemaReel";
import Marquee from "@/components/Marquee";
import Monogram from "@/components/Monogram";
import SideRail from "@/components/SideRail";
import Parallax from "@/components/Parallax";
import PricingPackages from "@/components/PricingPackages";
import { useSite, serviceHref, frames, paragraphs } from "@/wss/bridge";
import HeroMedia from "@/wss/HeroMedia";
import Faq from "@/components/Faq";

export default function Home() {
  const {client}=useSite();
  const featuredFrames=frames();
  const services=client.services.map((s,i)=>({label:s.shortLabel,title:s.name,to:serviceHref(s,i),copy:s.description}));
  const proof=client.trust.reviews.slice(0,4).map(r=>({line:r.text,attribution:r.author}));
  return (
    <>
      <Seo
        title={client.identity.businessName}
        description={client.hero.support}
        path="/"
      />

      {/* COLD OPEN HERO */}
      <section className="relative h-[100svh] min-h-[720px] w-full overflow-hidden bg-paper text-ivory">
        <SideRail label="REEL 01 · INDEX" meta={[client.identity.city, client.identity.state]} side="left" />
        <SideRail label="PHOTOGRAPHY" meta={[]} side="right" />

        <Parallax speed={-0.15} className="absolute inset-0">
          <div className="absolute inset-0 cinema-overlay">
            <HeroMedia />
          </div>
          <div className="absolute inset-0 grain z-[2]" />
        </Parallax>

        <div className="absolute top-28 right-10 z-10 hidden md:block text-right">
          <div className="font-mono text-ivory/50 text-xs tracking-widest">FOLIO</div>
          <div className="font-display text-7xl text-ivory/20 leading-none">001</div>
        </div>

        <div className="container relative z-10 h-full flex flex-col justify-end pb-20 md:pb-28">
          <div className="fade-up max-w-6xl">
            <div className="flex items-center gap-4 mb-8">
              <Monogram size={40} animated />
              <span className="label-eyebrow text-molten">{client.hero.eyebrow}</span>
            </div>
            <h1 className="font-display text-[9.6vw] md:text-[7.2vw] lg:text-[6.4vw] text-ivory leading-[0.88] tracking-[-0.04em] text-balance relative">
              <span className="block relative">
                {client.hero.line1}
              </span>
              <span className="block relative">
                <span className="relative inline-flex items-baseline gap-[0.18em]">
                  <svg viewBox="0 0 100 100" className="aperture-spin inline-block w-[0.9em] h-[0.9em] -mb-[0.04em] translate-y-[0.06em]" aria-hidden>
                    <defs>
                      <linearGradient id="hero-ap" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="hsl(45, 95%, 60%)" />
                        <stop offset="100%" stopColor="hsl(28, 70%, 38%)" />
                      </linearGradient>
                    </defs>
                    <circle cx="50" cy="50" r="46" stroke="url(#hero-ap)" strokeWidth="1.5" fill="none" />
                    <g stroke="url(#hero-ap)" strokeWidth="1.5" fill="none" strokeLinecap="round">
                      <path d="M50 8 L62 46 L24 38 Z" />
                      <path d="M88 36 L66 66 L42 30 Z" />
                      <path d="M82 78 L46 70 L66 36 Z" />
                      <path d="M40 92 L34 54 L72 60 Z" />
                      <path d="M8 60 L40 38 L48 76 Z" />
                    </g>
                    <circle cx="50" cy="50" r="3" fill="url(#hero-ap)" />
                  </svg>
                  <span className="word-foil italic">{client.hero.emphasis}</span>
                </span>
                
              </span>
              <span className="block relative">
                {client.hero.line3}
              </span>
              <span className="lens-flare absolute -bottom-4" aria-hidden />
            </h1>
            <div className="mt-10 flex flex-wrap gap-4 items-center">
              <Link to="/reserve" className="group inline-flex items-center gap-3 px-8 py-4 bg-molten text-white label-eyebrow hover:bg-ivory transition">
                Reserve Your Date <ArrowRight className="w-4 h-4 transition group-hover:translate-x-1" />
              </Link>
              <a href={client.identity.phoneTel} className="inline-flex items-center gap-3 px-8 py-4 border border-hairline bg-paper/70 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
                <Phone className="w-4 h-4 text-molten" /> {client.identity.phoneDisplay}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED REEL */}
      {featuredFrames.length > 0 && <CinemaReel frames={featuredFrames} reelLabel="REEL 01 · FEATURED" />}

      {/* MARQUEE */}
      <section className="bg-paper-soft py-8 border-y border-hairline relative overflow-hidden">
        <Marquee phrases={client.services.map(s=>s.shortLabel)} />
      </section>

      {/* INTRO — XAVIER */}
      <section className="py-28 md:py-36 relative bg-paper">
        <div className="container grid md:grid-cols-12 gap-12 items-start">
          <div className="md:col-span-5 md:sticky md:top-32">
            <div className="label-eyebrow text-molten mb-6">{client.identity.businessName}</div>
            <h2 className="font-display text-[2.7rem] md:text-[4.05rem] text-ivory leading-[0.9] tracking-tight text-balance">
              {client.content.whyHeadline || client.identity.businessName}
            </h2>
          </div>
          <div className="md:col-span-6 md:col-start-7 space-y-6 text-ivory/75 text-lg leading-relaxed text-pretty">
            {paragraphs(client.content.about).map((p,i)=><p key={i} className={i===0?"font-display text-3xl text-ivory italic leading-snug":""}>{p}</p>)}
            <Link to="/about" className="inline-flex items-center gap-3 label-eyebrow text-molten border-b border-molten pb-1 hover:gap-5 transition-all">
              The full story <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* SERVICE TRIPTYCH */}
      <section className="bg-paper-soft py-24 md:py-32 relative overflow-hidden border-y border-hairline">
        <div className="container mb-16">
          <div className="label-eyebrow text-molten mb-3">Sessions · Tell Your Story</div>
          <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory leading-[0.9] tracking-tight max-w-2xl">
            {client.content.serviceIntro}
          </h2>
        </div>

        <div className="container grid md:grid-cols-3 gap-6 lg:gap-10">
          {services.map((s) => (
            <Link to={s.to} key={s.label} className="group block bg-paper border border-hairline">
              {/* Category-specific photo slots await certified service-to-media assignments. */}
              <div className="p-6">
                <div className="label-eyebrow text-molten mb-3">{s.label}</div>
                <h3 className="font-display text-2xl text-ivory mb-2 leading-tight">{s.title}</h3>
                <p className="text-ivory/65 text-sm mb-4">{s.copy}</p>
                <span className="label-eyebrow text-ivory inline-flex items-center gap-2 border-b border-molten pb-1">
                  Open <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* TESTIMONIALS */}
      {proof.length > 0 && <section className="py-28 md:py-36 relative bg-paper">
        <div className="container">
          <div className="label-eyebrow text-molten mb-6 text-center">Resonance · What Clients Say</div>
          <div className="space-y-20 md:space-y-28 max-w-5xl mx-auto">
            {proof.map((p, i) => (
              <figure key={i} className={`${i % 2 === 0 ? "md:pr-24" : "md:pl-24 md:text-right"}`}>
                <blockquote className="font-display text-2xl md:text-4xl text-ivory leading-[1.2] tracking-tight italic text-balance">
                  <span className="text-molten">"</span>{p.line}<span className="text-molten">"</span>
                </blockquote>
                <figcaption className="label-eyebrow text-ivory/55 mt-6">— {p.attribution}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      }
      {client.content.faqs.length > 0 && <Faq items={client.content.faqs} heading="Common questions" emitSchema />}

      {/* PRICING & PACKAGES (above Reserve Your Date) */}
      <PricingPackages />

      {/* BOOKING CLOSE — Reserve Your Date */}
      <section className="relative py-28 md:py-40 bg-paper-soft overflow-hidden border-t border-hairline">
        <div className="container relative z-10 text-center max-w-4xl">
          <Monogram size={72} className="text-molten mb-10 mx-auto" />
          <div className="label-eyebrow text-molten mb-6">Reserve Your Date</div>
          <h2 className="font-display text-[2.484rem] md:text-[3.726rem] text-ivory leading-[0.95] tracking-tight text-balance">
            {client.content.ctaHeadline || "Reserve your date"}
          </h2>
          <p className="mt-8 text-ivory/70 text-lg max-w-2xl mx-auto">
            {client.content.ctaBody}
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <Link to="/reserve" className="px-10 py-5 bg-molten text-white label-eyebrow hover:bg-ivory transition">Begin Booking</Link>
            <a href={client.identity.phoneTel} className="px-10 py-5 border border-hairline text-ivory label-eyebrow hover:border-molten hover:text-molten transition inline-flex items-center gap-2 bg-paper">
              <Phone className="w-4 h-4 text-molten" /> {client.identity.phoneDisplay}
            </a>
            {client.identity.email && <a href={`mailto:${client.identity.email}`} className="px-10 py-5 border border-hairline text-ivory label-eyebrow hover:border-molten hover:text-molten transition inline-flex items-center gap-2 bg-paper">
              <Mail className="w-4 h-4 text-molten" /> Email
            </a>}
          </div>
        </div>
      </section>
    </>
  );
}
