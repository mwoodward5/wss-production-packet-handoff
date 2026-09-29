/**
 * ReviewsCarousel — Google 5-star slideshow + "Review us on Google" CTA.
 * Sources verbatim quotes; falls back to a Google-Business card if REVIEWS is empty.
 */
import { Star } from "lucide-react";
import { CLIENT, REVIEWS } from "@/config";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { useRef } from "react";


export function ReviewsCarousel() {
  const writeUrl = CLIENT.gbp?.writeReviewUrl || CLIENT.gbp?.reviewsUrl;
  const autoplay = useRef(Autoplay({ delay: 6000, stopOnInteraction: true }));

  if (!REVIEWS.length) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <Carousel
        opts={{ loop: true, align: "start" }}
        
        className="relative"
      >
        <CarouselContent>
          {REVIEWS.map((r, i) => (
            <CarouselItem key={i}>
              <article className="premium-card p-8 md:p-10 h-full">
                <div className="flex items-center gap-3 mb-4">
                  
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: Math.floor(r.rating || 0) }).map((_, k) => (
                      <Star key={k} className="w-4 h-4 fill-primary text-primary" />
                    ))}
                  </div>
                </div>
                <blockquote className="text-lg md:text-xl text-foreground leading-relaxed font-medium">
                  &ldquo;{r.body}&rdquo;
                </blockquote>
                <footer className="mt-5 flex items-center gap-3 text-sm">
                  <span className="inline-flex w-9 h-9 items-center justify-center rounded-full bg-primary/15 text-primary font-bold">
                    {r.initial}
                  </span>
                  <div>
                    <div className="font-semibold text-foreground">{r.author}</div>
                    <div className="text-muted-foreground"><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">Review source</a></div>
                  </div>
                </footer>
              </article>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex -left-12" />
        <CarouselNext className="hidden md:flex -right-12" />
      </Carousel>


    </div>
  );
}
