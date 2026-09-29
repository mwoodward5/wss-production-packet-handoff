import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";
import { Mail } from "lucide-react";
import { FlagshipHero } from "@/components/site/FlagshipHero";
import { ArrowUpRight, Phone, MessageSquare, Hammer, ShieldCheck, Award, Quote, MapPin, Calendar, CheckCircle2, ExternalLink } from "lucide-react";
import { FaqSchema } from "@/components/site/Schema";

const HOME_FAQ = CLIENT.content.faqs.slice(0,6);
export const Route = createFileRoute('/')({component:HomePage});
const SERVICE_CARDS = SERVICES.slice(0,4).map(s=>({...s,line:s.description}));
export function HomePage() {
  return (
    <>
      <FlagshipHero />

      {/* ===================== SERVICES GRID ===================== */}
      <section className="bg-bone py-24 lg:py-36">
        <div className="container-edge">
          <div className="grid lg:grid-cols-12 gap-8 mb-16">
            <div className="lg:col-span-5">
              <div className="eyebrow text-ink/60 mb-4">— What we do</div>
              <h2 className="display-lg">Services for your home.</h2>
            </div>
            <div className="lg:col-span-6 lg:col-start-7 self-end">
              <p className="text-[16px] leading-relaxed text-ink/70">
                {CLIENT.content.serviceIntro}
              </p>
              <Link to="/services" className="mt-6 inline-block btn-ghost-ink">See all services →</Link>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
            {SERVICE_CARDS.map((s, i) => (
              <Link
                key={s.slug}
                to="/services/$slug" params={{ slug: s.slug }}
                className="group"
              >
                <div className="relative aspect-[4/5] overflow-hidden frame-ink">
                  {s.img && <img src={s.img} alt={s.name} width={1280} height={1600}
                       loading="lazy"
                       className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />}
                  <div className="absolute top-3 left-3 num-badge text-bone/90">№ 0{i+1}</div>
                </div>
                <div className="mt-5 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl">{s.name}</h3>
                    <p className="mt-1 text-[13px] text-ink/60">{s.line}</p>
                  </div>
                  <ArrowUpRight size={20} className="mt-1 text-ink/40 group-hover:text-ink transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== VERIFIED & TRUSTED ===================== */}
      {CLIENT.trust.badges.length>0 && <section className="bg-ink text-bone border-y border-bone/10">
        <div className="container-edge py-10 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 items-center">
          {CLIENT.trust.badges.map(({label:k,sublabel:v},i)=>(
            <a
              key={i}
              
              
              
              className="flex items-start gap-3 group"
            >
              <span className="w-10 h-10 shrink-0 grid place-items-center border border-volt/40 text-volt group-hover:bg-volt group-hover:text-ink transition-colors">
                <ShieldCheck size={18} />
              </span>
              <div className="leading-tight">
                <div className="font-display text-[15px] text-bone">{k}</div>
                <div className="mt-0.5 text-[11.5px] uppercase tracking-[0.14em] text-bone/55">{v}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      }
      {/* ===================== TESTIMONIAL + BBB-LISTED CATEGORIES ===================== */}
      {(CLIENT.trust.reviews.length>0 || BUSINESS.additionalServices.length>0) && <section className="bg-bone py-24 lg:py-32">
        <div className="container-edge grid lg:grid-cols-12 gap-12 items-start">
          {CLIENT.trust.reviews.slice(0,1).map(r=><div key={r.sourceUrl} className="lg:col-span-6"><div className="eyebrow text-ink/60 mb-4">— In our customers' words</div><Quote size={36} className="text-volt mb-4"/><blockquote className="display-md text-ink leading-[1.15]">{r.text}</blockquote><a href={r.sourceUrl} className="mt-6 block text-[13px]">{r.author} · Review source ↗</a></div>)}
          {BUSINESS.additionalServices.length>0 && <div className="lg:col-span-6 lg:pl-10"><div className="eyebrow text-ink/60 mb-4">— Also available</div><h2 className="display-md">More services.</h2><ul className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-[14px] text-ink/80">{BUSINESS.additionalServices.map(s=><li key={s}>{s}</li>)}</ul><Link to="/services" className="mt-8 btn-ghost-ink">All services →</Link></div>}
        </div>
      </section>}
      {CLIENT.content.values.length>0 && <section className="bg-ink text-bone py-24">
        <div className="container-edge grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5">
            <div className="eyebrow text-volt mb-4">— Why homeowners call us</div>
            <h2 className="display-lg text-bone">{CLIENT.content.whyHeadline || "Our approach"}</h2>
            <p className="mt-6 text-bone/70 max-w-md leading-relaxed">
              {CLIENT.content.about}
            </p>
            <Link to="/about" className="mt-8 btn-ghost-bone">More about us →</Link>
          </div>
          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-px bg-bone/10">
            {CLIENT.content.values.map((value,i)=>{const b={t:value.title,d:value.body};return (
              <div key={i} className="bg-ink p-8">
                <div className="num-badge text-volt mb-4">— 0{i+1}</div>
                <h3 className="font-display text-xl text-bone">{b.t}</h3>
                <p className="mt-2 text-[14px] text-bone/65 leading-relaxed">{b.d}</p>
              </div>
            );})}
          </div>
        </div>
      </section>}

      {/* ===================== LOCAL FAQ (Hastings, MI) ===================== */}
      {HOME_FAQ.length>0 && <section className="bg-bone border-t border-ink/10 py-24 lg:py-32">
        <FaqSchema items={HOME_FAQ} />
        <div className="container-edge grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <div className="eyebrow text-ink/60 mb-4">— {BUSINESS.city}, {BUSINESS.state} · FAQ</div>
            <h2 className="display-lg leading-[1.05]">Common questions, answered.</h2>
            <p className="mt-6 text-[15px] text-ink/70 leading-relaxed max-w-sm">
              Questions about {BUSINESS.name}.
            </p>
            <Link to="/faq" className="mt-8 inline-block btn-ghost-ink">
              See full FAQ →
            </Link>
          </div>
          <div className="lg:col-span-8">
            <div className="border-t border-ink/15">
              {HOME_FAQ.map((f, i) => {
                const [lead, ...rest] = f.a.split(/(?<=\.)\s+/);
                return (
                  <details key={f.q} className="group border-b border-ink/15 py-6">
                    <summary className="cursor-pointer flex items-start gap-6 list-none">
                      <span className="num-badge text-ink/40 pt-1.5 shrink-0">
                        № {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-display text-xl md:text-2xl flex-1">
                        {f.q}
                      </span>
                      <span className="font-display text-2xl text-ink/40 group-open:rotate-45 transition-transform">
                        +
                      </span>
                    </summary>
                    <div className="mt-4 ml-[3.5rem] max-w-2xl">
                      <p className="text-[15px] text-ink leading-relaxed font-medium">
                        {lead}
                      </p>
                      {rest.length > 0 && (
                        <p className="mt-3 text-[15px] text-ink/70 leading-relaxed">
                          {rest.join(" ")}
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      }
      {/* ===================== CONTACT BLOCK ===================== */}
      <section id="contact" className="bg-bone py-24 lg:py-32">
        <div className="container-edge grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="eyebrow text-ink/60 mb-4">— Start a project</div>
            <h2 className="display-lg">Tell us what your home needs.</h2>
            <p className="mt-6 text-[16px] text-ink/70 max-w-md leading-relaxed">
              {CLIENT.content.ctaBody}
            </p>
            <div className="mt-10 space-y-5 text-[15px]">
              <a href={`tel:${BUSINESS.phoneE164}`} className="flex items-center gap-3 hover:text-ink/70">
                <span className="w-10 h-10 grid place-items-center bg-ink text-volt"><Phone size={16}/></span>
                <div><div className="font-semibold">{BUSINESS.phone}</div><div className="text-[12px] text-ink/55">Call</div></div>
              </a>
              {BUSINESS.hours && <div className="flex items-center gap-3"><span className="w-10 h-10 grid place-items-center bg-ink text-volt"><Hammer size={16}/></span><div>{BUSINESS.hours}</div></div>}
            </div>
          </div>
          <div className="lg:col-span-7">
            <div className="bg-ink text-bone p-8 lg:p-10 border border-ink">
              <div className="eyebrow text-volt mb-4">— Contact</div>
              <h3 className="font-display text-3xl lg:text-4xl leading-tight">
                {CLIENT.content.ctaHeadline || BUSINESS.name}
              </h3>
              <p className="mt-4 text-[15px] text-bone/70 leading-relaxed max-w-lg">
                {CLIENT.content.ctaBody}
              </p>
              <div className="mt-8 grid sm:grid-cols-2 gap-4">
                <a href={`tel:${BUSINESS.phoneE164}`} className="group flex items-center gap-3 bg-volt text-ink p-5 hover:bg-bone transition-colors">
                  <span className="w-10 h-10 grid place-items-center bg-ink text-volt"><Phone size={16}/></span>
                  <div>
                    <div className="eyebrow text-ink/60">Call now</div>
                    <div className="font-display text-lg">{BUSINESS.phone}</div>
                  </div>
                </a>
                {BUSINESS.email && <a href={`mailto:${BUSINESS.email}`} className="group flex items-center gap-3 bg-bone text-ink p-5 hover:bg-volt transition-colors">
                  <span className="w-10 h-10 grid place-items-center bg-ink text-volt"><Mail size={16}/></span>
                  <div>
                    <div className="eyebrow text-ink/60">Email</div>
                    <div className="font-display text-[15px] break-all">{BUSINESS.email}</div>
                  </div>
                </a>}
              </div>
              <p className="mt-6 text-[12.5px] text-bone/55">
                Service area: {BUSINESS.city}, {BUSINESS.state} · {BUSINESS.region}. {BUSINESS.hoursShort}.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

