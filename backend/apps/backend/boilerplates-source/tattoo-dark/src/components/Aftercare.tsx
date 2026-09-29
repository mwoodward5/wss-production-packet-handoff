import { siteConfig } from "@/config/siteConfig";
export function Aftercare() {
  return (
    <section id="aftercare" className="py-24 container-wss">
      <div className="section-label">Aftercare</div>
      <h2 className="text-4xl font-bold mb-10">Heal it right.</h2>
      <ol className="space-y-4 max-w-2xl">{siteConfig.aftercare.map((a,i)=>(<li key={a} className="glass p-5 flex gap-4 items-start"><span className="text-signal font-display font-bold text-xl">{String(i+1).padStart(2,"0")}</span><span className="text-fadetext">{a}</span></li>))}</ol>
    </section>
  );
}
