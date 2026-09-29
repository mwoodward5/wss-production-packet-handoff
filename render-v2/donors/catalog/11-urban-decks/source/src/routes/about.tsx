import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute } from "@tanstack/react-router";
import { PageHero, ClosingBand } from "./services";
const craftHands = media("people") || media("about");
const projectPool = CLIENT.hero.poster;
import { CheckCircle2 } from "lucide-react";
import { SITE } from "@/lib/site";

import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () =>
    pageHead({
      title: "About · " + SITE.name,
      description: SITE.shortDescription,
      path: "/about",
    }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title={SITE.name}
        intro="About us"
        image={projectPool}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-12 md:grid-cols-12 items-center">
          {craftHands && <div className="md:col-span-6">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              {craftHands && <img src={craftHands} alt={SITE.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover img-cinematic" />}
            </div>
          </div>}
          <div className={craftHands ? "md:col-span-6 md:pl-6" : "md:col-span-12"}>
            <p className="eyebrow text-cedar">Our mission</p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-tight">
              {CLIENT.content.whyHeadline || "About us"}
            </h2>
            {(PLAN.content?.about || CLIENT.content.about).split(/\n\n+/).filter(Boolean).map((paragraph,i)=>(
              <p key={i} className="mt-5 text-ink/75 leading-relaxed">{paragraph}</p>
            ))}
            <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm text-ink/85">
              {CLIENT.content.values.map(v=>v.title).map((f) => (
                <li key={f} className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-cedar mt-0.5" /><span>{f}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {CLIENT.content.values.length > 0 && <section className="section bg-ink text-cream">
        <div className="mx-auto max-w-4xl px-5 md:px-8 text-center">
          <p className="eyebrow text-cedar">What we believe</p>
          <h2 className="mt-4 font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">{CLIENT.content.values[0]?.body}</h2>
        </div>
      </section>}

      <ClosingBand />
    </>
  );
}
