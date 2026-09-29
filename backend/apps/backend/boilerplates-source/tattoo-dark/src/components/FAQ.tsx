import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";
export function FAQ() {
  const [open, setOpen] = useState<number|null>(0);
  return (
    <section className="py-24 container-wss max-w-3xl">
      <div className="section-label">FAQ</div>
      <h2 className="text-4xl font-bold mb-10">Common questions.</h2>
      <div className="space-y-3">{siteConfig.faqs.map((f,i)=>(<div key={f.q} className="glass overflow-hidden"><button onClick={()=>setOpen(open===i?null:i)} className="w-full flex justify-between items-center p-5 text-left font-display font-semibold">{f.q}<ChevronDown className={`transition ${open===i?"rotate-180 text-signal":""}`} size={20}/></button>{open===i&&<p className="px-5 pb-5 text-fadetext">{f.a}</p>}</div>))}</div>
    </section>
  );
}
