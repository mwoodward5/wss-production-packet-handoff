import { CLIENT, gallery } from "@/lib/wss";
import { Car, Footprints, Shapes, Factory } from "lucide-react";
export function Work() {
 const items=gallery().map((m,i)=>({icon:[Car,Footprints,Shapes,Factory][i],label:`Project ${i+1}`,image:m.path,alt:`${CLIENT.identity.businessName} project ${i+1}`}));
 if (!items.length) return null;
  return (
    <section id="work" className="relative py-24 md:py-32 bg-secondary/40 border-y border-border">
      <div className="container mx-auto px-5 md:px-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--coral)]">
              The work
            </p>
            <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
              Project gallery.
            </h2>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((it, i) => (
            <figure
              key={it.label}
              className={`group relative overflow-hidden rounded-sm shadow-card border border-border bg-[var(--ink)] ${
                i === 0 ? "aspect-[4/3] md:row-span-2 md:aspect-[4/5]" : "aspect-[4/3]"
              }`}
            >
              <img
                src={it.image}
                alt={it.alt}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />

              <div className="absolute top-5 left-5 right-5 flex items-start justify-between">
                <div className="h-10 w-10 rounded-sm bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center text-white">
                  <it.icon className="h-5 w-5" />
                </div>
              </div>

              <figcaption className="absolute inset-x-0 bottom-0 p-6 md:p-7 text-white">
                <div className="text-xl md:text-2xl font-display uppercase">{it.label}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
