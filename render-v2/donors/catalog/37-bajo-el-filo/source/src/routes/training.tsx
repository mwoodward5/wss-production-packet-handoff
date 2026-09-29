import {BajaChapter} from '@/components/BajaChapter';
import {getClient,pageMeta,serviceBody} from '@/wss/bridge';
const client=getClient();
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProofVideo } from "@/components/ProofVideo";
import { media } from "@/data/media";
import { PageHero, ClosingCTA } from "@/components/PageChrome";


export const Route = createFileRoute("/training")({
  head:()=>pageMeta("Training"),
  component: TrainingPage,
});

function TrainingPage() {
  return (
    <>
      <PageHero
        eyebrow="Training"
        title={<>Training <span className="italic text-steel">programs.</span></>}
        sub={client.content.serviceIntro}
      />



      <BajaChapter/>
      <section className="mx-auto max-w-[1440px] space-y-24 px-6 py-16 md:px-10 md:py-24">
        {client.services.map((s,i)=><Block key={s.name} n={String(i+1).padStart(2,"0")} title={s.name} reversed={i%2===1} copy={serviceBody(s)} bullets={[]} />)}
      </section>
      <ClosingCTA />
    </>
  );
}

function Block({ n, title, media, reversed, copy, bullets }: any) {
  return (
    <article className="grid grid-cols-12 items-center gap-6 md:gap-10">
      {media && <div className={`col-span-12 md:col-span-6 ${reversed ? "md:order-2" : ""}`}>
        <div className="halation">
          <div className="grain relative aspect-[4/5] overflow-hidden bg-ink-2">
            <ProofVideo item={media} className="h-full w-full" />
          </div>
        </div>
      </div>
      }
      {!media&&<div aria-hidden className={`col-span-12 flex aspect-[4/5] items-center justify-center border border-hairline md:col-span-6 ${reversed?"md:order-2":""}`}><span className="numeral text-8xl">{n}</span></div>}
      <div className={`col-span-12 md:col-span-6 ${reversed ? "md:order-1" : ""}`}>
        <span className="numeral text-5xl md:text-7xl">{n}</span>
        <h2 className="mt-4 font-serif text-4xl text-bone md:text-6xl">{title}</h2>
        <p className="mt-6 max-w-xl text-bone-dim md:text-lg">{copy}</p>
        <dl className="mt-8 space-y-4">
          {bullets.map(([k, v]: [string, string]) => (
            <div key={k} className="flex gap-6 border-t border-hairline pt-4">
              <dt className="eyebrow w-32 shrink-0 text-edge">{k}</dt>
              <dd className="text-bone">{v}</dd>
            </div>
          ))}
        </dl>
        <Link to="/contact" className="eyebrow mt-10 inline-flex items-center gap-3 border-b border-edge pb-2 text-edge">
          Inquire about {title} →
        </Link>
      </div>
    </article>
  );
}
