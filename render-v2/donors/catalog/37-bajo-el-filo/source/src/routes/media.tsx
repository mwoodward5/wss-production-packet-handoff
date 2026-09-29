import {pageMeta} from '@/wss/bridge';
import { createFileRoute } from "@tanstack/react-router";
import { ProofVideo } from "@/components/ProofVideo";
import { media, type MediaCategory } from "@/data/media";
import { useMemo, useState } from "react";
import { PageHero } from "@/components/PageChrome";

export const Route = createFileRoute("/media")({
  head:()=>pageMeta("Media"),
  component: MediaPage,
});

const filters:{key:'all'|MediaCategory;label:string}[]=[{key:'all',label:'All'},...Array.from(new Set(media.map(m=>m.category))).map(key=>({key,label:key}))];

function MediaPage() {
  const [active, setActive] = useState<(typeof filters)[number]["key"]>("all");
  const list = useMemo(
    () => (active === "all" ? media : media.filter((m) => m.category === active)),
    [active]
  );
  return (
    <>
      <PageHero
        eyebrow="Media · library"
        title={<>Media <span className="italic text-steel">library.</span></>}
        sub=""
      />
      <section className="mx-auto max-w-[1440px] px-6 pt-8 md:px-10">
        <div className="glass sticky top-24 z-30 -mx-2 flex flex-wrap items-center gap-2 rounded-full p-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setActive(f.key)}
              className={`eyebrow rounded-full px-4 py-2.5 transition-colors ${
                active === f.key ? "bg-bone text-ink" : "text-bone-dim hover:text-bone"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="eyebrow ml-auto pr-3 text-steel">{list.length} items</span>
        </div>
      </section>
      <section className="mx-auto max-w-[1440px] px-6 py-16 md:px-10 md:py-20">
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {list.map((m) => (
            <figure
              key={m.id}
              className="group relative overflow-hidden bg-ink-2"
              style={{ aspectRatio: m.orientation === "vertical" ? "9/16" : m.orientation === "square" ? "1/1" : "4/3" }}
            >
              <ProofVideo item={m} className="h-full w-full transition-[filter] duration-500 group-hover:brightness-110" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/90 via-transparent to-transparent" />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                <div>
                  <div className={`eyebrow ${"text-edge"}`}>{m.category}</div>
                  <div className="mt-1 text-sm text-bone">{m.caption}</div>
                </div>
                {m.permission === "pending" && (
                  <span className="eyebrow rounded-full border border-hairline px-2 py-1 text-steel">
                    pending
                  </span>
                )}
              </figcaption>
            </figure>
          ))}

        </div>
        {list.length===0 && <p className="text-steel">No media is available.</p>}
      </section>
    </>
  );
}
