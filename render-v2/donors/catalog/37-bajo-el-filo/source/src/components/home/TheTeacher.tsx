import {getClient} from '@/wss/bridge';
const client=getClient();
import { useEffect, useRef, useState } from "react";
import { ScrollFrame } from "@/components/frames/ScrollFrame";
import { ChapterMark, Epigraph } from "@/components/ChapterMark";
import { media } from "@/data/media";
import { ProofVideo } from "@/components/ProofVideo";

const frames=media.filter(m=>m.category==='people').slice(0,4).map(m=>({id:m.id,title:client.identity.businessName,body:client.content.about,caption:''}));

export function TheTeacher() {
  const stripRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const nodes = stripRef.current?.querySelectorAll<HTMLElement>("[data-frame]");
    if (!nodes) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.frame);
            if (!Number.isNaN(i)) setActive(i);
          }
        });
      },
      { root: stripRef.current, threshold: 0.65 }
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  if(!frames.length) return <AboutText/>;
  return (
    <section className="on-paper relative border-y border-hairline py-24 md:py-32" aria-labelledby="teacher-h">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-center justify-between">
          <span className="eyebrow">About · IV</span>
          <ChapterMark n="IV" />
        </div>

        <div className="mt-10 grid grid-cols-12 gap-10">
          {/* Sticky caption column */}
          <div className="col-span-12 md:col-span-4">
            <div className="md:sticky md:top-28">
              <h2
                id="teacher-h"
                className="font-serif text-4xl leading-[1.02] tracking-[-0.02em] md:text-6xl"
                style={{ color: "var(--paper-ink)" }}
              >
                {frames[active].title}
              </h2>
              <p
                className="mt-6 max-w-md text-[16px] leading-relaxed"
                style={{ color: "var(--paper-steel)" }}
              >
                {frames[active].body}
              </p>
              <div className="mt-8 flex items-center gap-3">
                <span className="numeral text-xl text-edge">
                  {String(active + 1).padStart(2, "0")}
                </span>
                <span className="h-px w-12 bg-edge/60" />
                <span className="eyebrow" style={{ color: "var(--paper-steel)" }}>
                  {frames[active].caption}
                </span>
                <span className="ml-auto text-xs text-paper-steel">
                  {active + 1} / {frames.length}
                </span>
              </div>
              <div className="mt-10 hidden md:block">
                {client.trust.badges.map(b=><p key={b.label} className="border-t border-hairline py-3">{b.label} {b.sublabel} {b.meta}</p>)}
              </div>
            </div>
          </div>

          {/* Film strip */}
          <div className="col-span-12 md:col-span-8">
            <div
              ref={stripRef}
              className="flex gap-6 overflow-x-auto scroll-smooth pb-6 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-edge/50"
              style={{ scrollSnapType: "x mandatory" }}
            >
              {frames.map((f, i) => {
                const clip = media.find((m) => m.id === f.id)!;
                return (
                  <div
                    key={f.id}
                    data-frame={i}
                    className="shrink-0"
                    style={{
                      width: "clamp(260px, 32vw, 380px)",
                      scrollSnapAlign: "center",
                    }}
                  >
                    <ScrollFrame aspect="9/16" seal={f.caption.charAt(0)}>
                      <ProofVideo item={clip} className="h-full w-full" />
                    </ScrollFrame>
                    <div className="mt-3 text-center text-xs uppercase tracking-widest" style={{ color: "var(--paper-steel)" }}>
                      Frame {String(i + 1).padStart(2, "0")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1440px] px-6 md:px-10"><div className="mt-12 grid gap-8 md:grid-cols-2">{client.content.values.map(v=><div key={v.title} className="border-t border-hairline pt-6"><h3 className="font-serif text-2xl">{v.title}</h3><p className="mt-3">{v.body}</p></div>)}{client.trust.reviews.slice(0,4).map(r=><blockquote key={r.text} className="border-l border-edge pl-6"><p className="font-serif text-2xl">{r.text}</p><a href={r.sourceUrl} className="eyebrow mt-3 block">{r.author}</a></blockquote>)}</div></div>
    </section>
  );
}

function AboutText(){return <section className="on-paper border-y border-hairline py-24 md:py-32"><div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-10 px-6 md:px-10"><div className="col-span-12 md:col-span-4"><ChapterMark n="IV"/><h2 className="mt-6 font-serif text-4xl md:text-6xl">{client.identity.businessName}</h2></div><div className="col-span-12 md:col-span-8"><p className="text-lg leading-relaxed">{client.content.about}</p>{client.trust.badges.map(b=><p key={b.label} className="mt-6 border-t border-hairline py-3">{b.label} {b.sublabel} {b.meta}</p>)}{client.content.values.map(v=><div key={v.title} className="mt-8 border-t border-hairline pt-6"><h3 className="font-serif text-2xl">{v.title}</h3><p className="mt-3">{v.body}</p></div>)}{client.trust.reviews.slice(0,4).map(r=><blockquote key={r.text} className="mt-10 border-l border-edge pl-6"><p className="font-serif text-2xl">{r.text}</p><a href={r.sourceUrl} className="eyebrow mt-3 block">{r.author}</a></blockquote>)}</div></div></section>;}
