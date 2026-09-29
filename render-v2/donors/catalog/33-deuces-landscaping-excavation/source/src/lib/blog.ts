/**
 * Blog seed data.
 * GOLD MASTER TEMPLATE: empty by default. Drop posts into BLOG_POSTS.
 */

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  ogImage: string;
  body: string;
};

export const BLOG_POSTS: BlogPost[] = [];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
