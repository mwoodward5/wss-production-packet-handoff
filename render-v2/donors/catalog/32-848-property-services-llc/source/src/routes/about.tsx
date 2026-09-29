import { CLIENT, SITE, SERVICES, PLAN } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

export function AboutPage() {
  return (
    <>
      <section className="bg-bone pt-20 pb-12">
        <div className="container-edge grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7">
            <div className="num-badge text-ink/40 mb-3">— About</div>
            <h1 className="display-xl">{CLIENT.content.whyHeadline || BUSINESS.name}</h1>
          </div>
          <div className="lg:col-span-5 self-end">
            <p className="text-[17px] text-ink/70 leading-relaxed">
              {BUSINESS.city}, {BUSINESS.state}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-bone pb-24">
        <div className="container-edge grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-7">
            <div className="aspect-[5/4] overflow-hidden frame-ink">
              {SITE.aboutImage && <img src={SITE.aboutImage} alt={BUSINESS.name} width={1280} height={1024} loading="lazy" className="w-full h-full object-cover"/>}
            </div>
          </div>
          <div className="lg:col-span-5 space-y-8 text-[15px] text-ink/75 leading-relaxed">
            <p className="whitespace-pre-line">{PLAN.content?.about || CLIENT.content.about}</p>
            <Link to="/contact" className="btn-volt">Start a conversation</Link>
          </div>
        </div>
      </section>

      {CLIENT.content.values.length>0 && <section className="bg-ink text-bone py-20">
        <div className="container-edge grid md:grid-cols-3 gap-10">
          {CLIENT.content.values.map((v,i)=>{const b={t:v.title,d:v.body};return (
            <div key={b.t}>
              <div className="num-badge text-volt mb-3">— 0{i+1}</div>
              <h3 className="font-display text-2xl text-bone">{b.t}</h3>
              <p className="mt-3 text-[14px] text-bone/65 leading-relaxed">{b.d}</p>
            </div>
          );})}
        </div>
      </section>}
    </>
  );
}
