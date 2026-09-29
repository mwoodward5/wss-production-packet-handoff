import { cached, emptyMediaFeed, type MediaFeed } from "./types";

const cache = cached<MediaFeed>(3 * 60 * 60 * 1000);

/** SERVER ONLY. Instagram Basic Display / Graph media endpoint. Token rotates every 60 days. */
export async function fetchInstagramMedia(opts: { accessToken: string; limit?: number }): Promise<MediaFeed> {
  return cache(async () => {
    const url = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink&limit=${opts.limit ?? 9}&access_token=${opts.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return emptyMediaFeed();
    const data = (await res.json()) as { data?: { id: string; caption?: string; media_type: string; media_url: string; thumbnail_url?: string; permalink: string }[] };
    return {
      fetchedAt: new Date().toISOString(),
      items: (data.data ?? []).map((m) => ({
        id: m.id,
        src: m.media_type === "VIDEO" ? (m.thumbnail_url ?? m.media_url) : m.media_url,
        alt: m.caption?.slice(0, 120) ?? "Instagram post",
        sourceUrl: m.permalink,
        caption: m.caption,
      })),
    };
  });
}
