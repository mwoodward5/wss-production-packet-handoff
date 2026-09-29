import {getClient} from '@/wss/bridge';
const client=getClient();
import { copy } from "@/data/copy";
import { media } from "@/data/media";
import { ProofVideo } from "./ProofVideo";
import { ChapterMark, Epigraph } from "./ChapterMark";
import { ArtIcon } from "./icons/ArtIcon";

export function BajaChapter() {
  const stills=media.filter(m=>m.category==='about').slice(0,3);
  if(!stills.length)return null;
  return (
    <section className="on-paper relative border-y border-hairline py-24 md:py-32" aria-labelledby="baja-h">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-center justify-between">
          <span className="eyebrow">About · II</span>
          <ChapterMark n="II" />
        </div>
        <div className="mt-10 grid grid-cols-12 items-end gap-8">
          <div className="col-span-12 md:col-span-7">
            <h2 id="baja-h" className="font-serif text-5xl leading-[1.02] tracking-[-0.025em] md:text-7xl" style={{ color: "var(--paper-ink)" }}>
              {client.identity.businessName}
            </h2>
            <p className="mt-6 max-w-xl text-lg md:text-xl" style={{ color: "var(--paper-steel)" }}>
              {client.content.about}
            </p>
          </div>
          <div className="col-span-12 md:col-span-5">
            
          </div>
        </div>

        {/* Triptych */}
        <div className="mt-14 grid grid-cols-12 gap-3 md:gap-5">
          {stills.map((m, i) => (
            <figure
              key={m.id}
              className={`relative overflow-hidden bg-paper-2 ${
                i === 0 ? "col-span-12 aspect-[16/10] md:col-span-6 md:aspect-[3/4]" :
                i === 1 ? "col-span-6 aspect-[4/5] md:col-span-3" :
                "col-span-6 aspect-[4/5] md:col-span-3"
              }`}
            >
              <ProofVideo item={m} className="h-full w-full" />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3 text-xs" style={{ background: "linear-gradient(to top, rgba(255,251,240,0.9), transparent)" }}>
                <span className="eyebrow" style={{ color: "var(--paper-ink)" }}></span>
                <span style={{ color: "var(--paper-steel)" }}></span>
              </figcaption>
            </figure>
          ))}
        </div>

      </div>
    </section>
  );
}
