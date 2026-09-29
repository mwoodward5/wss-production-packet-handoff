import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

export function RelatedStrip({
  items,
}: {
  items: { title: string; blurb: string; to: string }[];
}) {
  return (
    <section className="container-wss py-16">
      <div className="section-label mb-6">Keep exploring</div>
      <div className="grid md:grid-cols-3 gap-4">
        {items.map((i) => (
          <Link
            key={i.to}
            to={i.to}
            className="glass p-6 hover:border-signal/40 transition group block"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-display font-semibold text-lg">{i.title}</h3>
              <ArrowUpRight size={16} className="text-fadetext group-hover:text-signal transition" />
            </div>
            <p className="text-sm text-fadetext">{i.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
