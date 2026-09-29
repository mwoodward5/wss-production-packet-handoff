import {createFileRoute,Link} from '@tanstack/react-router';
import {useEffect,useMemo,useState} from 'react';
import {X,ArrowUpRight,MapPin} from 'lucide-react';
import {BUSINESS} from '@/lib/business';
import {SITE,CLIENT} from '@/lib/wss';
export const Route=createFileRoute('/gallery')({component:GalleryPage});
type Category=string;
type Project={img:string;title:string;alt:string;category:string;aspect:'tall'|'portrait'|'square'|'landscape'|'wide';ratio?:string};
const PROJECTS:Project[]=SITE.gallery.map((m,i)=>({img:m.path,title:`Image ${i+1}`,alt:`${CLIENT.identity.businessName} — image ${i+1}`,category:'Gallery',ratio:m.width&&m.height?`${m.width}/${m.height}`:undefined,aspect:!m.width||!m.height?'square':m.width/m.height<0.8?'tall':m.width/m.height<0.95?'portrait':m.width/m.height<1.1?'square':m.width/m.height<1.5?'landscape':'wide'}));
const CATEGORIES=['All',...(PROJECTS.length?['Gallery']:[])];
const ASPECT_CLASS: Record<Project["aspect"], string> = {
  tall:      "aspect-[3/4]",
  portrait:  "aspect-[4/5]",
  square:    "aspect-square",
  landscape: "aspect-[4/3]",
  wide:      "aspect-[16/10]",
};

export function GalleryPage() {
  const [filter, setFilter] = useState<"All" | Category>("All");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const visible = useMemo(
    () => PROJECTS.filter((p) => filter === "All" || p.category === filter),
    [filter]
  );

  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? 0 : (i + 1) % visible.length));
      if (e.key === "ArrowLeft")  setOpenIdx((i) => (i === null ? 0 : (i - 1 + visible.length) % visible.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [openIdx, visible.length]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: PROJECTS.length };
    for (const p of PROJECTS) c[p.category] = (c[p.category] ?? 0) + 1;
    return c;
  }, []);

  return (
    <>


      <section className="bg-bone pt-20 pb-10">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— Gallery</div>
          <h1 className="display-xl max-w-4xl">
            Project<br/>
            <span className="italic text-ink/55">gallery.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] text-ink/70 leading-relaxed">
            {BUSINESS.name}
          </p>
          <div className="mt-6 flex items-center gap-2 text-[12px] text-ink/55">
            <MapPin size={13} className="text-volt-deep" />
            <span className="uppercase tracking-[0.16em] font-semibold">
              {visible.length} image{visible.length === 1 ? "" : "s"} · {BUSINESS.city}, {BUSINESS.state}
            </span>
          </div>
        </div>
      </section>

      <section className="bg-bone sticky top-0 z-20 border-y border-ink/10 backdrop-blur-md bg-bone/85">
        <div className="container-edge py-4 flex gap-2 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((c) => {
            const active = filter === c;
            return (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`shrink-0 px-4 py-2 text-[11.5px] uppercase tracking-[0.16em] font-semibold border transition-all ${
                  active
                    ? "bg-ink text-bone border-ink"
                    : "bg-transparent text-ink/70 border-ink/15 hover:border-ink/50 hover:text-ink"
                }`}
                aria-pressed={active}
              >
                {c}
                <span className={`ml-2 text-[10px] ${active ? "text-volt" : "text-ink/40"}`}>
                  {counts[c] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-bone pb-28 pt-10">
        <div className="container-edge">
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 [column-fill:_balance]">
            {visible.map((p, i) => {
              const idx = PROJECTS.indexOf(p);
              return (
                <figure
                  key={p.img + i}
                  className="break-inside-avoid mb-6 group cursor-zoom-in"
                  role="button" tabIndex={0} aria-label={`View ${p.title}`}
                  onClick={() => setOpenIdx(i)}
                  onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpenIdx(i);}}}
                >
                  <div className={`relative ${ASPECT_CLASS[p.aspect]} overflow-hidden frame-ink`} style={{aspectRatio:p.ratio}}>
                    <img
                      src={p.img}
                      alt={p.alt}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <div className="absolute inset-x-0 bottom-0 p-5 translate-y-3 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-500">
                      <div className="text-[10px] font-mono tracking-[0.22em] uppercase text-volt mb-1.5">
                        № {String(idx + 1).padStart(2, "0")} · {p.category}
                      </div>
                      <div className="font-display text-bone text-xl leading-tight">{p.title}</div>
                      <div className="mt-2 text-[12px] text-bone/75 leading-snug max-w-sm">{p.alt}</div>
                    </div>
                    <div className="absolute top-3 left-3 num-badge text-bone/85 mix-blend-difference">
                      № {String(idx + 1).padStart(2, "0")}
                    </div>
                    <div className="absolute top-3 right-3 px-2 py-1 bg-bone/95 text-ink text-[10px] uppercase tracking-[0.14em] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      View →
                    </div>
                  </div>
                  <figcaption className="mt-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-[17px] leading-tight">{p.title}</h3>
                      <p className="mt-1 text-[12.5px] text-ink/55 leading-snug">{p.alt}</p>
                    </div>
                    <span className="num-badge text-ink/35 shrink-0 mt-1">— {p.category}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>

          {visible.length === 0 && (
            <div className="text-center py-20 text-ink/50">
              No images available in this category.
            </div>
          )}
        </div>
      </section>

      {openIdx !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Project image"
          className="fixed inset-0 z-50 bg-ink/95 backdrop-blur-md flex flex-col"
          onClick={() => setOpenIdx(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setOpenIdx(null); }}
            className="absolute top-5 right-5 z-10 w-11 h-11 grid place-items-center border border-bone/30 text-bone hover:bg-volt hover:text-ink hover:border-volt transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          <div className="flex-1 grid place-items-center p-6 lg:p-12 overflow-hidden">
            <img
              src={visible[openIdx].img}
              alt={visible[openIdx].alt}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            className="bg-ink border-t border-bone/10 p-6 lg:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="container-edge flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div className="max-w-2xl">
                <div className="text-[10px] font-mono tracking-[0.22em] uppercase text-volt mb-2">
                  № {String(openIdx + 1).padStart(2, "0")} / {String(visible.length).padStart(2, "0")} · {visible[openIdx].category}
                </div>
                <h2 className="font-display text-2xl lg:text-3xl text-bone leading-tight">
                  {visible[openIdx].title}
                </h2>
                <p className="mt-3 text-[14px] text-bone/70 leading-relaxed">
                  {visible[openIdx].alt}
                </p>
              </div>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 bg-volt text-ink px-6 py-3 font-semibold text-[12px] uppercase tracking-[0.16em] hover:bg-bone transition-colors self-start"
                onClick={(e) => e.stopPropagation()}
              >
                Start your project <ArrowUpRight size={16}/>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
