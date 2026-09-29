import { MapPin } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
export function ArtistIntro() {
  return (
    <section className="py-24 container-wss grid lg:grid-cols-2 gap-12 items-start">
      <div><div className="section-label">Artist</div><h2 className="text-4xl font-bold mb-5">{siteConfig.artistName}</h2><p className="text-lg text-fadetext">{siteConfig.bio}</p></div>
      <div className="glass p-8"><h3 className="font-display font-semibold mb-4">Specialties</h3><div className="flex flex-wrap gap-2 mb-6">{siteConfig.specialties.map(s=><span key={s} className="tag">{s}</span>)}</div><div className="flex items-center gap-2 text-fadetext"><MapPin size={18}/>{siteConfig.city}, {siteConfig.state}</div></div>
    </section>
  );
}
