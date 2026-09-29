import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";
import LightFrame from "@/components/LightFrame";
import SideRail from "@/components/SideRail";
import { ARTICLES, getArticle, relatedTo } from "@/content/articles";

const SITE = "https://atlanta-cinematic-glow.lovable.app";

export default function Article() {
  const { slug = "" } = useParams();
  const article = getArticle(slug);

  if (!article) {
    return (
      <section className="pt-44 pb-32 bg-paper">
        <div className="container max-w-2xl text-center">
          <div className="label-eyebrow text-molten mb-6">404 · Not in the journal</div>
          <h1 className="font-display text-[2.4rem] text-ivory mb-6">This entry doesn't exist.</h1>
          <Link to="/journal" className="label-eyebrow text-molten">← Back to the journal</Link>
        </div>
      </section>
    );
  }

  const idx = ARTICLES.findIndex((a) => a.slug === slug);
  const prev = idx > 0 ? ARTICLES[idx - 1] : null;
  const next = idx < ARTICLES.length - 1 ? ARTICLES[idx + 1] : null;
  const related = relatedTo(slug, 3);
  const Body = article.body;

  const url = `${SITE}/journal/${article.slug}`;

  return (
    <>
      <Seo title={`${article.title} · XPhotography Journal`} description={article.description} path={`/journal/${article.slug}`} />
      <Helmet>
        <meta property="og:type" content="article" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: article.description,
          author: { "@type": "Person", name: article.author },
          datePublished: article.datePublished,
          dateModified: article.dateModified,
          mainEntityOfPage: url,
          image: `${SITE}${article.coverImage}`,
          publisher: { "@type": "Organization", name: "XPhotography" },
        })}</script>
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Journal", item: `${SITE}/journal` },
            { "@type": "ListItem", position: 2, name: article.title, item: url },
          ],
        })}</script>
      </Helmet>

      <article className="relative pt-40 pb-12 bg-paper overflow-hidden">
        <SideRail label={`JOURNAL · ${article.category.toUpperCase()}`} meta={[article.readingTime.toUpperCase(), new Date(article.datePublished).getFullYear().toString()]} />
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container max-w-3xl">
          <Link to="/journal" className="inline-flex items-center gap-2 label-eyebrow text-ivory/60 hover:text-molten mb-8">
            <ArrowLeft className="w-3.5 h-3.5" /> Journal
          </Link>
          <div className="label-eyebrow text-molten mb-6">{article.category} · {new Date(article.datePublished).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {article.readingTime}</div>
          <h1 className="font-display text-[1.8rem] md:text-5xl text-ivory leading-[1.02] tracking-tight text-balance mb-8">{article.title}</h1>
          <p className="text-ivory/70 text-xl leading-relaxed text-pretty">{article.description}</p>
        </div>

        <div className="container max-w-5xl mt-14">
          <LightFrame>
            <img src={article.coverImage} alt={article.title} className="w-full aspect-[16/9] object-cover" />
          </LightFrame>
        </div>

        <div className="container max-w-3xl mt-16">
          <div className="article-body text-ivory/85 text-lg leading-[1.75] space-y-6">
            <Body />
          </div>

          <div className="mt-16 pt-10 border-t border-ivory/10 flex flex-wrap gap-3">
            {article.tags.map((t) => (
              <span key={t} className="label-eyebrow text-ivory/50 border border-ivory/15 px-3 py-1">#{t}</span>
            ))}
          </div>

          <div className="mt-12 grid sm:grid-cols-2 gap-6 pt-10 border-t border-ivory/10">
            {prev ? (
              <Link to={`/journal/${prev.slug}`} className="border border-ivory/10 p-6 hover:border-molten/50 transition group">
                <div className="label-eyebrow text-ivory/50 mb-2">← Previous</div>
                <div className="font-display text-xl text-ivory group-hover:text-molten">{prev.title}</div>
              </Link>
            ) : <div />}
            {next ? (
              <Link to={`/journal/${next.slug}`} className="border border-ivory/10 p-6 hover:border-molten/50 transition group sm:text-right">
                <div className="label-eyebrow text-ivory/50 mb-2">Next →</div>
                <div className="font-display text-xl text-ivory group-hover:text-molten">{next.title}</div>
              </Link>
            ) : <div />}
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section className="py-24 bg-paper-soft border-t border-ivory/10">
          <div className="container">
            <div className="label-eyebrow text-molten mb-10">Related entries</div>
            <div className="grid md:grid-cols-3 gap-8">
              {related.map((r) => (
                <Link key={r.slug} to={`/journal/${r.slug}`} className="group block">
                  <LightFrame>
                    <img src={r.coverImage} alt={r.title} className="w-full aspect-[4/3] object-cover" />
                  </LightFrame>
                  <div className="font-display text-xl text-ivory mt-4 group-hover:text-molten transition">{r.title}</div>
                  <div className="font-mono text-xs text-ivory/50 mt-2">{r.readingTime}</div>
                </Link>
              ))}
            </div>
            <div className="mt-12 text-center">
              <Link to="/contact" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">
                Reserve a session <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
