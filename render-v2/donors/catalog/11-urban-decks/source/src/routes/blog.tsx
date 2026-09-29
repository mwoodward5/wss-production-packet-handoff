import { SITE } from "@/lib/site";
import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { PageHero, ClosingBand } from "./services";
const detailRailing = CLIENT.hero.poster;

export const POSTS: {slug:string;title:string;excerpt:string;date:string}[] = [];

export const Route = createFileRoute("/blog")({
  head: () =>
    pageHead({
      title: "Field notes · " + SITE.name,
      description: SITE.shortDescription,
      path: "/blog",
    }),
  component: BlogIndex,
});

function BlogIndex() {
  return (
    <>
      <PageHero
        eyebrow="Field notes"
        title={<>Field notes</>}
        intro=""
        image={detailRailing}
      />
      <section className="section bg-background">
        <div className="mx-auto max-w-4xl px-5 md:px-8">
          <ul className="divide-y divide-border">
            {POSTS.map((p) => (
              <li key={p.slug} className="py-8">
                <p className="text-xs uppercase tracking-[0.22em] text-ink/50">{p.date}</p>
                <h2 className="mt-3 font-display text-3xl text-ink leading-tight">
                  <Link to="/blog/$slug" params={{ slug: p.slug }} className="hover:text-cedar">
                    {p.title}
                  </Link>
                </h2>
                <p className="mt-3 text-ink/70 leading-relaxed">{p.excerpt}</p>
                <Link to="/blog/$slug" params={{ slug: p.slug }} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-cedar">
                  Read article <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ClosingBand />
    </>
  );
}
