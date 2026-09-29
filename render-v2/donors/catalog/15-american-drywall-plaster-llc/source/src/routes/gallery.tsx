import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";
const roomWiresImg = "";
const diningBarImg = "";
const ceilingRepairImg = "";
const popcornImg = "";
const warehouseLiftImg = "";
const exhaustFanImg = "";
const bathroomPaintImg = "";
const emptyRoomImg = "";
const drywallRoomImg = "";
const livingRoomImg = "";
const img8487 = "";
const img8471 = "";
const img8438 = "";
const img8445 = "";

const IMAGES = gallery.slice(0,14).map((m,i)=>({src:m.path,alt:client.identity.businessName+" — project photo "+(i+1)}));

export const Route = createFileRoute("/gallery")({
  head: () => ({meta: pageMeta({title: client.identity.businessName + " | gallery", description: client.hero.support, path: "/gallery"})}),
  component: GalleryPage,
});

function GalleryPage() {
  return (
    <>
      <section className="bg-bone border-b border-border">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 lg:pt-24 pb-12">
          <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">Gallery</span></nav>
          <h1 className="mt-6 font-display text-[44px] lg:text-[80px] leading-[0.98] text-ink">The work, <span className="italic">up close.</span></h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-foreground/75">{gallery.length ? "Project photos." : "No project photos are available."}</p>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-[1500px] px-6 lg:px-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {IMAGES.map((img, i) => (
            <figure key={i} className="relative overflow-hidden rounded-sm shadow-soft group aspect-[4/5]">
              <img src={img.src} alt={img.alt} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
              <figcaption className="absolute bottom-0 inset-x-0 p-5 text-bone text-[13px] font-mono uppercase tracking-[0.18em]">{img.alt}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
