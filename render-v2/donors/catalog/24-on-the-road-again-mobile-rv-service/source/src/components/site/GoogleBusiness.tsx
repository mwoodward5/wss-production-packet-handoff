/**
 * GoogleBusiness — placeholders that no-op if GBP isn't configured.
 * Real Maps/Places integration ships as a follow-up via the Google Maps connector.
 */
import { CLIENT } from "@/config";
import { Star } from "lucide-react";

export function GoogleGlyph({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.09-1.92 3.28-4.74 3.28-8.07z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.34-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.78.42 3.47 1.18 4.96l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.04l3.66 2.84C6.71 7.28 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export function GoogleReviewsCard() {
  const url = CLIENT.gbp?.reviewsUrl;
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-3">
        <GoogleGlyph className="w-8 h-8" />
        <div>
          <div className="font-semibold">Reviews on Google</div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Star className="w-3 h-3 fill-primary text-primary" /> See verified customer reviews
          </div>
        </div>
      </div>
    </a>
  );
}

export function GoogleMapEmbed() {
  const src = CLIENT.gbp?.mapEmbedUrl;
  if (!src) {
    return (
      <div className="aspect-[4/3] w-full rounded-2xl border border-border bg-muted grid place-items-center text-sm text-muted-foreground">
        Map preview — configure CLIENT.gbp.mapEmbedUrl
      </div>
    );
  }
  return (
    <div className="aspect-[4/3] w-full rounded-2xl overflow-hidden border border-border">
      <iframe
        src={src}
        title={`${CLIENT.businessName} on Google Maps`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="w-full h-full"
      />
    </div>
  );
}
