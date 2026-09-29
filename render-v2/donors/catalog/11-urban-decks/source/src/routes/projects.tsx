import { SITE } from "@/lib/site";
import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute } from "@tanstack/react-router";
import { PageHero, ClosingBand } from "./services";
const projectPool = CLIENT.hero.poster;
const projectTimber = CLIENT.hero.poster;
const projectModern = CLIENT.hero.poster;
const detailRailing = CLIENT.hero.poster;
const render3d = CLIENT.hero.poster;
const heroDeck = CLIENT.hero.poster;
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/projects")({
  head: () =>
    pageHead({
      title: "Projects · " + SITE.name,
      description: SITE.shortDescription,
      path: "/projects",
    }),
  component: ProjectsPage,
});

type Project =
  | { kind: "photo"; src: string; title: string; tag: string; desc: string }
  | { kind: "neutral"; title: string; tag: string; desc: string };

const projects: Project[] = GALLERY.map((m,i)=>({kind:'photo',src:m.path,title:'Gallery image '+(i+1),tag:'Gallery',desc:''}));

function ProjectsPage() {
  return (
    <>
      <PageHero
        eyebrow="Projects"
        title={<>Project gallery</>}
        intro=""
        image={heroDeck}
      />
      <section className="section bg-background">
        <div className="mx-auto max-w-7xl px-5 md:px-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <article key={p.title} className="group relative overflow-hidden rounded-2xl bg-ink aspect-[4/5]">
              {p.kind === "photo" ? (
                <>
                  <img src={p.src} alt={p.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04] img-cinematic" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/65 to-ink/10" />
                </>
              ) : (
                <div className="absolute inset-0 bg-grad-night">
                  <div className="absolute inset-0 opacity-40 bg-grad-glow" aria-hidden />
                </div>
              )}
              <div className="relative h-full flex flex-col justify-end p-6 text-cream">
                <span className="self-start inline-flex items-center rounded-full bg-cedar px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-cedar">{p.tag}</span>
                <h3 className="mt-2 font-display text-2xl text-cream" style={{ textShadow: "0 2px 16px oklch(0 0 0 / 0.6)" }}>{p.title}</h3>
                <p className="mt-2 text-sm text-cream/90" style={{ textShadow: "0 1px 8px oklch(0 0 0 / 0.5)" }}>{p.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <ClosingBand />
    </>
  );
}
