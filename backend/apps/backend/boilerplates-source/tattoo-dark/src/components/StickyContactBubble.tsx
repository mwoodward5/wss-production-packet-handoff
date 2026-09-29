import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { siteConfig } from "@/config/siteConfig";

export function StickyContactBubble() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-5 left-5 z-40 md:bottom-6 md:left-6">
      {open ? (
        <div className="glass p-5 w-72 relative">
          <button
            className="absolute top-3 right-3 text-fadetext hover:text-bone"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-signal/20 text-signal grid place-items-center font-display font-bold">
              R
            </div>
            <div>
              <div className="text-sm font-semibold">{siteConfig.artistName}</div>
              <div className="text-[11px] text-fadetext flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-signal pulse-dot" />
                Replies within 3 business days
              </div>
            </div>
          </div>
          <p className="text-xs text-fadetext mb-3">
            The fastest path is a complete request form. If you have a quick question, chat with the studio assistant on the bottom right.
          </p>
          <div className="grid gap-2">
            <Link
              to="/"
              hash="booking"
              onClick={() => setOpen(false)}
              className="bg-signal text-ink font-semibold text-xs px-4 py-2.5 rounded-full text-center emboss"
            >
              Start booking request
            </Link>
            <a
              href={`mailto:${siteConfig.email}`}
              className="border border-line text-xs px-4 py-2.5 rounded-full text-center hover:border-signal/40 transition"
            >
              Email {siteConfig.email}
            </a>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Contact studio"
          className="w-14 h-14 rounded-full bg-signal text-ink grid place-items-center emboss hover:brightness-110 transition"
        >
          <MessageCircle size={22} />
        </button>
      )}
    </div>
  );
}
