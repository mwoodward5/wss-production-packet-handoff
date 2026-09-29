import {CLIENT,serviceFor} from "@/lib/wss";
import { Link } from "react-router-dom";
import { Home, Building2, ArrowUpRight } from "lucide-react";
import { ASSETS } from "@/lib/assets";
const residentialImg = ASSETS.residential;
const commercialImg = ASSETS.commercial;

/**
 * Residential vs Commercial split — full-width 2-column band, no floating
 * cards. Each side anchors to its own service page.
 */

const SIDES=[{path:'/roof-replacement',img:residentialImg,icon:Home},{path:'/commercial-roofing',img:commercialImg,icon:Building2}].flatMap((slot,i)=>{
 const service=serviceFor(slot.path);
 return service&&slot.img?[{code:`B-0${i+1}`,icon:slot.icon,eyebrow:service.shortLabel,title:service.name,blurb:service.description,bullets:[],href:slot.path,img:slot.img,alt:service.name}]:[];
});

export const ResVsCommercial = () => !SIDES.length ? null : (
  <section className="relative bg-muted/40 py-20 md:py-24">
    <div className="container-tight">
      <div className="mb-10 grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <span className="eyebrow">Section · 04 / Residential vs Commercial</span>
          <h2 className="heading-section mt-3">
            {CLIENT.identity.businessName}
          </h2>
        </div>
        <p className="text-muted-foreground md:col-span-4">
          {CLIENT.content.serviceIntro}
        </p>
      </div>

      <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2">
        {SIDES.map(({ code, icon: Icon, eyebrow, title, blurb, bullets, href, img, alt }) => (
          <article key={code} className="group relative flex flex-col bg-card">
            <div className="relative aspect-[16/10] overflow-hidden">
              <img
                src={img}
                alt={alt}
                width={1600}
                height={1000}
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/10 to-transparent" aria-hidden="true" />
              <div className="absolute left-4 top-4 flex items-center gap-2 border border-primary-foreground/30 bg-primary/70 px-2.5 py-1 backdrop-blur-sm" style={{ borderRadius: "2px" }}>
                <Icon className="h-3.5 w-3.5 text-accent" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-foreground">
                  {code} · {eyebrow}
                </span>
              </div>
              <div className="absolute bottom-4 left-4 right-4">
                <h3 className="font-display text-3xl font-extrabold tracking-tight text-primary-foreground md:text-4xl">
                  {title}
                </h3>
              </div>
            </div>
            <div className="flex flex-1 flex-col p-6 md:p-8">
              <p className="text-sm text-muted-foreground">{blurb}</p>
              <ul className="mt-5 space-y-2">
                {bullets.map((b) => (
                  <li key={b} className="flex items-center gap-3 border-b border-dashed border-border pb-2 last:border-b-0 last:pb-0">
                    <span className="h-1.5 w-1.5 bg-accent" aria-hidden="true" />
                    <span className="font-display text-sm font-semibold">{b}</span>
                  </li>
                ))}
              </ul>
              <Link
                to={href}
                className="mt-7 inline-flex items-center gap-2 self-start border-b-2 border-accent pb-1 font-display text-sm font-bold uppercase tracking-wider text-foreground transition hover:text-accent"
              >
                See {title.toLowerCase()} work
                <ArrowUpRight className="h-4 w-4 text-accent" />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);