import { useEffect, useState } from "react";
import { useSite } from "./wss-bridge";
export function HeroMedia() {
  const { client } = useSite();
  // Social preview images often contain baked-in copy and claims. Prefer a
  // verified landscape photo for the hero while retaining every source asset.
  const poster = client.media.find(
    (item) => item.role === "gallery" && item.width >= 1200 && item.width >= item.height,
  )?.path || client.media.find((item) => item.role === "gallery")?.path || client.hero.poster;
  const [motion, setMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return (
    <>
      <img
        src={poster}
        alt={client.identity.businessName}
        className="h-full w-full object-cover"
      />
      {client.hero.video && motion && !failed && (
        <video
          src={client.hero.video}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          aria-hidden="true"
        />
      )}
    </>
  );
}
