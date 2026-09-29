import {ClientImage} from "./ClientImage";
import {aggregate,client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { useEffect, useRef, useState } from "react";
import Autoplay from "embla-carousel-autoplay";
import { ExternalLink, Star, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { REVIEWS } from "@/data/reviews";
import { GOOGLE_REVIEW_URL } from "@/data/site";
import { ASSETS } from "@/assets/manifest";

export function TestimonialsCarousel() {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const autoplay = useRef(
    Autoplay({ delay: 4500, stopOnInteraction: false, stopOnMouseEnter: true }),
  );

  useEffect(() => {
    if (!api) return;
    const update = () => setIndex(api.selectedScrollSnap());
    update();
    api.on("select", update);
  }, [api]);

  if(!REVIEWS.length) return null;
  return (
    <section className="bg-[color:var(--cream)] py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/70">
            <Star className="size-3.5 fill-[color:var(--banana-deep)] stroke-[color:var(--banana-deep)]" />
            What drivers are saying
          </span>
          <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            Customer reviews
          </h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            {aggregate && `${aggregate.rating}/5 · ${aggregate.count} reviews`}
          </p>
        </div>

        <div className="mt-12">
          <Carousel
            setApi={setApi}
            opts={{ align: "start", loop: true }}
            plugins={[autoplay.current]}
            className="mx-auto max-w-6xl"
          >
            <CarouselContent className="-ml-4">
              {REVIEWS.map((r, i) => (
                <CarouselItem key={i} className="basis-full pl-4 md:basis-1/2 lg:basis-1/3">
                  <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-7 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
                    <div className="flex items-center gap-1 text-[color:var(--banana-deep)]">
                      {Array.from({ length: Math.floor(r.rating ?? 0) }).map((_, j) => (
                        <Star key={j} className="size-4 fill-current" />
                      ))}
                    </div>
                    <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground/85">
                      "{r.quote}"
                    </blockquote>
                    <footer className="mt-6 flex items-center justify-between border-t border-border/70 pt-4">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{r.name}</div>
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        <a href={r.sourceUrl} target="_blank" rel="noopener">Review source{r.rating !== null && ` · ${r.rating}/5`}</a>
                      </div>
                    </footer>
                  </article>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          <div className="mt-10 flex flex-col items-center gap-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => api?.scrollPrev()}
                aria-label="Previous review"
                className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-foreground/[0.04]"
              >
                <ChevronLeft className="size-5" />
              </button>
              <div className="flex items-center gap-1.5">
                {REVIEWS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => api?.scrollTo(i)}
                    aria-label={`Go to review ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-6 bg-[color:var(--banana-deep)]" : "w-1.5 bg-foreground/20"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={() => api?.scrollNext()}
                aria-label="Next review"
                className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-foreground/[0.04]"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            {GOOGLE_REVIEW_URL && (<a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-3 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-transform hover:-translate-y-0.5"
            >
              
              Read reviews
              <ExternalLink className="size-4 opacity-80" />
            </a>)}
          </div>
        </div>
      </div>
    </section>
  );
}
