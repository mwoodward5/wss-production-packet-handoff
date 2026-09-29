import { CLIENT, PLAN, media, GALLERY } from "@/lib/wss";
import * as React from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Phone } from "lucide-react";
import { SITE } from "@/lib/site";
import { blogPostingJsonLd } from "@/lib/schema";
import { pageHead, Breadcrumbs } from "@/lib/seo";
import { PageHero, ClosingBand } from "./services";
const detailRailing = CLIENT.hero.poster;

type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;
  body: () => React.ReactElement;
};

const POSTS: Record<string,Post> = {};

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = POSTS[params.slug];
    if (!post) throw notFound();
    return { post };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { post } = loaderData;
    return pageHead({
      title: `${post.title} · ${SITE.name}`,
      description: post.description,
      path: `/blog/${post.slug}`,
      type: "article",
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: post.title, path: `/blog/${post.slug}` },
      ],
      extraScripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            blogPostingJsonLd({
              title: post.title,
              description: post.description,
              url: `${SITE.url}/blog/${post.slug}`,
              datePublished: post.date,
            })
          ),
        },
      ],
    });
  },
  notFoundComponent: () => (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-display text-4xl text-ink">Article not found</h1>
        <Link to="/blog" className="mt-4 inline-block text-cedar">Back to blog</Link>
      </div>
    </div>
  ),
  component: PostPage,
});

function PostPage() {
  const data = Route.useLoaderData() as { post: Post };
  const { post } = data;
  const Body = post.body;
  return (
    <>
      <PageHero
        eyebrow="Field notes"
        title={<>{post.title}</>}
        intro={post.description}
        image={detailRailing}
      />

      <section className="section bg-background">
        <div className="mx-auto max-w-3xl px-5 md:px-8">
          <Breadcrumbs
            crumbs={[
              { name: "Home", path: "/" },
              { name: "Blog", path: "/blog" },
              { name: post.title, path: `/blog/${post.slug}` },
            ]}
          />
          <p className="mt-6 text-xs uppercase tracking-[0.22em] text-ink/50">{post.date}</p>
          <article className="mt-4 prose-article">
            <Body />
          </article>

          <div className="mt-12 rounded-2xl border border-border bg-card p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="font-display text-xl text-ink">Contact</p>
              <p className="text-sm text-ink/65">{CLIENT.content.ctaBody}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-cream">
                Start my project <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={SITE.phoneHref} className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-3 text-sm font-medium text-ink">
                <Phone className="h-4 w-4" /> {SITE.phone}
              </a>
            </div>
          </div>
        </div>
      </section>

      <ClosingBand />
    </>
  );
}
