import { useSite } from "@/lib/wss";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Project = { src: string; label: string; service: string; locale: string; month: string; alt: string };

export function Gallery() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  const projects:Project[]=client.media.filter(m=>m.role==="gallery").slice(0,5).map((m,i)=>({src:m.path,label:`Photo ${i+1}`,service:"",locale:"",month:"",alt:`${client.identity.businessName} — photo ${i+1}`}));
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => ((i ?? 0) + 1) % projects.length);
      if (e.key === "ArrowLeft") setOpen((i) => ((i ?? 0) - 1 + projects.length) % projects.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if(!projects.length) return null;
  return (
    <section id="gallery" className="relative bg-cream py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow">Gallery · contact sheet</p>
            <h2 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl lg:text-5xl">
              A closer look. <span className="italic text-clay">Photo gallery.</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            Questions about these photos?
            <a href="#contact" className="ml-1 underline decoration-clay decoration-2 underline-offset-4 hover:text-ink">Ask us.</a>
          </p>
        </div>

        {/* Editorial contact sheet */}
        <div className="mt-12 grid grid-cols-12 gap-5">
          {/* Hero print + caption */}
          <Print project={projects[0]} index={0} onOpen={setOpen} className="col-span-12 lg:col-span-8 aspect-[16/10]" big />
          <aside className="col-span-12 lg:col-span-4 flex flex-col justify-between rounded-2xl border border-line bg-paper p-6">
            <div>
              <div className="font-mono text-[10px] tracking-[0.2em] text-clay">PHOTO / 01</div>
              <h3 className="mt-3 font-display text-2xl leading-tight text-ink">{projects[0].label}</h3>
              <dl className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
                {projects[0].service && <Row k="Service" v={projects[0].service} />}
                {projects[0].locale && <Row k="Locale" v={projects[0].locale} />}
                {projects[0].month && <Row k="When" v={projects[0].month} />}
              </dl>
            </div>
            <a href={emailHref ? "#planner" : client.identity.phoneTel} className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition hover:text-clay">
              Discuss your project →
            </a>
          </aside>

          {/* Secondary row */}
          {projects.slice(1, 4).map((p, i) => (
            <Print key={p.src} project={p} index={i + 1} onOpen={setOpen} className="col-span-12 sm:col-span-6 lg:col-span-4 aspect-[4/3]" />
          ))}

          {/* Tertiary */}
          {projects.slice(4).map((p, i) => (
            <Print key={p.src} project={p} index={i + 4} onOpen={setOpen} className="col-span-12 sm:col-span-6 lg:col-span-6 aspect-[3/2]" />
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/92 p-4 backdrop-blur-sm"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(null); }}
            className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-cream text-ink hover:bg-clay hover:text-cream"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <figure className="relative max-h-[88vh] max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img src={projects[open].src} alt={projects[open].alt} className="max-h-[80vh] w-auto rounded-md ring-1 ring-cream/15" />
            <figcaption className="mt-3 flex items-center justify-between text-xs text-cream/80">
              <span className="font-mono tracking-widest text-clay-soft">PHOTO · {String(open + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span>
              <span>{projects[open].label} · {projects[open].service} · {projects[open].month}</span>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">{k}</dt>
      <dd className="text-right text-ink">{v}</dd>
    </div>
  );
}

function Print({
  project,
  index,
  onOpen,
  className = "",
  big = false,
}: {
  project: Project;
  index: number;
  onOpen: (i: number) => void;
  className?: string;
  big?: boolean;
}) {
  return (
    <figure className={`group relative overflow-hidden rounded-xl bg-paper p-2 ring-1 ring-ink/8 shadow-card transition hover:shadow-warm ${className}`}>
      <button
        type="button"
        onClick={() => onOpen(index)}
        className="relative block h-full w-full overflow-hidden rounded-md"
        aria-label={`Open ${project.label}`}
      >
        <img
          src={project.src}
          alt={project.alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
        />
        <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent p-3 text-cream">
          <span className={`font-display leading-tight ${big ? "text-lg" : "text-sm"}`}>{project.label}</span>
          <span className="rounded-full bg-cream/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink">
            {project.service}
          </span>
        </figcaption>
        <span className="absolute right-2 top-2 rounded bg-cream/90 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-ink ring-1 ring-ink/10">
          PHOTO · {String(index + 1).padStart(2, "0")}
        </span>
      </button>
    </figure>
  );
}
