import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Instagram, Menu, X } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";

const links = [
  { label: "Artist", to: "/artist" },
  { label: "Portfolio", to: "/portfolio" },
  { label: "Flash", to: "/flash" },
  { label: "Process", to: "/process" },
  { label: "FAQ", to: "/faq" },
  { label: "Visit", to: "/visit" },
] as const;

export function Nav({ onBook }: { onBook: () => void }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const book = () => {
    setOpen(false);
    // If already on home, scroll; otherwise navigate to home + hash.
    if (router.state.location.pathname === "/") {
      onBook();
    } else {
      router.navigate({ to: "/", hash: "booking" });
    }
  };

  return (
    <header className="fixed top-0 inset-x-0 z-40">
      <nav className="container-wss flex items-center justify-between py-4 mt-3 glass px-5">
        <Link to="/" className="font-display text-lg font-bold">
          ✦ {siteConfig.studioName}
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm text-fadetext">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="hover:text-bone transition"
              activeProps={{ className: "text-signal" }}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="hidden md:flex items-center gap-4">
          <a
            href={siteConfig.instagram}
            target="_blank"
            rel="noreferrer"
            aria-label="Instagram"
            className="text-fadetext hover:text-bone"
          >
            <Instagram size={18} />
          </a>
          <button
            onClick={book}
            className="bg-signal text-ink font-semibold px-5 py-2 rounded-full text-sm hover:brightness-110 transition emboss whitespace-nowrap"
          >
            Request Tattoo
          </button>
        </div>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </nav>
      {open && (
        <div className="md:hidden container-wss glass mt-2 p-5 flex flex-col gap-4">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className="text-fadetext"
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={book}
            className="bg-signal text-ink font-semibold px-5 py-2 rounded-full"
          >
            Request Tattoo
          </button>
        </div>
      )}
    </header>
  );
}
