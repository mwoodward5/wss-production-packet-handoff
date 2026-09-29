import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="container-wss pt-28 pb-2 text-xs text-fadetext">
      <ol className="flex items-center flex-wrap gap-1">
        {trail.map((item, idx) => {
          const last = idx === trail.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1">
              {last ? (
                <span className="text-bone" aria-current="page">
                  {item.name}
                </span>
              ) : (
                <Link to={item.path} className="hover:text-bone transition">
                  {item.name}
                </Link>
              )}
              {!last && <ChevronRight size={12} className="text-fadetext/60" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
