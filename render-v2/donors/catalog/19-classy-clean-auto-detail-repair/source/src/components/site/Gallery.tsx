import { galleryMedia } from "@/lib/wss";

export function Gallery() {
  const ITEMS=galleryMedia().map((m,i)=>({src:m.path,title:`Photo ${i+1}`,caption:""}));
  if (!ITEMS.length) return null;
  return (
    <section id="work" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-12 gap-6 mb-12 items-end">
          <div className="col-span-12 lg:col-span-6">
            <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">§ 04 — In the bay</span>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
              The work. The <em className="text-accent not-italic">finish</em>.
            </h2>
          </div>
          <p className="col-span-12 lg:col-span-5 lg:col-start-8 text-muted-foreground leading-relaxed text-pretty">
            Client gallery
          </p>
        </div>

        <div className="grid grid-cols-12 gap-4 lg:gap-6">
          {ITEMS[0] && (
          <figure className="col-span-12 lg:col-span-7 relative group overflow-hidden rounded-2xl">
            <img
              src={ITEMS[0].src}
              alt={ITEMS[0].title}
              loading="lazy"
              width={1280}
              height={960}
              className="h-[420px] sm:h-[520px] w-full object-cover duotone-moss group-hover:scale-[1.03] transition-transform duration-[1200ms]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-loam/90 to-transparent text-bone">
              <div className="text-[10px] tracking-[0.28em] uppercase text-bone/70">{ITEMS[0].caption}</div>
              <div className="font-display text-xl mt-1">{ITEMS[0].title}</div>
            </figcaption>
          </figure>
          )}

          {ITEMS[1] && (
          <figure className="col-span-12 lg:col-span-5 relative group overflow-hidden rounded-2xl">
            <img
              src={ITEMS[1].src}
              alt={ITEMS[1].title}
              loading="lazy"
              width={1280}
              height={960}
              className="h-[420px] sm:h-[520px] w-full object-cover duotone-moss group-hover:scale-[1.03] transition-transform duration-[1200ms]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-loam/90 to-transparent text-bone">
              <div className="text-[10px] tracking-[0.28em] uppercase text-bone/70">{ITEMS[1].caption}</div>
              <div className="font-display text-xl mt-1">{ITEMS[1].title}</div>
            </figcaption>
          </figure>
          )}

          {ITEMS[2] && (
          <figure className="col-span-12 lg:col-span-5 relative group overflow-hidden rounded-2xl">
            <img
              src={ITEMS[2].src}
              alt={ITEMS[2].title}
              loading="lazy"
              width={1280}
              height={960}
              className="h-[380px] sm:h-[460px] w-full object-cover duotone-moss group-hover:scale-[1.03] transition-transform duration-[1200ms]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-loam/90 to-transparent text-bone">
              <div className="text-[10px] tracking-[0.28em] uppercase text-bone/70">{ITEMS[2].caption}</div>
              <div className="font-display text-xl mt-1">{ITEMS[2].title}</div>
            </figcaption>
          </figure>
          )}

          {ITEMS[3] && (
          <figure className="col-span-12 lg:col-span-7 relative group overflow-hidden rounded-2xl">
            <img
              src={ITEMS[3].src}
              alt={ITEMS[3].title}
              loading="lazy"
              width={1280}
              height={960}
              className="h-[380px] sm:h-[460px] w-full object-cover duotone-moss group-hover:scale-[1.03] transition-transform duration-[1200ms]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-loam/90 to-transparent text-bone">
              <div className="text-[10px] tracking-[0.28em] uppercase text-bone/70">{ITEMS[3].caption}</div>
              <div className="font-display text-xl mt-1">{ITEMS[3].title}</div>
            </figcaption>
          </figure>
          )}
        </div>

      </div>
    </section>
  );
}
