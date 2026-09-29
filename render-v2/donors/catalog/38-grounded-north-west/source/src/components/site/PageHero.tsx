import { motion } from "framer-motion";
import { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: ReactNode;
  intro: string;
  image?: string;
  imageAlt: string;
}

export const PageHero = ({ eyebrow, title, intro, image, imageAlt }: Props) => (
  <section className="relative pt-32 pb-16 overflow-hidden bg-gradient-hero">
    <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
    <div className="container relative grid lg:grid-cols-12 gap-10 items-end">
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}
        className="lg:col-span-7"
      >
        <div className="text-xs uppercase tracking-[0.22em] text-primary">{eyebrow}</div>
        <h1 className="mt-4 font-display text-5xl md:text-6xl leading-[0.98] tracking-tight">{title}</h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">{intro}</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.1 }}
        className="lg:col-span-5"
      >
        <div className="rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated min-h-72">
          {image && <img src={image} alt={imageAlt} loading="lazy" width={1280} height={896} className="w-full h-72 object-cover" />}
        </div>
      </motion.div>
    </div>
  </section>
);
