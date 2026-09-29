import { ShieldCheck } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
export function Policies() {
  return (
    <section id="policies" className="py-24 container-wss">
      <div className="section-label">Booking Policy</div>
      <h2 className="text-4xl font-bold mb-10">Clear rules, zero surprises.</h2>
      <div className="grid md:grid-cols-2 gap-4 max-w-3xl">{siteConfig.policies.map(p=>(<div key={p} className="glass p-5 flex gap-3"><ShieldCheck className="text-signal shrink-0" size={20}/><span className="text-fadetext text-sm">{p}</span></div>))}</div>
    </section>
  );
}
