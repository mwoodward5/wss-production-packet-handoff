import atlGuide from "./articles/atlanta-wedding-photographer-guide";
import buckhead from "./articles/buckhead-engagement-locations";
import wear from "./articles/what-to-wear-editorial-portraits";
import corp from "./articles/corporate-headshot-lighting-atlanta";
import cinematic from "./articles/cinematic-wedding-storytelling";
import choosing from "./articles/choosing-an-atl-wedding-photographer";
import { Article } from "./types";

export const ARTICLES: Article[] = [
  atlGuide, buckhead, wear, corp, cinematic, choosing,
].sort((a, b) => b.datePublished.localeCompare(a.datePublished));

export function getArticle(slug: string) {
  return ARTICLES.find(a => a.slug === slug);
}

export function relatedTo(slug: string, n = 3) {
  const cur = getArticle(slug);
  if (!cur) return [];
  return ARTICLES
    .filter(a => a.slug !== slug)
    .map(a => ({ a, score: a.tags.filter(t => cur.tags.includes(t)).length }))
    .sort((x, y) => y.score - x.score || x.a.datePublished.localeCompare(y.a.datePublished))
    .slice(0, n)
    .map(x => x.a);
}
