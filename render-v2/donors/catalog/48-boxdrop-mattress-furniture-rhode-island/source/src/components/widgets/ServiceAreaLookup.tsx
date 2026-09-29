import { useState } from "react";
import { MapPin, ArrowRight } from "lucide-react";
import { RouteLink } from "@/components/site/RouteLink";
import {client} from "@/wss/bridge";

export function ServiceAreaLookup() {
  const [zip, setZip] = useState("");
  const [result, setResult] = useState<{ city: string; slug: string; nearby?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {e.preventDefault();setResult(null);setError(null);const area=client.trust.areas.find(a=>a.toLowerCase()===zip.trim().toLowerCase());if(area)setResult({city:area,slug:'locations'});else setError('Please contact us to ask about this area.');};
  const page=result?{path:'/locations'}:null;
  if(!client.trust.areas.length)return null;

  return (
    <div className="card-elevate p-6">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-brand" />
        <p className="eyebrow !text-brand !tracking-[0.18em]">Service Area Lookup</p>
      </div>
      <h3 className="mt-2 text-2xl font-bold">Do you serve my area?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter an area name to check our published service area.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          inputMode="text"
          maxLength={160}
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Area name"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Area name"
        />
        <button type="submit" className="rounded-lg btn-glow px-4 py-2 text-sm font-bold">
          Check
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-foreground/70">{error}</p>}

      {result && page && (
        <RouteLink
          to={page.path}
          data-event="location_cta"
          className="mt-4 flex items-center justify-between rounded-xl border border-brand/30 bg-brand/10 p-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">We serve</p>
            <p className="mt-0.5 text-lg font-extrabold">{result.city}</p>
            {result.nearby && <p className="text-xs text-foreground/70">Near {result.nearby}</p>}
          </div>
          <ArrowRight className="h-5 w-5 text-brand" />
        </RouteLink>
      )}
    </div>
  );
}
