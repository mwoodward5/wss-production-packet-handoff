import {pageMeta} from '@/wss/bridge';
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { arts, artBySlug, type Art } from "@/data/arts";
import { media } from "@/data/media";
import { ProofVideo } from "@/components/ProofVideo";
import { ArtIcon } from "@/components/icons/ArtIcon";
import { ClosingCTA } from "@/components/PageChrome";

export const Route = createFileRoute("/arts/$slug")({
  loader:({params})=>loadArt(params.slug),
  head:({loaderData})=>pageMeta(loaderData?.art.name??'Art not found'),
  notFoundComponent: () => (
    <div className="mx-auto max-w-lg px-6 py-40 text-center">
      <h1 className="font-serif text-4xl text-bone">Room not found.</h1>
      <p className="mt-4 text-steel">That door doesn't exist. Return to the atlas.</p>
      <Link to="/arts" className="eyebrow mt-8 inline-flex text-edge">← Back to the atlas</Link>
    </div>
  ),
  component: ArtDetail,
});

export function loadArt(slug:string){const art=artBySlug(slug);if(!art)throw notFound();return {art};}

export function ArtDetail({slug}:{slug?:string}={}) {
  const params=useParams({strict:false}) as {slug?:string};
  const art=artBySlug(slug??params.slug??"");
  if(!art)throw notFound();
  const clips = art.mediaIds
    .map((id: string) => media.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const idx = arts.findIndex((a) => a.slug === art.slug);
  const prev = arts[(idx - 1 + arts.length) % arts.length];
  const next = arts[(idx + 1) % arts.length];
  const isSambo = art.accent === "sambo";

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-hairline bg-ink pt-40 md:pt-48">
        <div className="mx-auto max-w-[1440px] px-6 pb-20 md:px-10">
          <Link to="/arts" className="eyebrow inline-flex items-center gap-2 text-bone-dim hover:text-edge">
            ← The atlas
          </Link>
          <div className="mt-10 grid grid-cols-12 gap-8">
            <div className="col-span-12 md:col-span-8">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center border border-hairline">
                  <ArtIcon name={art.icon} size={30} className={isSambo ? "text-sambo" : "text-edge"} />
                </div>
                <div>
                  <div className="eyebrow text-edge">{art.region}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-steel">{art.era}</div>
                </div>
              </div>
              <h1 className="mt-8 font-serif text-6xl leading-[0.98] tracking-[-0.025em] text-bone md:text-8xl">
                {art.name}
              </h1>
              {art.native && (
                <div className="mt-4 font-serif text-2xl italic text-bone-dim">{art.native}</div>
              )}
              <p className="mt-8 max-w-2xl text-xl leading-relaxed text-bone-dim">
                {art.essence}
              </p>
            </div>
            {clips[0] && (
              <div className="col-span-12 md:col-span-4">
                <div className="halation">
                  <div className="grain relative aspect-[3/4] overflow-hidden bg-ink-2">
                    <ProofVideo item={clips[0]!} className="h-full w-full" eager />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* History + Teaching notes */}
      {(art.history || art.ramiLine) && <>

      <section className="on-paper border-b border-hairline py-20 md:py-28">
        <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-8 px-6 md:px-10">
          <div className="col-span-12 md:col-span-7">
            <div className="eyebrow">Program details</div>
            <p className="mt-6 font-serif text-2xl leading-[1.35] md:text-3xl" style={{ color: "var(--paper-ink)" }}>
              {art.history}
            </p>
          </div>
          {art.ramiLine && <aside className="col-span-12 md:col-span-4 md:col-start-9">
            <div className="border-l-2 border-edge/60 pl-6">
              <div className="eyebrow" style={{ color: "var(--edge-deep)" }}>Teaching notes</div>
              <p className="mt-4 font-serif text-lg italic leading-relaxed" style={{ color: "var(--paper-ink)" }}>
                "{art.ramiLine}"
              </p>
            </div>
          </aside>}
        </div>
      </section>

      </>}

      {/* Principles */}
      {(art.principles.length>0) && <>

      <section className="border-b border-hairline bg-ink py-20 md:py-28">
        <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-8 px-6 md:px-10">
          <div className="col-span-12 md:col-span-4">
            <div className="eyebrow text-edge">Principles</div>
            <h2 className="mt-4 font-serif text-4xl leading-tight text-bone md:text-5xl">
              What the room <span className="italic text-steel">is really about.</span>
            </h2>
          </div>
          <ol className="col-span-12 grid gap-0 md:col-span-8 md:grid-cols-2">
            {art.principles.map((p: string, i: number) => (
              <li key={p} className="border-t border-hairline p-6">
                <div className="numeral text-2xl">{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-3 font-serif text-xl text-bone">{p}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      </>}

      {/* Novice / Advanced */}
      {(art.novice || art.advanced) && <>

      <section className="on-paper border-b border-hairline py-20 md:py-28">
        <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-8 px-6 md:px-10">
          <div className="col-span-12 border-l-2 border-edge/60 pl-6 md:col-span-6">
            <div className="eyebrow" style={{ color: "var(--edge-deep)" }}>Start here</div>
            <p className="mt-4 font-serif text-2xl leading-snug md:text-3xl" style={{ color: "var(--paper-ink)" }}>
              {art.novice}
            </p>
          </div>
          <div className="col-span-12 border-l-2 border-steel/50 pl-6 md:col-span-6">
            <div className="eyebrow">Go deeper</div>
            <p className="mt-4 font-serif text-2xl leading-snug md:text-3xl" style={{ color: "var(--paper-ink)" }}>
              {art.advanced}
            </p>
          </div>
        </div>
      </section>

      </>}

      {/* Footage */}
      {clips.length > 0 && (
        <section className="border-b border-hairline bg-ink py-20 md:py-28">
          <div className="mx-auto max-w-[1440px] px-6 md:px-10">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="eyebrow text-edge">Signature footage</div>
                <h2 className="mt-4 font-serif text-4xl leading-tight text-bone md:text-5xl">
                  Shot on the mat.
                </h2>
              </div>
              <Link to="/media" className="eyebrow text-bone-dim hover:text-edge">Full library →</Link>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {clips.map((c) => (
                <figure key={c!.id} className="grain relative aspect-[3/4] overflow-hidden bg-ink-2">
                  <ProofVideo item={c!} className="h-full w-full" />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent p-4">
                    <span className="text-sm text-bone">{c!.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Reading */}
      {(art.reading.length>0) && <>

      <section className="on-paper border-b border-hairline py-20 md:py-28">
        <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-8 px-6 md:px-10">
          <div className="col-span-12 md:col-span-4">
            <div className="eyebrow">Further reading</div>
            <h2 className="mt-4 font-serif text-4xl leading-tight md:text-5xl" style={{ color: "var(--paper-ink)" }}>
              We teach <span className="italic" style={{ color: "var(--paper-steel)" }}>from these.</span>
            </h2>
          </div>
          <ul className="col-span-12 md:col-span-8">
            {art.reading.map((r) => (
              <li key={r.label} className="flex items-baseline gap-6 border-t border-hairline py-6">
                <span className="numeral">§</span>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-serif text-lg underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current md:text-xl"
                    style={{ color: "var(--paper-ink)" }}
                  >
                    {r.label}
                    <span className="ml-2 text-xs uppercase tracking-widest" style={{ color: "var(--paper-steel)" }}>↗</span>
                  </a>
                ) : (
                  <span className="font-serif text-lg md:text-xl" style={{ color: "var(--paper-ink)" }}>
                    {r.label}
                    {r.note && <span className="ml-2 text-xs italic" style={{ color: "var(--paper-steel)" }}>· {r.note}</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      </>}

      {/* Prev / next room */}
      <section className="border-b border-hairline bg-ink py-14">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-6 px-6 md:flex-row md:items-center md:px-10">
          <Link to="/arts/$slug" params={{ slug: prev.slug }} className="group flex items-center gap-4 text-bone-dim hover:text-edge">
            <span className="eyebrow">← Previous room</span>
            <span className="font-serif text-xl text-bone group-hover:text-edge">{prev.name}</span>
          </Link>
          <Link to="/arts" className="eyebrow text-steel hover:text-edge">The atlas</Link>
          <Link to="/arts/$slug" params={{ slug: next.slug }} className="group flex items-center gap-4 text-bone-dim hover:text-edge">
            <span className="font-serif text-xl text-bone group-hover:text-edge">{next.name}</span>
            <span className="eyebrow">Next room →</span>
          </Link>
        </div>
      </section>

      <ClosingCTA />
    </>
  );
}
