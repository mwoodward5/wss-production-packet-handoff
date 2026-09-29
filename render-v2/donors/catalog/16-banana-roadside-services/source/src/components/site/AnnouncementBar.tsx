import {ClientImage} from "./ClientImage";
import {client,serviceItems,european,hoursText,mediaFor,pageCopy} from "@/data/bridge";
import { Zap } from "lucide-react";

export function AnnouncementBar() {
  return (
    <div className="w-full bg-[color:var(--asphalt)] text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm">
        <Zap className="size-3.5 text-[color:var(--banana)]" strokeWidth={2.5} />
        <span className="font-medium tracking-tight">
          {client.content.seasonalNote || serviceItems.map(s=>s.shortLabel).join(" · ")}
        </span>
      </div>
    </div>
  );
}
