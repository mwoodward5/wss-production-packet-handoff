import { useSite } from "@/lib/wss";
import { Phone } from "lucide-react";

const nav = [
  { href: "#services", label: "Services" },
  { href: "#gallery", label: "Projects" },
  { href: "#planner", label: "Plan a project" },
  { href: "#area", label: "Area" },
  { href: "#contact", label: "Contact" },
];

export function Header() {
  const {client, area, hours, emailHref, googleMaps, appleMaps, plan} = useSite();
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-cream/85 backdrop-blur">
      <div className="mx-auto flex h-24 max-w-7xl items-center justify-between px-5 lg:px-8">
        <a href="/#top" className="group flex items-center gap-4">
          <span className="relative grid h-[72px] w-[72px] place-items-center rounded-xl bg-cream ring-1 ring-ink/8 shadow-card">
            <img
              src={client.identity.logoOnLight}
              alt={client.identity.businessName}
              width={72}
              height={72}
              className="h-[72px] w-[72px] object-contain"
            />
            <span aria-hidden className="absolute -inset-px rounded-xl ring-1 ring-clay/0 transition group-hover:ring-clay/40" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[19px] font-semibold tracking-tight text-ink">
              {client.identity.businessName}
            </span>
            <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
              {area}
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-8 lg:flex">
          {nav.filter(n=> (n.href!=="#gallery" || client.media.some(m=>m.role==="gallery")) && (n.href!=="#planner" || emailHref)).map((n) => (
            <a
              key={n.href}
              href={"/"+n.href}
              className="relative text-sm text-ink-soft transition hover:text-ink after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:bg-clay after:transition-all hover:after:w-full"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <a
          href={client.identity.phoneTel}
          className="group inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-4 py-2.5 text-sm font-medium text-ink shadow-card transition hover:border-ink/40"
        >
          <Phone className="h-3.5 w-3.5 text-clay" strokeWidth={2.5} />
          <span className="hidden sm:inline">{client.identity.phoneDisplay}</span>
          <span className="sm:hidden">Call</span>
        </a>
      </div>
    </header>
  );
}
