import { useClient, useSitePlan, serviceImage } from "@/lib/wss";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

export const ServiceCards = () => {
  const c=useClient(), plan=useSitePlan();
  const services=c.services.map(s=>({title:s.name,desc:s.description,href:s.href,image:serviceImage(c,plan,s),tag:s.shortLabel}));
  return (
  <section className="container py-24">
    <div className="flex items-end justify-between flex-wrap gap-6 mb-12">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-primary mb-3">What we do</div>
        <h2 className="font-display text-4xl md:text-5xl max-w-2xl">{c.identity.businessName} <span className="copper-text">services</span></h2>
      </div>
      <p className="max-w-md text-muted-foreground">{c.content.serviceIntro}</p>
    </div>
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {services.map((s, i) => (
        <motion.div key={s.href + s.title}
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: i * 0.05 }}
        >
          <Link to={s.href} className="group block relative rounded-2xl overflow-hidden border border-border bg-gradient-card hover:border-primary/50 transition-all h-full">
            <div className="relative h-56 overflow-hidden">
              {s.image && <img src={s.image} alt={s.title} loading="lazy" width={1280} height={896}
                className="w-full h-full object-cover scale-100 group-hover:scale-105 transition-transform duration-700" />}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
              <div className="absolute top-4 left-4 text-[11px] uppercase tracking-[0.22em] px-2.5 py-1 rounded-full bg-background/70 backdrop-blur border border-border">{s.tag}</div>
            </div>
            <div className="p-6 flex items-start gap-4">
              <div className="flex-1">
                <h3 className="font-display text-xl mb-2 group-hover:text-primary transition-colors">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-muted grid place-items-center group-hover:bg-gradient-copper transition-all shrink-0">
                <ArrowUpRight className="w-4 h-4 group-hover:text-primary-foreground" />
              </div>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  </section>
);
};
