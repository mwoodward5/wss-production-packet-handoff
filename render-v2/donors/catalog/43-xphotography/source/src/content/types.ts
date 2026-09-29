import { ReactNode } from "react";

export interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  author: string;
  category: string;
  tags: string[];
  coverImage: string;
  readingTime: string;
}

export interface Article extends ArticleMeta {
  body: () => ReactNode;
}
