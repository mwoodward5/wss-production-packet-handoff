import { site } from "@/wss/bridge";
import { useEffect, useState } from "react";

export function Curtain() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[200] pointer-events-none"
      style={{
        background: "var(--background)",
        animation: "curtain 1.1s cubic-bezier(.76,0,.24,1) 0.3s forwards",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="eyebrow"
          style={{ color: "var(--brass)", opacity: 0.9 }}
        >
          {site.identity.businessName}
        </span>
      </div>
    </div>
  );
}
