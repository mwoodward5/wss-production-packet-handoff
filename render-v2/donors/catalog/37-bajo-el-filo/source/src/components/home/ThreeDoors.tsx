import {getClient,serviceSlug} from '@/wss/bridge';
import { Link } from "@tanstack/react-router";
import { ScrollFrame } from "@/components/frames/ScrollFrame";
import { ChapterMark } from "@/components/ChapterMark";
import { media } from "@/data/media";
import { ProofVideo } from "@/components/ProofVideo";

const doors=getClient().services.slice(0,3).map((s,i)=>({n:String(i+1).padStart(2,'0'),tag:'',title:s.name,body:s.description,href:'/arts/'+serviceSlug(s),clipId:'',seal:''}));

export function ThreeDoors() {
  return (
    <section
      aria-labelledby="doors-h"
      className="relative bg-ink py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-edge">Training · III</span>
          <ChapterMark n="III" />
        </div>
        <h2
          id="doors-h"
          className="mt-6 max-w-3xl font-serif text-4xl leading-[1.02] tracking-[-0.02em] text-bone md:text-6xl"
        >
          Choose a program.
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
          {doors.map((d) => {
            const clip = media.find((m) => m.id === d.clipId)!;
            return (
              <Link
                key={d.n}
                to={d.href}
                className="group relative block"
              >
                {clip && <ScrollFrame aspect="3/4" seal={d.seal}>
                  <ProofVideo item={clip} className="h-full w-full" />
                </ScrollFrame>}
                {!clip && <ScrollFrame aspect="3/4" seal=""><div aria-hidden className="flex h-full items-center justify-center"><span className="numeral text-8xl text-edge/40">{d.n}</span></div></ScrollFrame>}

                <div className="mt-6 flex items-baseline justify-between">
                  <span className="numeral text-3xl text-edge">{d.n}</span>
                  <span className="eyebrow text-bone-dim">{d.tag}</span>
                </div>
                <h3 className="mt-3 font-serif text-2xl leading-tight text-bone md:text-3xl">
                  {d.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-bone-dim">
                  {d.body}
                </p>
                <div className="mt-4 inline-flex items-center gap-2 border-b border-edge/60 pb-1 text-xs uppercase tracking-widest text-edge transition-transform group-hover:-translate-y-0.5">
                  Enter <span aria-hidden>→</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
