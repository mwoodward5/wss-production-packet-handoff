import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";
import LightFrame from "@/components/LightFrame";
import SideRail from "@/components/SideRail";

import {useSite,richCopy,paragraphs} from "@/wss/bridge";

export interface LocationData {
  slug: string;
  city: string;
  region: string;
  eyebrow: string;
  title: string;
  italic: string;
  intro: string;
  body: { h2: string; p: string[] }[];
  venues: { name: string; note: string }[];
  cover: string;
  seoTitle: string;
  seoDesc: string;
}

export default function LocationPage({ data }: { data: LocationData }) {
  const {client}=useSite();
  const path = `/${data.slug}`;

  return (
    <>
      <Seo title={data.seoTitle} description={data.seoDesc} path={path} />


      <section className="relative pt-44 pb-20 bg-paper overflow-hidden">
        <SideRail label={data.city.toUpperCase()} meta={["LOCATION",client.identity.state]} />
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container max-w-6xl">
          <div className="label-eyebrow text-molten mb-6">{data.eyebrow}</div>
          <h1 className="font-display text-[9.6vw] md:text-[5.6vw] lg:text-[4.8vw] text-ivory leading-[0.9] tracking-[-0.03em] text-balance max-w-5xl">
            {data.title.split(data.italic)[0]}<span className="italic text-molten">{data.italic}</span>{data.title.split(data.italic)[1]}
          </h1>
          <p className="mt-8 max-w-3xl text-ivory/75 text-xl leading-relaxed">{data.intro}</p>
        </div>
      </section>

      {data.cover && <section className="bg-paper pb-12">
        <div className="container max-w-5xl">
          <LightFrame><img src={data.cover} alt={`${data.city} photographer`} className="w-full aspect-[16/9] object-cover" /></LightFrame>
        </div>
      </section>

      }
      <section className="py-20 bg-paper">
        <div className="container max-w-3xl space-y-14 text-ivory/80 text-lg leading-[1.8]">
          {data.body.map((s) => (
            <div key={s.h2}>
              <h2 className="font-display text-[1.6875rem] md:text-[2.025rem] text-ivory leading-tight mb-5 tracking-tight">{s.h2}</h2>
              {s.p.map((p, i) => <p key={i} className="text-pretty mb-4">{p}</p>)}
            </div>
          ))}
        </div>
      </section>

      {data.venues.length > 0 && <section className="py-20 bg-paper-soft border-y border-ivory/10">
        <div className="container max-w-5xl">
          <div className="label-eyebrow text-molten mb-8">Locations · {data.city}</div>
          <ul className="grid md:grid-cols-2 gap-6">
            {data.venues.map((v) => (
              <li key={v.name} className="border-l border-molten/40 pl-5">
                <div className="font-display text-2xl text-ivory">{v.name}</div>
                <div className="text-ivory/60 mt-1">{v.note}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      }
      <section className="py-24 bg-paper">
        <div className="container max-w-3xl text-center">
          <h2 className="font-display text-[2.025rem] md:text-[2.7rem] text-ivory mb-6">{client.identity.businessName}</h2>
          <p className="text-ivory/70 mb-10">{client.trust.areas.join(" · ")}</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link to="/contact" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">Reserve a session <ArrowRight className="w-4 h-4" /></Link>
            <Link to="/about" className="inline-flex items-center gap-3 px-8 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition">About</Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function CertifiedAreaPage(){const {client}=useSite();return <LocationPage data={{slug:'service-area',city:client.identity.city,region:client.identity.state,eyebrow:'Service area',title:client.identity.city,italic:client.identity.city,intro:client.trust.areas.join(' · '),body:[{h2:'Service area',p:paragraphs(richCopy('service-area'))}],venues:[],cover:'',seoTitle:`Service area · ${client.identity.businessName}`,seoDesc:client.trust.areas.join(', ')}}/>;}
