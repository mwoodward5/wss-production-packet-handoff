import {ClientImage} from "@/components/site/ClientImage";
import {client,serviceItems,european,mediaItems,hoursText,pageCopy} from "@/data/bridge";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ASSETS } from "@/assets/manifest";

export const Route = createFileRoute("/gallery")({
  head: () => ({meta:[{title: "Gallery — " + client.identity.businessName}],links:[{rel:"canonical",href:new URL("/gallery",client.identity.website).href}]}),
  component: GalleryPage,
});

const GALLERY=mediaItems("gallery").map(m=>({url:m.path}));

export function GalleryPage() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const slides = GALLERY.map((g) => ({ src: g.url, alt: client.identity.businessName }));

  return (
    <SiteLayout>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-[color:var(--asphalt)] py-24 text-white sm:py-32">
        <div className="absolute inset-0 -z-10">
          <ClientImage
            src={ASSETS.about_story.url}
            alt=""
            className="ken-burns h-full w-full object-cover opacity-45"
          />
          <div className="absolute inset-0 hero-scrim" />
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--banana)] ring-1 ring-white/20">
            Gallery
          </span>
          <h1 className="mt-6 max-w-3xl font-display text-[clamp(2.8rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
            {client.identity.businessName} gallery
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85 sm:text-xl">{pageCopy("gallery")}</p>
        </div>
      </section>

      {!GALLERY.length && <p className="mx-auto max-w-7xl px-4 py-12">No client photos are available.</p>}
      {/* MASONRY */}
      <section className="bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4 [column-fill:_balance]">
            {GALLERY.map((g, i) => (
              <button
                key={i}
                onClick={() => {
                  setIndex(i);
                  setOpen(true);
                }}
                className="group mb-5 block w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] break-inside-avoid"
                aria-label={`Open image ${i + 1}`}
              >
                <ClientImage
                  src={g.url}
                  alt={`${client.identity.businessName} photo ${i + 1}`}
                  className="h-auto w-full object-cover transition-transform duration-[1200ms] group-hover:scale-[1.04]"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={slides}
        controller={{ closeOnBackdropClick: true }}
        animation={{ fade: 300 }}
      />
    </SiteLayout>
  );
}
