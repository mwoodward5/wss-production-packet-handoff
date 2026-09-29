import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Camera } from "lucide-react";
import Seo from "@/components/Seo";
import LightFrame from "@/components/LightFrame";
import Monogram from "@/components/Monogram";
import SideRail from "@/components/SideRail";
import { useSite, richCopy, paragraphs } from "@/wss/bridge";


export default function About() {
 const {client}=useSite();
 const photo=client.media.filter(m=>m.role==='about').sort((a,b)=>(a.rank??999)-(b.rank??999))[0];
 const headshotPhoto=photo?{url:photo.path,alt:client.identity.businessName,w:photo.width||3,h:photo.height||4}:null;
 const cards=[...client.content.values.map(v=>({k:v.title,v:v.body})),...client.trust.badges.map(b=>({k:b.label,v:[b.sublabel,b.meta].filter(Boolean).join(" · ")}))];
 const aboutMeta={title:`About · ${client.identity.businessName}`,description:client.content.about};
  return (
    <>
      <Seo title={aboutMeta.title} description={aboutMeta.description} path="/about" />

      <section className="relative pt-40 pb-20 bg-paper">
        <SideRail label="ABOUT" meta={[client.identity.city, "FOLIO 006"]} />
        <div className="container grid md:grid-cols-12 gap-12 items-start">
          <div className="md:col-span-5 md:sticky md:top-28 lg:top-32 self-start max-h-[calc(100vh-7rem)] overflow-visible">
            {headshotPhoto && <LightFrame>
              <img
                src={headshotPhoto.url}
                alt={headshotPhoto.alt}
                width={headshotPhoto.w}
                height={headshotPhoto.h}
                className="block w-full h-auto max-h-[calc(100vh-10rem)] object-contain object-top"
                style={{ aspectRatio: headshotPhoto.w / headshotPhoto.h }}
                loading="eager"
                decoding="async"
              />
            </LightFrame>}
            <div className="mt-6 grid grid-cols-2 gap-4 text-ivory/70 font-mono text-xs">
              <div><div className="text-molten label-eyebrow mb-1">Based</div><div className="flex items-center gap-2"><MapPin className="w-3 h-3 text-molten" />{client.identity.city}, {client.identity.state}</div></div>
              
            </div>

          </div>


          <div className="md:col-span-6 md:col-start-7">
            <div className="label-eyebrow text-molten mb-6">Folio 006 · About</div>
            <h1 className="font-display text-[9.6vw] md:text-[5.6vw] lg:text-[4.4vw] text-ivory leading-[0.9] tracking-[-0.03em] text-balance mb-12">
              <span className="italic text-molten">{client.identity.businessName}</span>
            </h1>
            <div className="space-y-6 text-ivory/80 text-lg leading-[1.8]">
              {paragraphs(richCopy("about",client.content.about)).map((p,i)=><p key={i}>{p}</p>)}
            </div>

            <div className="mt-12 flex flex-wrap gap-4">
              <Link to="/reserve" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-white label-eyebrow hover:bg-ivory transition">
                Reserve a Session <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/pricing" className="inline-flex items-center gap-3 px-8 py-4 border border-hairline text-ivory label-eyebrow hover:border-molten hover:text-molten transition">
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      {cards.length > 0 && <section className="py-24 bg-paper-soft border-y border-hairline">
        <div className="container grid md:grid-cols-3 gap-10 text-center">
          {cards.map((c) => (
            <div key={c.k} className="border border-hairline bg-paper p-10">
              <Monogram size={36} className="text-molten mb-4 justify-center" />
              <div className="font-display text-3xl text-ivory mb-2">{c.k}</div>
              <p className="text-ivory/65 text-sm">{c.v}</p>
            </div>
          ))}
        </div>
      </section>}
    </>
  );
}
