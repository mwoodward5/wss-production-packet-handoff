import { Apple, Car, Navigation } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";

export function DirectionsBlock() {
  const btn =
    "flex items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-sm hover:border-signal/60 hover:text-signal transition";
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <a href={siteConfig.directions.apple} target="_blank" rel="noreferrer" className={btn}>
        <Apple size={16} /> Apple Maps
      </a>
      <a href={siteConfig.directions.google} target="_blank" rel="noreferrer" className={btn}>
        <Navigation size={16} /> Google Maps
      </a>
      <a href={siteConfig.directions.waze} target="_blank" rel="noreferrer" className={btn}>
        <Car size={16} /> Waze
      </a>
    </div>
  );
}
