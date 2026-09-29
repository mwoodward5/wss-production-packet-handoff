import { useEffect, useState } from "react";
import { X, MessageSquare, Phone } from "lucide-react";
import { business } from "@/data/business";

const KEY = "bd_exit_dismissed";

export function ExitIntentToast() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { if (sessionStorage.getItem(KEY)) return; } catch { /* noop */ }

    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      setOpen(true);
    };

    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 4) show();
    };
    const timer = window.setTimeout(show, 22000);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(KEY, "1"); } catch { /* noop */ }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 z-[60] w-[min(420px,calc(100vw-1rem))] -translate-x-1/2 md:bottom-6 md:left-6 md:translate-x-0"
    >
      <div className="glass-card relative overflow-hidden p-4 pr-10 shadow-2xl">
        <button
          onClick={close}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:bg-foreground/5"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="eyebrow">Hold up — one quick thing</p>
        <p className="mt-1 text-sm font-extrabold text-foreground">
          Want today's in-stock list? Text us, we'll send it.
        </p>
        <div className="mt-3 flex gap-2">
          <a
            href={business.smsHref}
            data-event="exit_text"
            onClick={close}
            className="btn-glow btn-beam inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-extrabold"
          >
            <MessageSquare className="h-4 w-4" /> Text us
          </a>
          <a
            href={`tel:${business.telephone}`}
            data-event="exit_call"
            onClick={close}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground/20 px-4 py-2.5 text-sm font-bold"
          >
            <Phone className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
